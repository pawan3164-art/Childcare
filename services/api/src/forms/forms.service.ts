import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FormRequestStatus, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { centreDateString, isRealDate } from '../common/time/centre-day';
import { assertAdmin, centreScope, CentreScope } from '../common/centre-access';
import { computeAnswersHash, verifyAnswersHash } from './forms-hash';

const FIELD_TYPES = ['text', 'date', 'yes_no', 'choice', 'child_select', 'signature'] as const;
type FieldType = (typeof FIELD_TYPES)[number];
const MAX_FIELDS = 50;
const MAX_RECIPIENTS = 200;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;
const MAX_LABEL = 200;
const MAX_TEXT_ANSWER = 2000;

export interface FormField {
  key: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[];
}

export interface TemplateInput {
  title?: string;
  description?: string | null;
  fields?: unknown;
}

export interface SendRequestsInput {
  templateId?: string;
  version?: number;
  dueDate?: string | null;
  /** Alternative to `recipients`: send to every current, unrestricted parent or guardian of these children. */
  childIds?: string[];
  recipients?: Array<{ guardianUserId: string; childId: string; supersedesSubmissionId?: string }>;
}

export interface SubmitInput {
  answers?: unknown;
  signature?: { typedName?: unknown; imageRef?: unknown; consent?: unknown };
}

export interface SubmitMeta {
  ip?: string;
  userAgent?: string;
}

/** Only these relationships may be sent or sign forms, and never a restricted one (court orders). */
const SIGNING_LINK = { isRestricted: false, relationshipType: { in: ['PARENT', 'GUARDIAN'] as ('PARENT' | 'GUARDIAN')[] } };
/** A signature reference is the server-issued `signatures/<id>` of a stroke set saved by saveSignature. */
const SIGNATURE_REF_RE = /^signatures\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const MAX_STROKES = 20;
const MAX_POINTS = 300;
const MAX_SIGNATURES_PER_REQUEST = 5;
const MAX_USER_AGENT = 512;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleOf(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length < 1 || v.length > 200) throw new BadRequestException('Title must be 1 to 200 characters');
  return v;
}

function descriptionOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  if (v.length > 2000) throw new BadRequestException('Description must be at most 2000 characters');
  return v || null;
}

/** Validates and normalises a template's fields. Throws BadRequest naming the problem (never echoing content into logs). */
function validateFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) throw new BadRequestException('fields must be a list');
  if (input.length > MAX_FIELDS) throw new BadRequestException(`A form can have at most ${MAX_FIELDS} fields`);
  const seen = new Set<string>();
  let signatures = 0;
  return input.map((raw, i) => {
    const f = raw as Record<string, unknown> | null;
    if (!f || typeof f !== 'object') throw new BadRequestException(`Field ${i + 1} is not valid`);
    const key = typeof f.key === 'string' ? f.key : '';
    if (!/^[A-Za-z0-9_]{1,64}$/.test(key) || key in Object.prototype) throw new BadRequestException(`Field ${i + 1} needs a key of letters, digits and underscores`);
    if (seen.has(key)) throw new BadRequestException(`Field key "${key}" is used twice`);
    seen.add(key);
    if (!FIELD_TYPES.includes(f.type as FieldType)) throw new BadRequestException(`Field "${key}" has an unknown type`);
    const type = f.type as FieldType;
    const label = typeof f.label === 'string' ? f.label.trim() : '';
    if (!label || label.length > MAX_LABEL) throw new BadRequestException(`Field "${key}" needs a label of 1 to ${MAX_LABEL} characters`);
    if (type === 'signature' && ++signatures > 1) throw new BadRequestException('A form can have only one signature field');
    const out: FormField = { key, type, label, required: f.required === true };
    if (type === 'choice') {
      const opts = f.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.some((o) => typeof o !== 'string' || !o.trim())) {
        throw new BadRequestException(`Field "${key}" needs at least two non-blank options`);
      }
      const clean = (opts as string[]).map((o) => o.trim());
      if (new Set(clean).size !== clean.length) throw new BadRequestException(`Field "${key}" has duplicate options`);
      out.options = clean;
    } else if (f.options !== undefined) {
      throw new BadRequestException(`Field "${key}" cannot have options`);
    }
    return out;
  });
}

interface TemplateRow {
  id: string;
  title: string;
  description: string | null;
  fields: Prisma.JsonValue;
  latestVersion: number | null;
  dirty: boolean;
}

function presentTemplate(t: TemplateRow) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    fields: t.fields as unknown as FormField[],
    status: t.dirty ? ('DRAFT' as const) : ('PUBLISHED' as const),
    latestVersion: t.latestVersion,
  };
}

interface RequestRow {
  id: string;
  templateId: string;
  templateVersion: number;
  childId: string;
  guardianUserId: string;
  status: FormRequestStatus;
  dueDate: Date | null;
  signedAt: Date | null;
  supersedesSubmissionId: string | null;
}

function presentRequest(r: RequestRow, title: string) {
  return {
    id: r.id,
    templateId: r.templateId,
    templateVersion: r.templateVersion,
    title,
    childId: r.childId,
    status: r.status,
    dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    signedAt: r.signedAt,
    supersedesSubmissionId: r.supersedesSubmissionId,
  };
}

/**
 * Digital forms and e-signature (ADR 0005). Published versions and signed submissions are immutable (database
 * triggers); a correction is a new request. The audit log holds ids and counts only, never titles, answers, names,
 * signature data, IP address or device.
 */
@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Written in the change's own transaction: no committed change without its audit entry. */
  private record(tx: Prisma.TransactionClient, actor: RequestUser, scope: CentreScope, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
    return this.audit.record(
      { orgId: scope.orgId, centreId: scope.centreId, actorUserId: actor.userId, actorRole: actor.role, action, entityType, entityId, outcome: 'SUCCESS', metadata },
      tx,
    );
  }

  private parentScope(user: RequestUser, what: string): CentreScope {
    const scope = centreScope(user);
    if (user.role !== 'PARENT') throw new ForbiddenException(`Only a parent or guardian can ${what}`);
    return scope;
  }

  private async timezone(tx: Prisma.TransactionClient, scope: CentreScope): Promise<string> {
    const centre = await tx.centre.findFirst({ where: { id: scope.centreId }, select: { timezone: true } });
    return centre?.timezone ?? 'Australia/Sydney';
  }

  // ---- templates -----------------------------------------------------------------------------------------------

  async createTemplate(admin: RequestUser, dto: TemplateInput, now: Date = new Date()) {
    void now;
    const scope = assertAdmin(admin, 'create forms');
    const title = titleOf(dto.title);
    const description = descriptionOf(dto.description);
    const fields = validateFields(dto.fields ?? []);
    return this.tenancy.withTenant(scope, async (tx) => {
      const row = await tx.formTemplate.create({
        data: { ...scope, title, description, fields: fields as unknown as Prisma.InputJsonValue, createdByUserId: admin.userId },
      });
      await this.record(tx, admin, scope, 'forms.template_created', 'FormTemplate', row.id, { fieldCount: fields.length });
      return presentTemplate(row);
    });
  }

  async updateTemplate(admin: RequestUser, id: string, dto: TemplateInput, now: Date = new Date()) {
    void now;
    const scope = assertAdmin(admin, 'change forms');
    return this.tenancy.withTenant(scope, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('form-template'), hashtext(${id}))`;
      const current = await tx.formTemplate.findFirst({ where: { id, centreId: scope.centreId } });
      if (!current) throw new NotFoundException('Form not found');
      const data: Prisma.FormTemplateUpdateInput = { dirty: true };
      if (dto.title !== undefined) data.title = titleOf(dto.title);
      if (dto.description !== undefined) data.description = descriptionOf(dto.description);
      if (dto.fields !== undefined) data.fields = validateFields(dto.fields) as unknown as Prisma.InputJsonValue;
      const row = await tx.formTemplate.update({ where: { id }, data });
      await this.record(tx, admin, scope, 'forms.template_updated', 'FormTemplate', id, { changed: Object.keys(data).filter((k) => k !== 'dirty') });
      return presentTemplate(row);
    });
  }

  async publishTemplate(admin: RequestUser, id: string, now: Date = new Date()) {
    const scope = assertAdmin(admin, 'publish forms');
    return this.tenancy.withTenant(scope, async (tx) => {
      // Serialises publishes of one template, so version numbers never repeat.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('form-template'), hashtext(${id}))`;
      const t = await tx.formTemplate.findFirst({ where: { id, centreId: scope.centreId } });
      if (!t) throw new NotFoundException('Form not found');
      if (!Array.isArray(t.fields) || t.fields.length === 0) throw new BadRequestException('Add at least one field before publishing');
      if (!t.dirty) throw new ConflictException('There are no changes to publish');
      const version = (t.latestVersion ?? 0) + 1;
      const v = await tx.formTemplateVersion.create({
        data: {
          ...scope,
          templateId: t.id,
          version,
          title: t.title,
          description: t.description,
          fields: t.fields as Prisma.InputJsonValue,
          publishedByUserId: admin.userId,
          publishedAt: now,
        },
      });
      await tx.formTemplate.update({ where: { id }, data: { latestVersion: version, dirty: false } });
      await this.record(tx, admin, scope, 'forms.template_published', 'FormTemplate', t.id, { version, fieldCount: (t.fields as unknown[]).length });
      return { templateId: v.templateId, version: v.version, title: v.title, description: v.description, fields: v.fields as unknown as FormField[] };
    });
  }

  async listTemplates(admin: RequestUser, now: Date = new Date()) {
    void now;
    const scope = assertAdmin(admin, 'see form templates');
    return this.tenancy.withTenant(scope, async (tx) => {
      const rows = await tx.formTemplate.findMany({ where: { centreId: scope.centreId }, orderBy: { createdAt: 'desc' } });
      return rows.map(presentTemplate);
    });
  }

  async getTemplate(admin: RequestUser, id: string) {
    const scope = assertAdmin(admin, 'see form templates');
    return this.tenancy.withTenant(scope, async (tx) => {
      const row = await tx.formTemplate.findFirst({ where: { id, centreId: scope.centreId } });
      if (!row) throw new NotFoundException('Form not found');
      return presentTemplate(row);
    });
  }

  async getTemplateVersion(admin: RequestUser, id: string, version: number) {
    const scope = assertAdmin(admin, 'see form templates');
    return this.tenancy.withTenant(scope, async (tx) => {
      const v = await tx.formTemplateVersion.findFirst({ where: { templateId: id, version: Number(version), centreId: scope.centreId } });
      if (!v) throw new NotFoundException('Form version not found');
      return { templateId: v.templateId, version: v.version, title: v.title, description: v.description, fields: v.fields as unknown as FormField[] };
    });
  }

  // ---- requests ------------------------------------------------------------------------------------------------

  async sendRequests(admin: RequestUser, dto: SendRequestsInput, now: Date = new Date()) {
    const scope = assertAdmin(admin, 'send forms');
    let recipients = Array.isArray(dto.recipients) ? dto.recipients : [];
    if (dto.childIds !== undefined) {
      if (!Array.isArray(dto.childIds) || dto.childIds.some((c) => typeof c !== 'string' || !UUID_RE.test(c))) throw new BadRequestException('childIds are not valid');
      if (dto.childIds.length > MAX_RECIPIENTS) throw new BadRequestException(`At most ${MAX_RECIPIENTS} children per send`);
      recipients = [...recipients, ...(await this.guardiansOf(scope, [...new Set(dto.childIds)], now))];
    }
    if (recipients.length < 1) throw new BadRequestException('Choose at least one recipient');
    if (recipients.length > MAX_RECIPIENTS) throw new BadRequestException(`At most ${MAX_RECIPIENTS} recipients per send`);
    if (typeof dto.templateId !== 'string' || !Number.isInteger(dto.version)) throw new BadRequestException('templateId and version are required');
    for (const r of recipients) {
      if (!r || typeof r.guardianUserId !== 'string' || typeof r.childId !== 'string') throw new BadRequestException('Each recipient needs a guardian and a child');
      if (r.supersedesSubmissionId !== undefined && typeof r.supersedesSubmissionId !== 'string') throw new BadRequestException('supersedesSubmissionId is not valid');
    }
    if (dto.dueDate !== undefined && dto.dueDate !== null && !isRealDate(dto.dueDate)) throw new BadRequestException('dueDate must be a real date (YYYY-MM-DD)');

    const unique = new Map<string, (typeof recipients)[number]>();
    for (const r of recipients) if (!unique.has(`${r.guardianUserId}|${r.childId}`)) unique.set(`${r.guardianUserId}|${r.childId}`, r);
    const list = [...unique.values()];

    const created = await this.tenancy.withTenant(scope, async (tx) => {
      const tz = await this.timezone(tx, scope);
      if (dto.dueDate && dto.dueDate < centreDateString(tz, now)) throw new BadRequestException('The due date cannot be in the past');

      const version = await tx.formTemplateVersion.findFirst({ where: { templateId: dto.templateId, version: dto.version, centreId: scope.centreId } });
      if (!version) throw new NotFoundException('That published form was not found');

      const childIds = [...new Set(list.map((r) => r.childId))];
      const guardianIds = [...new Set(list.map((r) => r.guardianUserId))];
      const children = await tx.child.findMany({ where: { id: { in: childIds }, centreId: scope.centreId, orgId: scope.orgId }, select: { id: true } });
      if (children.length !== childIds.length) throw new BadRequestException('A child is not at this centre');
      const parents = await tx.user.findMany({ where: { id: { in: guardianIds }, orgId: scope.orgId, role: 'PARENT' }, select: { id: true } });
      if (parents.length !== guardianIds.length) throw new BadRequestException('A recipient is not a parent or guardian at this organisation');
      const rels = await tx.guardianChildRelationship.findMany({
        where: { guardianUserId: { in: guardianIds }, childId: { in: childIds }, ...SIGNING_LINK, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { guardianUserId: true, childId: true },
      });
      const linked = new Set(rels.map((r) => `${r.guardianUserId}|${r.childId}`));
      if (list.some((r) => !linked.has(`${r.guardianUserId}|${r.childId}`))) throw new BadRequestException('A recipient is not a current guardian of that child');

      for (const r of list) {
        if (!r.supersedesSubmissionId) continue;
        const ok = UUID_RE.test(r.supersedesSubmissionId)
          ? await tx.formSubmission.findFirst({ where: { id: r.supersedesSubmissionId, centreId: scope.centreId, guardianUserId: r.guardianUserId, childId: r.childId }, select: { id: true } })
          : null;
        if (!ok) throw new BadRequestException('The form being corrected was not found for that guardian and child');
      }

      const dueDate = dto.dueDate ? new Date(`${dto.dueDate}T00:00:00Z`) : null;
      const rows: RequestRow[] = await tx.formRequest.createManyAndReturn({
        data: list.map((r) => ({
          ...scope,
          templateId: version.templateId,
          templateVersion: version.version,
          childId: r.childId,
          guardianUserId: r.guardianUserId,
          dueDate,
          supersedesSubmissionId: r.supersedesSubmissionId ?? null,
          createdByUserId: admin.userId,
        })),
      });
      await this.audit.recordMany(
        rows.map((row) => ({
          orgId: scope.orgId,
          centreId: scope.centreId,
          actorUserId: admin.userId,
          actorRole: admin.role,
          action: 'forms.request_sent',
          entityType: 'FormRequest',
          entityId: row.id,
          outcome: 'SUCCESS' as const,
          metadata: { templateVersion: version.version },
        })),
        tx,
      );
      return { rows, title: version.title };
    });

    // Notifications carry ids only. A queueing failure must not undo requests that are already saved.
    await this.notifications
      .enqueueMany(
        scope.orgId,
        scope.centreId,
        created.rows.map((row) => ({
          recipientUserId: row.guardianUserId,
          priority: 'ACTION_REQUIRED' as const,
          channel: 'PUSH' as const,
          payload: { type: 'form_requested', formRequestId: row.id, childId: row.childId },
        })),
      )
      .catch((e: unknown) => this.logger.warn({ msg: 'form notifications not queued', count: created.rows.length, error: e instanceof Error ? e.name : 'unknown' }));
    return created.rows.map((r) => presentRequest(r, created.title));
  }

  /** Every current, unrestricted parent or guardian (with a parent login) of the given children at this centre. */
  private async guardiansOf(scope: CentreScope, childIds: string[], now: Date): Promise<Array<{ guardianUserId: string; childId: string }>> {
    if (childIds.length === 0) return [];
    return this.tenancy.withTenant(scope, async (tx) => {
      const children = await tx.child.findMany({ where: { id: { in: childIds }, centreId: scope.centreId, orgId: scope.orgId }, select: { id: true } });
      if (children.length !== childIds.length) throw new BadRequestException('A child is not at this centre');
      const rels = await tx.guardianChildRelationship.findMany({
        where: { childId: { in: childIds }, ...SIGNING_LINK, guardian: { role: 'PARENT', orgId: scope.orgId }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { guardianUserId: true, childId: true },
      });
      const covered = new Set(rels.map((r) => r.childId));
      if (childIds.some((c) => !covered.has(c))) throw new BadRequestException('A child has no parent or guardian who can receive forms');
      return rels;
    });
  }

  private async titles(tx: Prisma.TransactionClient, scope: CentreScope, rows: RequestRow[]): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();
    const versions = await tx.formTemplateVersion.findMany({
      where: { centreId: scope.centreId, templateId: { in: [...new Set(rows.map((r) => r.templateId))] } },
      select: { templateId: true, version: true, title: true },
    });
    return new Map(versions.map((v) => [`${v.templateId}|${v.version}`, v.title]));
  }

  private statusFilter(status: unknown): FormRequestStatus | undefined {
    if (status === undefined || status === '') return undefined;
    if (status !== 'PENDING' && status !== 'SIGNED' && status !== 'CANCELLED') throw new BadRequestException('status must be PENDING, SIGNED or CANCELLED');
    return status;
  }

  /** Page size 1..500 (default 100) and an optional cursor: the id of the last row of the previous page. */
  private pageArgs(filter: { limit?: unknown; cursor?: unknown }): { take: number; cursor?: { id: string }; skip?: number } {
    let take = DEFAULT_PAGE;
    if (filter.limit !== undefined && filter.limit !== '') {
      take = Number(filter.limit);
      if (!Number.isInteger(take) || take < 1 || take > MAX_PAGE) throw new BadRequestException(`limit must be a whole number from 1 to ${MAX_PAGE}`);
    }
    if (filter.cursor === undefined || filter.cursor === '') return { take };
    if (typeof filter.cursor !== 'string' || !UUID_RE.test(filter.cursor)) throw new BadRequestException('cursor is not valid');
    return { take, cursor: { id: filter.cursor }, skip: 1 };
  }

  async listRequests(admin: RequestUser, filter: { status?: string; childId?: string; limit?: unknown; cursor?: unknown } = {}, now: Date = new Date()) {
    void now;
    const scope = assertAdmin(admin, 'see form requests');
    const status = this.statusFilter(filter.status);
    const page = this.pageArgs(filter);
    if (filter.childId !== undefined && (typeof filter.childId !== 'string' || !UUID_RE.test(filter.childId))) throw new BadRequestException('childId is not valid');
    return this.tenancy.withTenant(scope, async (tx) => {
      const rows = await tx.formRequest.findMany({
        where: { centreId: scope.centreId, ...(status ? { status } : {}), ...(filter.childId ? { childId: filter.childId } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page,
      });
      const titles = await this.titles(tx, scope, rows);
      return rows.map((r) => presentRequest(r, titles.get(`${r.templateId}|${r.templateVersion}`) ?? ''));
    });
  }

  async cancelRequest(admin: RequestUser, requestId: string, now: Date = new Date()) {
    const scope = assertAdmin(admin, 'cancel form requests');
    return this.tenancy.withTenant(scope, async (tx) => {
      const existing = await tx.formRequest.findFirst({ where: { id: requestId, centreId: scope.centreId } });
      if (!existing) throw new NotFoundException('Request not found');
      // Conditional claim: a concurrent signature or cancel cannot both win.
      const claimed = await tx.formRequest.updateMany({
        where: { id: requestId, centreId: scope.centreId, status: 'PENDING' },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledByUserId: admin.userId },
      });
      if (claimed.count === 0) throw new ConflictException('Only a pending request can be cancelled');
      await this.record(tx, admin, scope, 'forms.request_cancelled', 'FormRequest', requestId);
      const row = await tx.formRequest.findUniqueOrThrow({ where: { id: requestId } });
      const titles = await this.titles(tx, scope, [row]);
      return presentRequest(row, titles.get(`${row.templateId}|${row.templateVersion}`) ?? '');
    });
  }

  // ---- the family's side ---------------------------------------------------------------------------------------

  /** Children this guardian is currently linked to at the centre. */
  private async linkedChildIds(tx: Prisma.TransactionClient, user: RequestUser, scope: CentreScope, now: Date): Promise<string[]> {
    const links = await tx.guardianChildRelationship.findMany({
      where: { guardianUserId: user.userId, ...SIGNING_LINK, child: { centreId: scope.centreId, orgId: scope.orgId }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { childId: true },
    });
    return links.map((l) => l.childId);
  }

  async listMyRequests(parent: RequestUser, filter: { status?: string; limit?: unknown; cursor?: unknown } = {}, now: Date = new Date()) {
    const scope = this.parentScope(parent, 'see their forms');
    const status = this.statusFilter(filter.status);
    const page = this.pageArgs(filter);
    return this.tenancy.withTenant(scope, async (tx) => {
      const children = await this.linkedChildIds(tx, parent, scope, now);
      if (children.length === 0) return [];
      const rows = await tx.formRequest.findMany({
        where: { centreId: scope.centreId, guardianUserId: parent.userId, childId: { in: children }, ...(status ? { status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page,
      });
      const titles = await this.titles(tx, scope, rows);
      return rows.map((r) => presentRequest(r, titles.get(`${r.templateId}|${r.templateVersion}`) ?? ''));
    });
  }

  private async ownRequest(tx: Prisma.TransactionClient, parent: RequestUser, scope: CentreScope, id: string, now: Date) {
    const row = UUID_RE.test(id) ? await tx.formRequest.findFirst({ where: { id, centreId: scope.centreId, guardianUserId: parent.userId } }) : null;
    // Another family's request, and one whose guardian link has lapsed, look the same: not found.
    const children = row ? await this.linkedChildIds(tx, parent, scope, now) : [];
    if (!row || !children.includes(row.childId)) throw new NotFoundException('Request not found');
    return row;
  }

  async getMyRequest(parent: RequestUser, id: string, now: Date = new Date()) {
    const scope = this.parentScope(parent, 'see their forms');
    return this.tenancy.withTenant(scope, async (tx) => {
      const row = await this.ownRequest(tx, parent, scope, id, now);
      const v = await tx.formTemplateVersion.findFirst({ where: { templateId: row.templateId, version: row.templateVersion, centreId: scope.centreId } });
      if (!v) throw new NotFoundException('Request not found');
      return { ...presentRequest(row, v.title), description: v.description, fields: v.fields as unknown as FormField[] };
    });
  }

  /** Saves a drawn signature as strokes (points scaled 0..1) and returns the reference a submission must use. */
  async saveSignature(parent: RequestUser, requestId: string, dto: { strokes?: unknown }, now: Date = new Date()) {
    const scope = this.parentScope(parent, 'sign a form');
    const strokes = dto?.strokes;
    const valid =
      Array.isArray(strokes) &&
      strokes.length >= 1 &&
      strokes.length <= MAX_STROKES &&
      strokes.every(
        (st) =>
          Array.isArray(st) &&
          st.length >= 2 &&
          st.length <= MAX_POINTS &&
          st.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)),
      );
    if (!valid) throw new BadRequestException('The signature is not valid');
    return this.tenancy.withTenant(scope, async (tx) => {
      const request = await this.ownRequest(tx, parent, scope, requestId, now);
      if (request.status !== 'PENDING') throw new ConflictException('This form can no longer be signed');
      const count = await tx.formSignature.count({ where: { requestId: request.id, guardianUserId: parent.userId } });
      if (count >= MAX_SIGNATURES_PER_REQUEST) throw new BadRequestException('Too many signature attempts for this form');
      const row = await tx.formSignature.create({
        data: { ...scope, requestId: request.id, guardianUserId: parent.userId, strokes: strokes as Prisma.InputJsonValue },
      });
      await this.record(tx, parent, scope, 'forms.signature_captured', 'FormRequest', request.id, { strokeCount: (strokes as unknown[]).length });
      return { imageRef: `signatures/${row.id}` };
    });
  }

  async submitRequest(parent: RequestUser, requestId: string, dto: SubmitInput, meta: SubmitMeta = {}, now: Date = new Date()) {
    const scope = this.parentScope(parent, 'sign a form');
    return this.tenancy.withTenant(scope, async (tx) => {
      const request = await this.ownRequest(tx, parent, scope, requestId, now);
      if (request.status !== 'PENDING') throw new ConflictException(request.status === 'SIGNED' ? 'This form is already signed' : 'This request was cancelled');

      const version = await tx.formTemplateVersion.findFirst({ where: { templateId: request.templateId, version: request.templateVersion, centreId: scope.centreId } });
      if (!version) throw new NotFoundException('Request not found');
      const fields = version.fields as unknown as FormField[];

      const answers = await this.validateAnswers(tx, parent, scope, fields, dto.answers, now);
      const signatureField = fields.find((f) => f.type === 'signature');
      let signature: { typedName: string; imageRef: string } | null = null;
      if (signatureField) {
        const s = dto.signature;
        const typedName = typeof s?.typedName === 'string' ? s.typedName.trim() : '';
        const imageRef = typeof s?.imageRef === 'string' ? s.imageRef.trim() : '';
        if (!typedName || typedName.length > 200) throw new BadRequestException('Type your full name to sign');
        const sigId = SIGNATURE_REF_RE.exec(imageRef)?.[1];
        const saved = sigId ? await tx.formSignature.findFirst({ where: { id: sigId, requestId: request.id, guardianUserId: parent.userId, centreId: scope.centreId }, select: { id: true } }) : null;
        if (!saved) throw new BadRequestException('Draw your signature to sign');
        if (s?.consent !== true) throw new BadRequestException('You must agree to sign electronically');
        signature = { typedName, imageRef };
      }

      // Conditional claim: of two concurrent submits only one moves the request out of PENDING.
      const claimed = await tx.formRequest.updateMany({ where: { id: request.id, status: 'PENDING' }, data: { status: 'SIGNED', signedAt: now } });
      if (claimed.count === 0) throw new ConflictException('This form is already signed or was cancelled');

      const answersHash = computeAnswersHash(answers);
      const sub = await tx.formSubmission.create({
        data: {
          ...scope,
          requestId: request.id,
          templateId: request.templateId,
          templateVersion: request.templateVersion,
          childId: request.childId,
          guardianUserId: parent.userId,
          answers: answers as Prisma.InputJsonValue,
          answersHash,
          signerTypedName: signature?.typedName ?? null,
          signatureImageRef: signature?.imageRef ?? null,
          consentGiven: !!signature,
          signedAt: now,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ? meta.userAgent.slice(0, MAX_USER_AGENT) : null,
          supersedesSubmissionId: request.supersedesSubmissionId,
        },
      });
      await this.record(tx, parent, scope, 'forms.submission_signed', 'FormSubmission', sub.id, { templateVersion: request.templateVersion, answerCount: Object.keys(answers).length });
      return { id: sub.id, requestId: request.id, status: 'SIGNED' as const, templateVersion: request.templateVersion, signedAt: sub.signedAt, answersHash };
    });
  }

  private async validateAnswers(tx: Prisma.TransactionClient, parent: RequestUser, scope: CentreScope, fields: FormField[], input: unknown, now: Date): Promise<Record<string, unknown>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('answers must be an object');
    const given = input as Record<string, unknown>;
    const byKey = new Map(fields.map((f) => [f.key, f]));
    for (const key of Object.keys(given)) {
      const f = hasOwn(Object.fromEntries(byKey), key) ? byKey.get(key) : undefined;
      if (!f || f.type === 'signature') throw new BadRequestException(`"${key}" is not an answer on this form`);
    }
    let linked: string[] | null = null;
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === 'signature') continue;
      const v = hasOwn(given, f.key) ? given[f.key] : undefined;
      if (v === undefined || v === null) {
        if (f.required) throw new BadRequestException(`"${f.label}" is required`);
        continue;
      }
      switch (f.type) {
        case 'text':
          if (typeof v !== 'string' || v.length > MAX_TEXT_ANSWER) throw new BadRequestException(`"${f.label}" must be text of at most ${MAX_TEXT_ANSWER} characters`);
          if (f.required && !v.trim()) throw new BadRequestException(`"${f.label}" is required`);
          break;
        case 'date':
          if (!isRealDate(v)) throw new BadRequestException(`"${f.label}" must be a real date (YYYY-MM-DD)`);
          break;
        case 'yes_no':
          if (typeof v !== 'boolean') throw new BadRequestException(`"${f.label}" must be yes or no`);
          break;
        case 'choice':
          if (typeof v !== 'string' || !f.options?.includes(v)) throw new BadRequestException(`"${f.label}" must be one of the options`);
          break;
        case 'child_select':
          linked ??= await this.linkedChildIds(tx, parent, scope, now);
          if (typeof v !== 'string' || !linked.includes(v)) throw new BadRequestException(`"${f.label}" must be one of your children`);
          break;
      }
      out[f.key] = v;
    }
    return out;
  }

  /** A signed form in full, for an administrator: the answers, the pinned fields, the signature strokes and a fresh integrity check. */
  async getSubmission(admin: RequestUser, submissionId: string) {
    const scope = assertAdmin(admin, 'view a signed form');
    return this.tenancy.withTenant(scope, async (tx) => {
      const sub = UUID_RE.test(submissionId) ? await tx.formSubmission.findFirst({ where: { id: submissionId, centreId: scope.centreId } }) : null;
      if (!sub) throw new NotFoundException('Submission not found');
      const version = await tx.formTemplateVersion.findFirst({ where: { templateId: sub.templateId, version: sub.templateVersion, centreId: scope.centreId } });
      const sigId = sub.signatureImageRef ? SIGNATURE_REF_RE.exec(sub.signatureImageRef)?.[1] : undefined;
      const sig = sigId ? await tx.formSignature.findFirst({ where: { id: sigId, centreId: scope.centreId }, select: { strokes: true } }) : null;
      // Reading a signed form is itself recorded: it holds a child's consent and the guardian's signature.
      await this.record(tx, admin, scope, 'forms.submission_viewed', 'FormSubmission', sub.id);
      return {
        id: sub.id,
        requestId: sub.requestId,
        templateId: sub.templateId,
        templateVersion: sub.templateVersion,
        title: version?.title ?? '',
        fields: (version?.fields ?? []) as unknown as FormField[],
        childId: sub.childId,
        guardianUserId: sub.guardianUserId,
        answers: sub.answers as Record<string, unknown>,
        answersHash: sub.answersHash,
        valid: verifyAnswersHash(sub.answers, sub.answersHash),
        signedAt: sub.signedAt,
        signerTypedName: sub.signerTypedName,
        consentGiven: sub.consentGiven,
        supersedesSubmissionId: sub.supersedesSubmissionId,
        signature: sig ? { strokes: sig.strokes as unknown as number[][][] } : null,
      };
    });
  }

  async listSubmissions(admin: RequestUser, filter: { childId?: string } = {}) {
    const scope = assertAdmin(admin, 'see signed forms');
    if (filter.childId !== undefined && (typeof filter.childId !== 'string' || !UUID_RE.test(filter.childId))) throw new BadRequestException('childId is not valid');
    return this.tenancy.withTenant(scope, async (tx) => {
      const rows = await tx.formSubmission.findMany({
        where: { centreId: scope.centreId, ...(filter.childId ? { childId: filter.childId } : {}) },
        orderBy: { signedAt: 'desc' },
        take: 500,
      });
      const titles = await this.titles(tx, scope, rows as unknown as RequestRow[]);
      return rows.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        title: titles.get(`${r.templateId}|${r.templateVersion}`) ?? '',
        templateVersion: r.templateVersion,
        childId: r.childId,
        signedAt: r.signedAt,
        signerTypedName: r.signerTypedName,
      }));
    });
  }

  async verifySubmission(admin: RequestUser, submissionId: string) {
    const scope = assertAdmin(admin, 'verify a signed form');
    return this.tenancy.withTenant(scope, async (tx) => {
      const sub = UUID_RE.test(submissionId) ? await tx.formSubmission.findFirst({ where: { id: submissionId, centreId: scope.centreId } }) : null;
      if (!sub) throw new NotFoundException('Submission not found');
      return { submissionId: sub.id, valid: verifyAnswersHash(sub.answers, sub.answersHash), answersHash: sub.answersHash };
    });
  }
}
