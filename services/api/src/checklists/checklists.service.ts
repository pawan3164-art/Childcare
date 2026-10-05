import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChecklistCompletion, ChecklistTemplate, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ROLES, AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { startOfCentreDay } from '../common/time/centre-day';
import { plausibleClientTime } from '../common/time/client-time';

const MAX_ITEMS = 50;
const MAX_LABEL = 200;
const MAX_NOTE = 1000;
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export type ChecklistResult = 'PASS' | 'FAIL' | 'NA';

export interface ChecklistItem {
  id: string;
  label: string;
}

export interface ChecklistTemplateView {
  id: string;
  name: string;
  roomId: string | null;
  items: ChecklistItem[];
}

export interface CompletionResult {
  itemId: string;
  label: string;
  result: ChecklistResult;
  note?: string;
}

export interface CompleteChecklistInput {
  /** Client-generated, so a retry or an offline replay converges on one row. */
  id: string;
  templateId: string;
  roomId: string;
  results: { itemId: string; result: ChecklistResult; note?: string }[];
  /** Only honoured from offline sync, where the check happened before upload. */
  completedAt?: string;
}

export interface CompletionView {
  id: string;
  templateId: string;
  templateName: string;
  roomId: string;
  completedAt: string;
  /** When the server received it; differs from completedAt for offline completions. */
  recordedAt: string;
  completedBy: { firstName: string };
  failedCount: number;
  results: CompletionResult[];
}

export interface RoomChecklist {
  template: ChecklistTemplateView;
  /** Today's most recent completion in this room, or null if not done yet today. */
  lastCompletion: { id: string; completedAt: string; completedBy: { firstName: string }; failedCount: number } | null;
}

/** What sync needs to apply a completion inside its own transaction. */
export interface PreparedCompletion {
  data: Prisma.ChecklistCompletionUncheckedCreateInput;
}

/**
 * U1 room checklists (BRD v2.2 CMP-003). Admins configure templates per room
 * or for the whole centre; staff complete them (directly or via offline sync).
 * Completions are append-only (CMP-009) and snapshot the item labels. A failed
 * item alerts the responsible people: the centre's admins, until the
 * responsible-person log (CMP-004, Phase 2E) exists. Notes are never put in
 * notifications or audit entries; those carry ids and counts only.
 */
@Injectable()
export class ChecklistsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  async createTemplate(user: RequestUser, input: { name: string; roomId?: string; items: string[] }): Promise<ChecklistTemplateView> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertRole(user, ADMIN_ROLES, 'checklist.template.create');
    const name = (input.name ?? '').trim();
    if (!name || name.length > MAX_LABEL) throw new BadRequestException('A checklist needs a name');
    const labels = (input.items ?? []).map((l) => (l ?? '').trim()).filter(Boolean);
    if (labels.length === 0 || labels.length > MAX_ITEMS) throw new BadRequestException(`A checklist needs between 1 and ${MAX_ITEMS} items`);
    if (labels.some((l) => l.length > MAX_LABEL)) throw new BadRequestException(`Items are limited to ${MAX_LABEL} characters`);
    const items: ChecklistItem[] = labels.map((label) => ({ id: randomUUID(), label }));

    const template = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, async (tx) => {
      if (input.roomId) {
        const room = await tx.room.findFirst({ where: { id: input.roomId, centreId }, select: { id: true } });
        if (!room) throw new BadRequestException('That room is not in your centre');
      }
      return tx.checklistTemplate.create({
        data: { orgId: user.orgId as string, centreId, roomId: input.roomId ?? null, name, items: items as unknown as Prisma.InputJsonArray, createdByUserId: user.userId },
      });
    });

    await this.audit.record({
      orgId: user.orgId as string,
      centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'checklist.template.create',
      entityType: 'ChecklistTemplate',
      entityId: template.id,
      outcome: 'SUCCESS',
      metadata: { roomId: template.roomId, itemCount: items.length },
    });
    return this.templateView(template);
  }

  async archiveTemplate(user: RequestUser, templateId: string): Promise<void> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertRole(user, ADMIN_ROLES, 'checklist.template.archive');
    await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, async (tx) => {
      const t = await tx.checklistTemplate.findFirst({ where: { id: templateId, centreId } });
      if (!t) throw new NotFoundException('Checklist not found');
      await tx.checklistTemplate.update({ where: { id: templateId }, data: { active: false } });
    });
    await this.audit.record({
      orgId: user.orgId as string,
      centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'checklist.template.archive',
      entityType: 'ChecklistTemplate',
      entityId: templateId,
      outcome: 'SUCCESS',
    });
  }

  /** Every active template in the centre (admin setup screen). */
  async listTemplates(user: RequestUser): Promise<ChecklistTemplateView[]> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertRole(user, STAFF_ROLES, 'checklist.template.list');
    const templates = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.checklistTemplate.findMany({ where: { centreId, active: true }, orderBy: { createdAt: 'asc' } }),
    );
    return templates.map((t) => this.templateView(t));
  }

  /** The checklists that apply to a room, with whether each was done today. */
  async roomChecklists(user: RequestUser, roomId: string): Promise<RoomChecklist[]> {
    const centreId = this.requireCentre(user);
    await this.assertRoomAccess(user, roomId);

    const { templates, latest, names } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, async (tx) => {
      const centre = await tx.centre.findUniqueOrThrow({ where: { id: centreId }, select: { timezone: true } });
      const since = startOfCentreDay(centre.timezone);
      const templates = await tx.checklistTemplate.findMany({
        where: { centreId, active: true, OR: [{ roomId }, { roomId: null }] },
        orderBy: { createdAt: 'asc' },
      });
      const today = await tx.checklistCompletion.findMany({
        where: { roomId, completedAt: { gte: since }, templateId: { in: templates.map((t) => t.id) } },
        orderBy: { completedAt: 'desc' },
      });
      const latest = new Map<string, ChecklistCompletion>();
      for (const c of today) if (!latest.has(c.templateId)) latest.set(c.templateId, c);
      const names = await this.firstNames(tx, [...latest.values()].map((c) => c.completedByUserId));
      return { templates, latest, names };
    });

    return templates.map((t) => {
      const c = latest.get(t.id);
      return {
        template: this.templateView(t),
        lastCompletion: c
          ? { id: c.id, completedAt: c.completedAt.toISOString(), completedBy: { firstName: names.get(c.completedByUserId) ?? 'Staff' }, failedCount: c.failedCount }
          : null,
      };
    });
  }

  async complete(user: RequestUser, input: CompleteChecklistInput): Promise<ChecklistCompletion> {
    const prepared = await this.prepareCompletion(user, { ...input, completedAt: undefined });
    let created: ChecklistCompletion | null = null;
    try {
      created = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, (tx) => this.insertCompletion(tx, prepared));
    } catch (err) {
      // Same client id already stored: a retry. Return the original and don't alert twice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        // Only the same person's own retry gets the stored completion back.
        const mine = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, (tx) =>
          tx.checklistCompletion.findFirst({ where: { id: input.id, centreId: user.centreId as string, completedByUserId: user.userId } }),
        );
        if (mine) return mine;
        throw new ConflictException('That completion id is already in use');
      }
      throw err;
    }
    await this.afterCompletion(user, created, { viaOfflineSync: false });
    return created;
  }

  /**
   * Validation and access checks, run outside any write transaction (the
   * sync engine calls this before opening its own; see SyncService).
   */
  async prepareCompletion(user: RequestUser, input: CompleteChecklistInput): Promise<PreparedCompletion> {
    const centreId = this.requireCentre(user);
    if (!input.id || typeof input.id !== 'string') throw new BadRequestException('A completion needs a client id');
    // Sync payloads skip the REST DTO, so check the shape here for both paths.
    if (typeof input.templateId !== 'string' || !input.templateId) throw new BadRequestException('A completion needs a templateId');
    if (typeof input.roomId !== 'string' || !input.roomId) throw new BadRequestException('A completion needs a roomId');
    if (!Array.isArray(input.results)) throw new BadRequestException('results must be a list');
    for (const r of input.results) {
      if (!r || typeof r !== 'object' || typeof r.itemId !== 'string') throw new BadRequestException('Each result needs an itemId');
      if (r.note !== undefined && r.note !== null && typeof r.note !== 'string') throw new BadRequestException('A result note must be text');
    }
    await this.assertRoomAccess(user, input.roomId);

    const template = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.checklistTemplate.findFirst({ where: { id: input.templateId, centreId, active: true } }),
    );
    if (!template) throw new NotFoundException('Checklist not found');
    if (template.roomId && template.roomId !== input.roomId) throw new BadRequestException('This checklist belongs to a different room');

    const items = (template.items as unknown as ChecklistItem[]) ?? [];
    const byItem = new Map((input.results ?? []).map((r) => [r.itemId, r]));
    if (byItem.size !== (input.results ?? []).length) throw new BadRequestException('Each item can only be answered once');
    for (const id of byItem.keys()) {
      if (!items.some((i) => i.id === id)) throw new BadRequestException('Answer contains an item that is not on this checklist');
    }
    if (items.some((i) => !byItem.has(i.id))) throw new BadRequestException('Answer every item before submitting');

    const results: CompletionResult[] = items.map((item) => {
      const r = byItem.get(item.id) as { result: ChecklistResult; note?: string };
      if (!['PASS', 'FAIL', 'NA'].includes(r.result)) throw new BadRequestException('Each result must be PASS, FAIL or NA');
      const note = r.note?.trim();
      if (note && note.length > MAX_NOTE) throw new BadRequestException(`Notes are limited to ${MAX_NOTE} characters`);
      if (r.result === 'FAIL' && !note) throw new BadRequestException(`Add a note saying what was wrong with "${item.label}"`);
      return { itemId: item.id, label: item.label, result: r.result, ...(note ? { note } : {}) };
    });

    // Offline completions keep their real time, within the 72-hour offline window.
    const completedAt = input.completedAt ? plausibleClientTime(input.completedAt, 'completedAt') : new Date();

    return {
      data: {
        id: input.id,
        orgId: user.orgId as string,
        centreId,
        roomId: input.roomId,
        templateId: template.id,
        templateName: template.name,
        results: results as unknown as Prisma.InputJsonArray,
        failedCount: results.filter((r) => r.result === 'FAIL').length,
        completedByUserId: user.userId,
        completedAt,
      },
    };
  }

  insertCompletion(tx: Prisma.TransactionClient, prepared: PreparedCompletion): Promise<ChecklistCompletion> {
    return tx.checklistCompletion.create({ data: prepared.data });
  }

  /** Audit, then alert the responsible people about failures. Call only after the insert committed. */
  async afterCompletion(user: RequestUser, completion: ChecklistCompletion, opts: { viaOfflineSync: boolean }): Promise<void> {
    await this.audit.record({
      orgId: completion.orgId,
      centreId: completion.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'checklist.complete',
      entityType: 'ChecklistCompletion',
      entityId: completion.id,
      outcome: 'SUCCESS',
      metadata: {
        templateId: completion.templateId,
        roomId: completion.roomId,
        failedCount: completion.failedCount,
        viaOfflineSync: opts.viaOfflineSync,
        completedAt: completion.completedAt.toISOString(),
        lateByMinutes: Math.max(0, Math.round((completion.createdAt.getTime() - completion.completedAt.getTime()) / 60_000)),
      },
    });
    if (completion.failedCount === 0) return;

    const admins = await this.tenancy.withTenant({ orgId: completion.orgId, centreId: completion.centreId }, (tx) =>
      tx.user.findMany({ where: { centreId: completion.centreId, role: 'CENTRE_ADMIN' }, select: { id: true } }),
    );
    for (const admin of admins) {
      await this.notifications.enqueue({
        orgId: completion.orgId,
        centreId: completion.centreId,
        recipientUserId: admin.id,
        priority: 'ACTION_REQUIRED',
        channel: 'PUSH',
        payload: { type: 'checklist_failure', completionId: completion.id, roomId: completion.roomId, templateId: completion.templateId, failedCount: completion.failedCount },
      });
    }
  }

  /** Completion history, newest first. Staff only; educators see only their rooms. */
  async completions(user: RequestUser, filter: { roomId: string; date?: string }): Promise<CompletionView[]> {
    const centreId = this.requireCentre(user);
    await this.assertRoomAccess(user, filter.roomId);
    if (filter.date && !/^\d{4}-\d{2}-\d{2}$/.test(filter.date)) throw new BadRequestException('date must be YYYY-MM-DD');

    const { rows, names } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, async (tx) => {
      let range: { gte: Date; lt: Date } | undefined;
      if (filter.date) {
        const { timezone } = await tx.centre.findUniqueOrThrow({ where: { id: centreId }, select: { timezone: true } });
        const start = startOfCentreDay(timezone, new Date(`${filter.date}T12:00:00Z`));
        range = { gte: start, lt: startOfCentreDay(timezone, new Date(start.getTime() + 36 * 3600 * 1000)) };
      }
      const rows = await tx.checklistCompletion.findMany({
        where: { roomId: filter.roomId, ...(range ? { completedAt: range } : {}) },
        orderBy: { completedAt: 'desc' },
        take: 100,
      });
      return { rows, names: await this.firstNames(tx, rows.map((r) => r.completedByUserId)) };
    });

    return rows.map((r) => ({
      id: r.id,
      templateId: r.templateId,
      templateName: r.templateName,
      roomId: r.roomId,
      completedAt: r.completedAt.toISOString(),
      recordedAt: r.createdAt.toISOString(),
      completedBy: { firstName: names.get(r.completedByUserId) ?? 'Staff' },
      failedCount: r.failedCount,
      results: r.results as unknown as CompletionResult[],
    }));
  }

  private requireCentre(user: RequestUser): string {
    if (!user.orgId || !user.centreId) throw new ForbiddenException('Checklists need a centre context');
    return user.centreId;
  }

  /** Staff only; the room must be in the user's centre, and an educator must be assigned to it. */
  private async assertRoomAccess(user: RequestUser, roomId: string): Promise<void> {
    const centreId = this.requireCentre(user);
    await this.authorization.assertRole(user, STAFF_ROLES, 'checklist.room_access');
    const room = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.room.findFirst({ where: { id: roomId, centreId }, select: { id: true } }),
    );
    if (!room) throw new NotFoundException('Room not found');
    if (user.role === 'EDUCATOR' && !(await this.authorization.activeRoomIds(user)).includes(roomId)) {
      throw new ForbiddenException('You are not assigned to this room');
    }
  }

  private templateView(t: ChecklistTemplate): ChecklistTemplateView {
    return { id: t.id, name: t.name, roomId: t.roomId, items: t.items as unknown as ChecklistItem[] };
  }

  private async firstNames(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true } });
    return new Map(users.map((u) => [u.id, u.firstName]));
  }
}
