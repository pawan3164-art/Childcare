import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { addDaysToDate, centreDateString, isRealDate, startOfCentreDate } from '../common/time/centre-day';
import { assertAdmin, centreScope, parentChildRooms, CentreScope } from '../common/centre-access';

const DEFAULT_DAYS = 60;
const MAX_RANGE_DAYS = 366;

export interface EventInput {
  title?: string;
  description?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  allDay?: boolean;
  roomId?: string | null;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  roomId: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

function present(e: EventRow) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    roomId: e.roomId,
    cancelledAt: e.cancelledAt,
    cancelReason: e.cancelReason,
  };
}

function title(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length < 1 || v.length > 200) throw new BadRequestException('Title must be 1 to 200 characters');
  return v;
}

function description(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  if (v.length > 2000) throw new BadRequestException('Description must be at most 2000 characters');
  return v || null;
}

function instant(value: unknown, label: string): Date {
  const d = typeof value === 'string' ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw new BadRequestException(`${label} must be a valid date and time`);
  return d;
}

/**
 * Centre calendar (U4b). Events are never deleted: a cancelled event stays visible, marked cancelled with the reason,
 * so families are not left guessing. The audit log holds ids and categories only, never titles or reasons.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async timezone(tx: Prisma.TransactionClient, scope: CentreScope): Promise<string> {
    const centre = await tx.centre.findFirst({ where: { id: scope.centreId }, select: { timezone: true } });
    return centre?.timezone ?? 'Australia/Sydney';
  }

  private async roomInCentre(tx: Prisma.TransactionClient, scope: CentreScope, roomId: string) {
    const room = await tx.room.findFirst({ where: { id: roomId, centreId: scope.centreId, orgId: scope.orgId }, select: { id: true } });
    if (!room) throw new BadRequestException('That room does not belong to this centre');
  }

  /** Written in the change's own transaction: no committed change without its audit entry. */
  private record(tx: Prisma.TransactionClient, admin: RequestUser, scope: CentreScope, action: string, id: string, metadata: Record<string, unknown> = {}) {
    return this.audit.record(
      { orgId: scope.orgId, centreId: scope.centreId, actorUserId: admin.userId, actorRole: admin.role, action, entityType: 'CentreEvent', entityId: id, outcome: 'SUCCESS', metadata },
      tx,
    );
  }

  async listEvents(user: RequestUser, range: { from?: string; to?: string } = {}, now: Date = new Date()) {
    const scope = centreScope(user);
    if (range.from !== undefined && !isRealDate(range.from)) throw new BadRequestException('from must be a real date (YYYY-MM-DD)');
    if (range.to !== undefined && !isRealDate(range.to)) throw new BadRequestException('to must be a real date (YYYY-MM-DD)');

    return this.tenancy.withTenant(scope, async (tx) => {
      const tz = await this.timezone(tx, scope);
      const from = range.from ?? centreDateString(tz, now);
      const to = range.to ?? addDaysToDate(from, DEFAULT_DAYS);
      if (to < from) throw new BadRequestException('to must not be before from');
      if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_RANGE_DAYS) {
        throw new BadRequestException(`The range can be at most ${MAX_RANGE_DAYS} days`);
      }

      // Families see centre-wide events plus those of the rooms their children are in.
      let roomFilter: Prisma.CentreEventWhereInput = {};
      if (user.role === 'PARENT') {
        const rooms = await parentChildRooms(tx, user, scope, now);
        if (rooms.length === 0) return [];
        roomFilter = { OR: [{ roomId: null }, { roomId: { in: rooms.filter((r): r is string => !!r) } }] };
      }

      const rows = await tx.centreEvent.findMany({
        where: {
          centreId: scope.centreId,
          startsAt: { gte: startOfCentreDate(tz, from), lt: startOfCentreDate(tz, addDaysToDate(to, 1)) },
          ...roomFilter,
        },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map(present);
    });
  }

  async createEvent(admin: RequestUser, dto: EventInput, now: Date = new Date()) {
    void now;
    const scope = assertAdmin(admin, 'change the calendar');
    const t = title(dto.title);
    const desc = description(dto.description);
    const startsAt = instant(dto.startsAt, 'startsAt');
    const endsAt = dto.endsAt ? instant(dto.endsAt, 'endsAt') : null;
    if (endsAt && endsAt < startsAt) throw new BadRequestException('The event cannot end before it starts');

    return this.tenancy.withTenant(scope, async (tx) => {
      if (dto.roomId) await this.roomInCentre(tx, scope, dto.roomId);
      const row = await tx.centreEvent.create({
        data: { ...scope, title: t, description: desc, startsAt, endsAt, allDay: !!dto.allDay, roomId: dto.roomId || null, createdByUserId: admin.userId },
      });
      await this.record(tx, admin, scope, 'calendar.event_created', row.id, { roomScoped: !!row.roomId });
      return present(row);
    });
  }

  async updateEvent(admin: RequestUser, id: string, dto: EventInput, now: Date = new Date()) {
    void now;
    const scope = assertAdmin(admin, 'change the calendar');
    return this.tenancy.withTenant(scope, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('calendar-event'), hashtext(${id}))`;
      const current = await tx.centreEvent.findFirst({ where: { id, centreId: scope.centreId } });
      if (!current) throw new NotFoundException('Event not found');
      if (current.cancelledAt) throw new ConflictException('A cancelled event cannot be changed');

      const next = {
        title: dto.title !== undefined ? title(dto.title) : current.title,
        description: dto.description !== undefined ? description(dto.description) : current.description,
        startsAt: dto.startsAt !== undefined ? instant(dto.startsAt, 'startsAt') : current.startsAt,
        endsAt: dto.endsAt !== undefined ? (dto.endsAt ? instant(dto.endsAt, 'endsAt') : null) : current.endsAt,
        allDay: dto.allDay !== undefined ? !!dto.allDay : current.allDay,
        roomId: dto.roomId !== undefined ? dto.roomId || null : current.roomId,
      };
      if (next.endsAt && next.endsAt < next.startsAt) throw new BadRequestException('The event cannot end before it starts');
      if (next.roomId && next.roomId !== current.roomId) await this.roomInCentre(tx, scope, next.roomId);

      const row = await tx.centreEvent.update({ where: { id }, data: next });
      await this.record(tx, admin, scope, 'calendar.event_updated', id, { roomScoped: !!row.roomId });
      return present(row);
    });
  }

  async cancelEvent(admin: RequestUser, id: string, reason: string, now: Date = new Date()) {
    const scope = assertAdmin(admin, 'change the calendar');
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length < 1 || why.length > 500) throw new BadRequestException('A reason of up to 500 characters is required');

    return this.tenancy.withTenant(scope, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('calendar-event'), hashtext(${id}))`;
      const current = await tx.centreEvent.findFirst({ where: { id, centreId: scope.centreId } });
      if (!current) throw new NotFoundException('Event not found');
      // Conditional on still being active, so the first reason can never be overwritten.
      const changed = await tx.centreEvent.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: now, cancelledByUserId: admin.userId, cancelReason: why } });
      if (changed.count !== 1) throw new ConflictException('This event has already been cancelled');
      await this.record(tx, admin, scope, 'calendar.event_cancelled', id);
      return present({ ...current, cancelledAt: now, cancelReason: why });
    });
  }
}
