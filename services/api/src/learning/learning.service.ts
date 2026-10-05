import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LearningRecord, LearningRecordKind, LearningRecordStatus, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ROLES, AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { eylfOutcome, isEylfCode } from './eylf';

const MAX_TITLE = 200;
const MAX_TEXT = 10_000;
const MAX_CHILDREN = 30;
const MAX_MEDIA = 10;
const SEARCH_LIMIT = 100;

export interface LearningDraftInput {
  /** Client-generated, so auto-save and offline sync converge on one record. */
  id: string;
  roomId: string;
  kind: LearningRecordKind;
  title?: string;
  observation?: string;
  interpretation?: string;
  outcomes?: string[];
  reflection?: string;
  nextSteps?: string;
  childIds?: string[];
  mediaAssetIds?: string[];
}

export type LearningAmendInput = Partial<Pick<LearningDraftInput, 'title' | 'observation' | 'interpretation' | 'outcomes' | 'reflection' | 'nextSteps'>>;

/** What mutations return: the stored row plus its tags. */
export type LearningRecordRow = LearningRecord & { childIds: string[]; mediaAssetIds: string[] };

export interface LearningRecordView {
  id: string;
  kind: LearningRecordKind;
  status: LearningRecordStatus;
  roomId: string;
  title: string;
  observation: string;
  interpretation: string | null;
  outcomes: { code: string; label: string; outcomeTitle: string }[];
  /** Staff only. */
  reflection?: string | null;
  nextSteps: string | null;
  children: { id: string; firstName: string }[];
  media: { id: string; url: string }[];
  author: { firstName: string };
  publishedAt: string | null;
  version: number;
  updatedAt: string;
  /** Staff only; families get an empty list. */
  history: { action: string; at: string; actor: { firstName: string }; note: string | null; snapshot: Record<string, unknown> }[];
}

export interface LearningSearchFilter {
  roomId?: string;
  childId?: string;
  outcome?: string;
  authorId?: string;
  status?: LearningRecordStatus;
  /** YYYY-MM-DD, inclusive, on creation date. */
  from?: string;
  to?: string;
}

export interface LearningSummary {
  id: string;
  kind: LearningRecordKind;
  status: LearningRecordStatus;
  title: string;
  roomId: string;
  outcomes: string[];
  childIds: string[];
  authorUserId: string;
  createdAt: string;
  publishedAt: string | null;
}

type RecordWithTags = LearningRecord & { children: { childId: string }[]; media: { mediaAssetId: string; position: number }[] };

/**
 * U2 learning in the feed (BRD v2.2 §10). Educators write observations and
 * learning stories as auto-saved drafts, submit them, and someone other than
 * the author reviews and publishes them to the tagged children's families
 * (working default, OI-23). A family only sees a story about several children
 * if the others have group consent, the same rule as group photos (ADR 0004).
 * The reflection field and the edit history never leave staff views; story
 * text never goes into audit metadata or notifications.
 */
@Injectable()
export class LearningService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
  ) {}

  async saveDraft(user: RequestUser, input: LearningDraftInput): Promise<LearningRecordRow> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertRole(user, STAFF_ROLES, 'learning.draft.save');
    if (!input.id || typeof input.id !== 'string') throw new BadRequestException('A learning record needs a client id');
    if (!['OBSERVATION', 'LEARNING_STORY'].includes(input.kind)) throw new BadRequestException('kind must be OBSERVATION or LEARNING_STORY');

    const fields = this.cleanContent(input);
    const childIds = [...new Set(input.childIds ?? [])];
    const mediaAssetIds = [...new Set(input.mediaAssetIds ?? [])];
    if (childIds.length > MAX_CHILDREN) throw new BadRequestException(`A record can tag at most ${MAX_CHILDREN} children`);
    if (mediaAssetIds.length > MAX_MEDIA) throw new BadRequestException(`A record can attach at most ${MAX_MEDIA} photos`);

    await this.assertRoomAccess(user, input.roomId);
    await this.assertCanSeeChildren(user, childIds);
    await this.assertMediaFits(user, centreId, mediaAssetIds, childIds);

    const { record, created } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, async (tx) => {
      const existing = await tx.learningRecord.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.centreId !== centreId || existing.authorUserId !== user.userId) throw new ForbiddenException('Only the author can edit this draft');
        if (existing.status !== 'DRAFT') throw new BadRequestException('Only drafts can be saved; amend a published record instead');
      }
      const data = { roomId: input.roomId, kind: input.kind, ...fields };
      const record = existing
        ? await tx.learningRecord.update({ where: { id: input.id }, data })
        : await tx.learningRecord.create({ data: { id: input.id, orgId: user.orgId as string, centreId, authorUserId: user.userId, ...data } });
      await tx.learningRecordChild.deleteMany({ where: { learningRecordId: input.id } });
      await tx.learningRecordMedia.deleteMany({ where: { learningRecordId: input.id } });
      if (childIds.length) await tx.learningRecordChild.createMany({ data: childIds.map((childId) => ({ orgId: user.orgId as string, learningRecordId: input.id, childId })) });
      if (mediaAssetIds.length) {
        await tx.learningRecordMedia.createMany({ data: mediaAssetIds.map((mediaAssetId, position) => ({ orgId: user.orgId as string, learningRecordId: input.id, mediaAssetId, position })) });
      }
      return { record, created: !existing };
    });

    // Auto-save runs constantly; audit the draft's creation, not every keystroke save.
    if (created) await this.record(user, 'learning.draft.create', record.id, { roomId: record.roomId, childCount: childIds.length });
    return { ...record, childIds, mediaAssetIds };
  }

  async submit(user: RequestUser, id: string): Promise<LearningRecordRow> {
    const rec = await this.load(user, id);
    if (rec.authorUserId !== user.userId) throw new ForbiddenException('Only the author can submit this record');
    if (rec.status !== 'DRAFT') throw new BadRequestException('Only a draft can be submitted');
    const childIds = rec.children.map((c) => c.childId);
    const missing: string[] = [];
    if (!rec.title.trim()) missing.push('a title');
    if (!rec.observation.trim()) missing.push('an observation');
    if (childIds.length === 0) missing.push('at least one child');
    if (rec.outcomes.length === 0) missing.push('at least one learning outcome');
    if (missing.length) throw new BadRequestException(`Before submitting, add ${missing.join(', ')}`);
    await this.assertCanSeeChildren(user, childIds);
    return this.transition(user, rec, { status: 'IN_REVIEW' }, 'SUBMITTED');
  }

  async publish(user: RequestUser, id: string): Promise<LearningRecordRow> {
    await this.authorization.assertRole(user, STAFF_ROLES, 'learning.publish');
    const rec = await this.load(user, id);
    if (rec.status !== 'IN_REVIEW') throw new BadRequestException('Only a record in review can be published');
    if (rec.authorUserId === user.userId) throw new ForbiddenException('Someone other than the author must review and publish this');
    const childIds = rec.children.map((c) => c.childId);
    await this.assertCanSeeChildren(user, childIds);

    const published = await this.transition(user, rec, { status: 'PUBLISHED', reviewedByUserId: user.userId, publishedAt: rec.publishedAt ?? new Date() }, 'PUBLISHED');
    await this.notifyFamilies(published);
    return published;
  }

  async returnForChanges(user: RequestUser, id: string, note?: string): Promise<LearningRecordRow> {
    await this.authorization.assertRole(user, STAFF_ROLES, 'learning.return');
    const rec = await this.load(user, id);
    if (rec.status !== 'IN_REVIEW') throw new BadRequestException('Only a record in review can be returned');
    await this.assertCanSeeChildren(user, rec.children.map((c) => c.childId));
    const clean = note?.trim().slice(0, 1000) || undefined;
    return this.transition(user, rec, { status: 'DRAFT' }, 'RETURNED', clean);
  }

  /** EDU-010: the author can correct a published record; each amendment is a new version in the history. */
  async amend(user: RequestUser, id: string, patch: LearningAmendInput): Promise<LearningRecordRow> {
    const rec = await this.load(user, id);
    if (rec.authorUserId !== user.userId) throw new ForbiddenException('Only the author can amend this record');
    if (rec.status !== 'PUBLISHED') throw new BadRequestException('Only published records are amended; edit the draft instead');
    const fields = this.cleanContent({ ...rec, ...patch } as LearningDraftInput);
    if (!fields.title.trim() || !fields.observation.trim() || fields.outcomes.length === 0) {
      throw new BadRequestException('A published record needs a title, an observation and at least one outcome');
    }
    return this.transition(user, rec, { ...fields, version: rec.version + 1 }, 'AMENDED');
  }

  async get(user: RequestUser, id: string): Promise<LearningRecordView> {
    const centreId = this.requireCentre(user);
    const rec = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.learningRecord.findUnique({ where: { id }, include: { children: true, media: { orderBy: { position: 'asc' } } } }),
    );
    if (!rec || rec.centreId !== centreId || !(await this.canSee(user, rec))) throw new NotFoundException('Learning record not found');
    return this.view(user, rec, { withHistory: user.role !== 'PARENT' });
  }

  async search(user: RequestUser, filter: LearningSearchFilter): Promise<LearningSummary[]> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertRole(user, STAFF_ROLES, 'learning.search');
    for (const d of [filter.from, filter.to]) {
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('Dates must be YYYY-MM-DD');
    }
    if (filter.outcome && !isEylfCode(filter.outcome)) throw new BadRequestException('Unknown learning outcome');
    const isAdmin = ADMIN_ROLES.includes(user.role);

    const where: Prisma.LearningRecordWhereInput = {
      centreId,
      ...(filter.roomId ? { roomId: filter.roomId } : {}),
      ...(filter.childId ? { children: { some: { childId: filter.childId } } } : {}),
      ...(filter.outcome ? { outcomes: { has: filter.outcome } } : {}),
      ...(filter.authorId ? { authorUserId: filter.authorId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? { createdAt: { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00Z`) } : {}), ...(filter.to ? { lt: new Date(new Date(`${filter.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } }
        : {}),
      // Other people's drafts are private to their author (admins excepted).
      ...(isAdmin ? {} : { OR: [{ status: { not: 'DRAFT' } }, { authorUserId: user.userId }] }),
    };
    const rows = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.learningRecord.findMany({ where, include: { children: true }, orderBy: { createdAt: 'desc' }, take: SEARCH_LIMIT }),
    );
    const allChildIds = [...new Set(rows.flatMap((r) => r.children.map((c) => c.childId)))];
    const allowed = await this.authorization.canAccessChildren(user, allChildIds, 'view');
    return rows
      .filter((r) => r.children.every((c) => allowed.has(c.childId)))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        title: r.title,
        roomId: r.roomId,
        outcomes: r.outcomes,
        childIds: r.children.map((c) => c.childId),
        authorUserId: r.authorUserId,
        createdAt: r.createdAt.toISOString(),
        publishedAt: r.publishedAt?.toISOString() ?? null,
      }));
  }

  /** A child's published learning, newest first (BRD §10 portfolio). */
  async portfolio(user: RequestUser, childId: string, range: { from?: string; to?: string }): Promise<{ child: { id: string; firstName: string; lastName: string }; items: LearningRecordView[] }> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    for (const d of [range.from, range.to]) {
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('Dates must be YYYY-MM-DD');
    }
    const { child, records } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, async (tx) => {
      const child = await tx.child.findUniqueOrThrow({ where: { id: childId }, select: { id: true, firstName: true, lastName: true } });
      const records = await tx.learningRecord.findMany({
        where: {
          centreId,
          status: 'PUBLISHED',
          children: { some: { childId } },
          ...(range.from || range.to
            ? { publishedAt: { ...(range.from ? { gte: new Date(`${range.from}T00:00:00Z`) } : {}), ...(range.to ? { lt: new Date(new Date(`${range.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } }
            : {}),
        },
        include: { children: true, media: { orderBy: { position: 'asc' } } },
        orderBy: { publishedAt: 'desc' },
        take: 500,
      });
      return { child, records };
    });

    const items: LearningRecordView[] = [];
    for (const r of records) {
      if (await this.canSee(user, r)) items.push(await this.view(user, r, { withHistory: false }));
    }
    return { child, items };
  }

  /** Published records tagging a child, for the family feed (same visibility rules as get). */
  async publishedForChild(user: RequestUser, childId: string, before: Date, take: number): Promise<LearningRecordView[]> {
    const centreId = this.requireCentre(user);
    const records = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.learningRecord.findMany({
        where: { centreId, status: 'PUBLISHED', publishedAt: { lt: before }, children: { some: { childId } } },
        include: { children: true, media: { orderBy: { position: 'asc' } } },
        orderBy: { publishedAt: 'desc' },
        take,
      }),
    );
    const out: LearningRecordView[] = [];
    for (const r of records) {
      if (await this.canSee(user, r)) out.push(await this.view(user, r, { withHistory: false }));
    }
    return out;
  }

  // ---------------------------------------------------------------- internals

  private requireCentre(user: RequestUser): string {
    if (!user.orgId || !user.centreId) throw new ForbiddenException('Learning records need a centre context');
    return user.centreId;
  }

  private cleanContent(input: LearningDraftInput) {
    const text = (v: string | null | undefined, max: number, label: string) => {
      const t = (v ?? '').trim();
      if (t.length > max) throw new BadRequestException(`${label} is limited to ${max} characters`);
      return t;
    };
    const outcomes = [...new Set(input.outcomes ?? [])];
    const unknown = outcomes.filter((o) => !isEylfCode(o));
    if (unknown.length) throw new BadRequestException(`Unknown learning outcome: ${unknown.join(', ')}`);
    return {
      title: text(input.title, MAX_TITLE, 'Title'),
      observation: text(input.observation, MAX_TEXT, 'Observation'),
      interpretation: text(input.interpretation, MAX_TEXT, 'Interpretation') || null,
      outcomes: outcomes.sort(),
      reflection: text(input.reflection, MAX_TEXT, 'Reflection') || null,
      nextSteps: text(input.nextSteps, MAX_TEXT, 'Next steps') || null,
    };
  }

  private async assertRoomAccess(user: RequestUser, roomId: string): Promise<void> {
    const centreId = this.requireCentre(user);
    const room = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.room.findFirst({ where: { id: roomId, centreId }, select: { id: true } }),
    );
    if (!room) throw new BadRequestException('That room is not in your centre');
    if (user.role === 'EDUCATOR' && !(await this.authorization.activeRoomIds(user)).includes(roomId)) {
      throw new ForbiddenException('You are not assigned to this room');
    }
  }

  private async assertCanSeeChildren(user: RequestUser, childIds: string[]): Promise<void> {
    if (childIds.length === 0) return;
    const allowed = await this.authorization.canAccessChildren(user, childIds, 'view');
    if (childIds.some((id) => !allowed.has(id))) throw new ForbiddenException('You can only write about children you care for');
  }

  /** Every photo must be one this user can see, from this centre, showing only children the record is about. */
  private async assertMediaFits(user: RequestUser, centreId: string, mediaAssetIds: string[], childIds: string[]): Promise<void> {
    if (mediaAssetIds.length === 0) return;
    const assets = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.mediaAsset.findMany({ where: { id: { in: mediaAssetIds }, centreId }, include: { childTags: true } }),
    );
    if (assets.length !== mediaAssetIds.length) throw new BadRequestException('Every photo must belong to your centre');
    const tagged = new Set(childIds);
    for (const a of assets) {
      if (a.childTags.length === 0 || a.childTags.some((t) => !tagged.has(t.childId))) {
        throw new BadRequestException('A photo shows a child this record is not about; tag them or choose another photo');
      }
      if (!(await this.media.canView(user, a.id))) throw new ForbiddenException('You can only attach photos you can see');
    }
  }

  private async load(user: RequestUser, id: string): Promise<RecordWithTags> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertRole(user, STAFF_ROLES, 'learning.workflow');
    const rec = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.learningRecord.findUnique({ where: { id }, include: { children: true, media: { orderBy: { position: 'asc' } } } }),
    );
    if (!rec || rec.centreId !== centreId) throw new NotFoundException('Learning record not found');
    if (rec.status === 'DRAFT' && rec.authorUserId !== user.userId && !ADMIN_ROLES.includes(user.role)) {
      throw new NotFoundException('Learning record not found');
    }
    return rec;
  }

  private async transition(
    user: RequestUser,
    rec: RecordWithTags,
    data: Prisma.LearningRecordUncheckedUpdateInput,
    action: 'SUBMITTED' | 'PUBLISHED' | 'RETURNED' | 'AMENDED',
    note?: string,
  ): Promise<LearningRecordRow> {
    const updated = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: rec.centreId }, async (tx) => {
      // Guard against a concurrent transition: only move from the state we checked.
      const moved = await tx.learningRecord.updateMany({ where: { id: rec.id, status: rec.status, version: rec.version }, data });
      if (moved.count !== 1) throw new BadRequestException('This record changed while you were working on it; reload and try again');
      const r = await tx.learningRecord.findUniqueOrThrow({ where: { id: rec.id } });
      await tx.learningRecordEvent.create({
        data: { orgId: r.orgId, learningRecordId: r.id, action, actorUserId: user.userId, note: note ?? null, snapshot: this.snapshot(r, rec) },
      });
      return r;
    });
    await this.record(user, `learning.${action.toLowerCase()}`, rec.id, { status: updated.status, version: updated.version, childCount: rec.children.length });
    return { ...updated, childIds: rec.children.map((c) => c.childId), mediaAssetIds: rec.media.map((m) => m.mediaAssetId) };
  }

  private snapshot(r: LearningRecord, tags: RecordWithTags): Prisma.InputJsonObject {
    return {
      kind: r.kind,
      status: r.status,
      version: r.version,
      title: r.title,
      observation: r.observation,
      interpretation: r.interpretation,
      outcomes: r.outcomes,
      reflection: r.reflection,
      nextSteps: r.nextSteps,
      childIds: tags.children.map((c) => c.childId),
      mediaAssetIds: tags.media.map((m) => m.mediaAssetId),
    };
  }

  /**
   * Staff: published or in-review records about children they can see; drafts
   * only their own (admins all). Families: published records where they are a
   * guardian of a tagged child with access, and every other tagged child has
   * group consent (ADR 0004 rule, applied to learning text as well as photos).
   */
  private async canSee(user: RequestUser, rec: RecordWithTags): Promise<boolean> {
    const childIds = rec.children.map((c) => c.childId);
    if (user.role !== 'PARENT') {
      if (!STAFF_ROLES.includes(user.role)) return false;
      if (rec.status === 'DRAFT' && rec.authorUserId !== user.userId && !ADMIN_ROLES.includes(user.role)) return false;
      const allowed = await this.authorization.canAccessChildren(user, childIds, 'view');
      return childIds.every((id) => allowed.has(id));
    }
    if (rec.status !== 'PUBLISHED' || childIds.length === 0) return false;
    return this.familyCanSee(user, rec.centreId, childIds);
  }

  private async familyCanSee(user: RequestUser, centreId: string, childIds: string[]): Promise<boolean> {
    const { related, others } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, async (tx) => {
      // Any relationship at all, even restricted or expired: that guardian must
      // never see the child through another family's consent.
      const rels = await tx.guardianChildRelationship.findMany({ where: { guardianUserId: user.userId, childId: { in: childIds } }, select: { childId: true } });
      const related = new Set(rels.map((r) => r.childId));
      const others = await tx.child.findMany({ where: { id: { in: childIds.filter((id) => !related.has(id)) } }, select: { id: true, groupPhotoConsent: true } });
      return { related, others };
    });
    if (related.size === 0) return false;
    const allowed = await this.authorization.canAccessChildren(user, [...related], 'view');
    if ([...related].some((id) => !allowed.has(id))) return false;
    const otherIds = childIds.filter((id) => !related.has(id));
    if (others.length !== otherIds.length) return false;
    return others.every((c) => c.groupPhotoConsent);
  }

  private async view(user: RequestUser, rec: RecordWithTags, opts: { withHistory: boolean }): Promise<LearningRecordView> {
    const isStaff = user.role !== 'PARENT';
    const { children, names, events } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: rec.centreId }, async (tx) => {
      const children = await tx.child.findMany({ where: { id: { in: rec.children.map((c) => c.childId) } }, select: { id: true, firstName: true } });
      const events = opts.withHistory ? await tx.learningRecordEvent.findMany({ where: { learningRecordId: rec.id }, orderBy: { createdAt: 'asc' } }) : [];
      const userIds = [rec.authorUserId, ...events.map((e) => e.actorUserId)];
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, firstName: true } });
      return { children, names: new Map(users.map((u) => [u.id, u.firstName])), events };
    });

    // Photos the viewer can't see (e.g. media permission off for their child) are left out, not the whole record.
    const media: { id: string; url: string }[] = [];
    for (const m of rec.media) {
      if (await this.media.canView(user, m.mediaAssetId)) media.push({ id: m.mediaAssetId, url: (await this.media.getViewUrl(user, m.mediaAssetId)).url });
    }

    return {
      id: rec.id,
      kind: rec.kind,
      status: rec.status,
      roomId: rec.roomId,
      title: rec.title,
      observation: rec.observation,
      interpretation: rec.interpretation,
      outcomes: rec.outcomes.map((code) => {
        const o = eylfOutcome(code);
        return { code, label: o?.label ?? code, outcomeTitle: o?.outcomeTitle ?? '' };
      }),
      ...(isStaff ? { reflection: rec.reflection } : {}),
      nextSteps: rec.nextSteps,
      children: children.map((c) => ({ id: c.id, firstName: c.firstName })),
      media,
      author: { firstName: names.get(rec.authorUserId) ?? 'Educator' },
      publishedAt: rec.publishedAt?.toISOString() ?? null,
      version: rec.version,
      updatedAt: rec.updatedAt.toISOString(),
      history: events.map((e) => ({
        action: e.action,
        at: e.createdAt.toISOString(),
        actor: { firstName: names.get(e.actorUserId) ?? 'Staff' },
        note: e.note,
        snapshot: e.snapshot as Record<string, unknown>,
      })),
    };
  }

  private async notifyFamilies(rec: LearningRecordRow): Promise<void> {
    const rels = await this.tenancy.withTenant({ orgId: rec.orgId, centreId: rec.centreId }, (tx) =>
      tx.guardianChildRelationship.findMany({ where: { childId: { in: rec.childIds } }, select: { guardianUserId: true, childId: true } }),
    );
    const firstChildByGuardian = new Map<string, string>();
    for (const r of rels) if (!firstChildByGuardian.has(r.guardianUserId)) firstChildByGuardian.set(r.guardianUserId, r.childId);

    for (const [guardianUserId, childId] of firstChildByGuardian) {
      const guardian: RequestUser = { userId: guardianUserId, orgId: rec.orgId, centreId: rec.centreId, role: 'PARENT', sessionId: 'system:learning-notify' };
      if (!(await this.familyCanSee(guardian, rec.centreId, rec.childIds))) continue;
      await this.notifications.enqueue({
        orgId: rec.orgId,
        centreId: rec.centreId,
        recipientUserId: guardianUserId,
        priority: 'CHILD_UPDATE',
        channel: 'PUSH',
        payload: { type: 'learning_published', learningRecordId: rec.id, childId },
      });
    }
  }

  private record(user: RequestUser, action: string, entityId: string, metadata: Record<string, unknown>) {
    return this.audit.record({
      orgId: user.orgId as string,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action,
      entityType: 'LearningRecord',
      entityId,
      outcome: 'SUCCESS',
      metadata,
    });
  }
}
