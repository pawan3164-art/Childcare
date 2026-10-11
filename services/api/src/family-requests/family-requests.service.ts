import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Absence, CasualDayRequest, PickupNomination, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ROLES, AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { NotificationsService } from '../notifications/notifications.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const MAX_REASON = 500;
const MAX_NOTE = 500;
const MAX_PICKUP_NOTE = 300;
const MAX_ACTIVE_NOMINATIONS_PER_DAY = 3;
const PHONE = /^[0-9+()\- ]{6,20}$/;
const FAMILY_AND_ADMIN = ['PARENT', ...ADMIN_ROLES] as RequestUser['role'][];

export interface AbsenceView {
  id: string;
  childId: string;
  date: string;
  isAllowable: boolean;
  reason: string | null;
  reportedByParent: boolean;
  createdAt: string;
}

export interface CasualDayRequestView {
  id: string;
  childId: string;
  date: string;
  status: CasualDayRequest['status'];
  note: string | null;
  declineReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface PickupNominationView {
  id: string;
  childId: string;
  date: string;
  personName: string;
  personPhone: string | null;
  note: string | null;
  status: PickupNomination['status'];
  verified: boolean;
  createdAt: string;
}

type ChildSummary = { id: string; firstName: string; lastName: string };

const dayString = (d: Date) => d.toISOString().slice(0, 10);

// Control characters (except tab and newline) and bidirectional overrides: they can break storage or make a name look like something else on a staff screen.
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** Cleaned and trimmed text, or null when nothing is left. Length limits apply to what is stored. */
const cleanText = (value: string | undefined | null): string | null => {
  const cleaned = (value ?? '').replace(UNSAFE_TEXT, '').trim();
  return cleaned ? cleaned : null;
};
const MAX_RANGE_DAYS = 366;

/** The centre-local calendar date (YYYY-MM-DD) at `now`. Servers run in UTC, so never use the UTC date for "today". */
function centreToday(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return dayString(d);
}

function parseDate(value: string | undefined, field = 'date'): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || dayString(new Date(`${value}T00:00:00Z`)) !== value) {
    throw new BadRequestException(`${field} must be a valid date (YYYY-MM-DD)`);
  }
  return value;
}

function toDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function absenceView(a: Absence): AbsenceView {
  return {
    id: a.id,
    childId: a.childId,
    date: dayString(a.date),
    isAllowable: a.isAllowable,
    reason: a.reason,
    reportedByParent: a.reportedByUserId !== null,
    createdAt: a.createdAt.toISOString(),
  };
}

function casualView(r: CasualDayRequest): CasualDayRequestView {
  return {
    id: r.id,
    childId: r.childId,
    date: dayString(r.date),
    status: r.status,
    note: r.note,
    declineReason: r.declineReason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  };
}

function pickupView(n: PickupNomination): PickupNominationView {
  return {
    id: n.id,
    childId: n.childId,
    date: dayString(n.date),
    personName: n.personName,
    personPhone: n.personPhone,
    note: n.note,
    status: n.status,
    verified: n.verifiedAt !== null,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * U3: things a family asks the centre for, and how the centre answers.
 *
 * - Absences are recorded as NOT allowable: the fee stands until a centre admin
 *   confirms, because that decision changes what the family pays.
 * - A casual-day request, once approved, becomes an ordinary CASUAL booking, so
 *   billing needs no special case.
 * - A pickup nomination names someone else to collect a child on one day; staff
 *   see it that day and record that they checked the person at handover.
 *
 * "Today" is the centre's local date. Free text (reasons, notes) and the
 * nominated person's name and phone are never copied into audit entries; those
 * carry ids and dates only. Authorization checks run before this service opens
 * its own transaction, never inside it (pooled-connection deadlock, Stage 5).
 */
@Injectable()
export class FamilyRequestsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private ctx(user: RequestUser) {
    if (!user.orgId) throw new ForbiddenException();
    // Staff lists are filtered by centre; a centre admin with no centre would otherwise see the whole organisation.
    if (user.role === 'CENTRE_ADMIN' && !user.centreId) throw new ForbiddenException('Not authorized for this centre');
    return { orgId: user.orgId, centreId: user.centreId };
  }

  private async timezone(tx: Prisma.TransactionClient, centreId: string): Promise<string> {
    const centre = await tx.centre.findUnique({ where: { id: centreId }, select: { timezone: true } });
    return centre?.timezone ?? 'Australia/Sydney';
  }

  /** A CENTRE_ADMIN acts on their own centre only; org-level admins are already scoped to the org by RLS. */
  private assertSameCentre(user: RequestUser, centreId: string): void {
    if (user.role === 'CENTRE_ADMIN' && user.centreId !== centreId) throw new ForbiddenException('Not authorized for this centre');
  }

  private async recordAudit(user: RequestUser, centreId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
    await this.audit.record({
      orgId: user.orgId as string,
      centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action,
      entityType,
      entityId,
      outcome: 'SUCCESS',
      metadata,
    });
  }

  private assertWindow(date: string, today: string, daysBack: number, daysAhead: number, what: string): void {
    if (date < shiftDate(today, -daysBack) || date > shiftDate(today, daysAhead)) {
      throw new BadRequestException(
        daysBack === 0 ? `${what} must be today or up to ${daysAhead} days ahead` : `${what} must be within ${daysBack} days back and ${daysAhead} days ahead`,
      );
    }
  }

  /** Is the child already booked on this date (a standing booking for that weekday, or a casual booking that day)? */
  private async isBooked(tx: Prisma.TransactionClient, childId: string, date: string): Promise<boolean> {
    const day = toDate(date);
    const count = await tx.booking.count({
      where: {
        childId,
        startDate: { lte: day },
        OR: [{ endDate: null }, { endDate: { gte: day } }],
        AND: [
          {
            OR: [
              { bookingType: 'PERMANENT', daysOfWeek: { has: day.getUTCDay() } },
              { bookingType: 'CASUAL', specificDate: day },
            ],
          },
        ],
      },
    });
    return count > 0;
  }

  private async childOrThrow(tx: Prisma.TransactionClient, childId: string) {
    const child = await tx.child.findUnique({ where: { id: childId }, select: { id: true, orgId: true, centreId: true, roomId: true, firstName: true, lastName: true } });
    if (!child) throw new NotFoundException('Child not found');
    return child;
  }

  // ---------------------------------------------------------- notifications

  /**
   * Best effort, after the request has committed: a failure to notify must never fail or undo what the
   * family or the centre just did. Payloads carry ids, dates and a status only (no names, notes or reasons).
   */
  private async notify(
    orgId: string,
    centreId: string,
    recipients: string[],
    priority: 'ACTION_REQUIRED' | 'CHILD_UPDATE',
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.notifications) return;
    for (const recipientUserId of new Set(recipients)) {
      try {
        await this.notifications.enqueue({ orgId, centreId, recipientUserId, priority, channel: 'PUSH', payload });
      } catch {
        /* the request already succeeded */
      }
    }
  }

  private async centreAdminIds(orgId: string, centreId: string): Promise<string[]> {
    try {
      const admins = await this.tenancy.withTenant({ orgId, centreId }, (tx) =>
        tx.user.findMany({ where: { centreId, role: 'CENTRE_ADMIN' }, select: { id: true } }),
      );
      return admins.map((a) => a.id);
    } catch {
      return [];
    }
  }

  /** Educators currently assigned to the child's room, plus whether `date` is the centre's today. */
  private async roomEducatorsIfToday(orgId: string, centreId: string, childId: string, date: string, now: Date): Promise<string[]> {
    try {
      return await this.tenancy.withTenant({ orgId, centreId }, async (tx) => {
        if (date !== centreToday(await this.timezone(tx, centreId), now)) return [];
        const child = await tx.child.findUnique({ where: { id: childId }, select: { roomId: true } });
        if (!child?.roomId) return [];
        const assignments = await tx.staffRoomAssignment.findMany({
          where: { roomId: child.roomId, endDate: null, user: { role: 'EDUCATOR' } },
          select: { userId: true },
        });
        return assignments.map((a) => a.userId);
      });
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------- absences

  async reportAbsence(user: RequestUser, childId: string, input: { date: string; reason?: string }, now: Date = new Date()): Promise<AbsenceView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, FAMILY_AND_ADMIN, 'absence.report');
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    const date = parseDate(input.date);
    const reason = cleanText(input.reason);
    if (reason && reason.length > MAX_REASON) throw new BadRequestException(`reason must be at most ${MAX_REASON} characters`);

    let created: Absence;
    try {
      created = await this.tenancy.withTenant(ctx, async (tx) => {
        const child = await this.childOrThrow(tx, childId);
        this.assertWindow(date, centreToday(await this.timezone(tx, child.centreId), now), 7, 90, 'Absence date');
        return tx.absence.create({
          data: {
            orgId: child.orgId,
            centreId: child.centreId,
            childId,
            date: toDate(date),
            isAllowable: false,
            reason,
            reportedByUserId: user.role === 'PARENT' ? user.userId : null,
          },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION) throw new ConflictException('An absence is already recorded for this child on that date');
      throw err;
    }
    await this.recordAudit(user, created.centreId, 'absence.reported', 'Absence', created.id, { childId, date });
    if (user.role === 'PARENT') {
      await this.notify(created.orgId, created.centreId, await this.centreAdminIds(created.orgId, created.centreId), 'ACTION_REQUIRED', {
        type: 'absence_reported', absenceId: created.id, childId, date,
      });
    }
    return absenceView(created);
  }

  async listAbsences(user: RequestUser, childId: string, now: Date = new Date()): Promise<AbsenceView[]> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, FAMILY_AND_ADMIN, 'absence.list');
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    return this.tenancy.withTenant(ctx, async (tx) => {
      const child = await this.childOrThrow(tx, childId);
      const from = shiftDate(centreToday(await this.timezone(tx, child.centreId), now), -30);
      const rows = await tx.absence.findMany({ where: { childId, date: { gte: toDate(from) } }, orderBy: { date: 'asc' } });
      return rows.map(absenceView);
    });
  }

  async listCentreAbsences(
    user: RequestUser,
    range: { from?: string; to?: string },
    now: Date = new Date(),
  ): Promise<(AbsenceView & { child: ChildSummary })[]> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ADMIN_ROLES, 'absence.list_centre');
    return this.tenancy.withTenant(ctx, async (tx) => {
      const today = centreToday(user.centreId ? await this.timezone(tx, user.centreId) : 'Australia/Sydney', now);
      const from = range.from ? parseDate(range.from, 'from') : today;
      const to = range.to ? parseDate(range.to, 'to') : shiftDate(today, 30);
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) {
        throw new BadRequestException(`The date range can be at most ${MAX_RANGE_DAYS} days`);
      }
      const rows = await tx.absence.findMany({
        where: { ...(user.centreId ? { centreId: user.centreId } : {}), date: { gte: toDate(from), lte: toDate(to) } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        include: { child: { select: { id: true, firstName: true, lastName: true } } },
      });
      return rows.map((a) => ({ ...absenceView(a), child: a.child }));
    });
  }

  async setAbsenceAllowable(user: RequestUser, absenceId: string, isAllowable: boolean): Promise<AbsenceView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ADMIN_ROLES, 'absence.set_allowable');
    const updated = await this.tenancy.withTenant(ctx, async (tx) => {
      const absence = await tx.absence.findUnique({ where: { id: absenceId } });
      if (!absence) throw new NotFoundException('Absence not found');
      this.assertSameCentre(user, absence.centreId);
      return tx.absence.update({ where: { id: absenceId }, data: { isAllowable } });
    });
    await this.recordAudit(user, updated.centreId, 'absence.allowable_set', 'Absence', updated.id, { absenceId: updated.id, isAllowable });
    return absenceView(updated);
  }

  // ------------------------------------------------------------- casual days

  async requestCasualDay(user: RequestUser, childId: string, input: { date: string; note?: string }, now: Date = new Date()): Promise<CasualDayRequestView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ['PARENT'], 'casual_day.request');
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    const date = parseDate(input.date);
    const note = cleanText(input.note);
    if (note && note.length > MAX_NOTE) throw new BadRequestException(`note must be at most ${MAX_NOTE} characters`);

    let created: CasualDayRequest;
    try {
      created = await this.tenancy.withTenant(ctx, async (tx) => {
        const child = await this.childOrThrow(tx, childId);
        this.assertWindow(date, centreToday(await this.timezone(tx, child.centreId), now), 0, 90, 'Casual day');
        if (!child.roomId) throw new BadRequestException('This child is not in a room yet, so a casual day cannot be requested');
        if (await this.isBooked(tx, childId, date)) throw new ConflictException('This child is already booked on that day');
        return tx.casualDayRequest.create({
          data: { orgId: child.orgId, centreId: child.centreId, childId, date: toDate(date), note, requestedByUserId: user.userId },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION) throw new ConflictException('A request for that day is already waiting or approved');
      throw err;
    }
    await this.recordAudit(user, created.centreId, 'casual_day.requested', 'CasualDayRequest', created.id, { childId, date });
    await this.notify(created.orgId, created.centreId, await this.centreAdminIds(created.orgId, created.centreId), 'ACTION_REQUIRED', {
      type: 'casual_day_requested', requestId: created.id, childId, date,
    });
    return casualView(created);
  }

  async listCasualDayRequests(user: RequestUser, childId: string, now: Date = new Date()): Promise<CasualDayRequestView[]> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, FAMILY_AND_ADMIN, 'casual_day.list');
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    return this.tenancy.withTenant(ctx, async (tx) => {
      const child = await this.childOrThrow(tx, childId);
      const from = shiftDate(centreToday(await this.timezone(tx, child.centreId), now), -30);
      const rows = await tx.casualDayRequest.findMany({ where: { childId, date: { gte: toDate(from) } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
      return rows.map(casualView);
    });
  }

  async listPendingCasualDayRequests(
    user: RequestUser,
    // Accepted for symmetry with the other time-aware methods; the queue itself is not date-filtered.
    _now: Date = new Date(),
  ): Promise<(CasualDayRequestView & { child: ChildSummary; roomName: string | null })[]> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ADMIN_ROLES, 'casual_day.list_pending');
    return this.tenancy.withTenant(ctx, async (tx) => {
      const rows = await tx.casualDayRequest.findMany({
        where: { status: 'PENDING', ...(user.centreId ? { centreId: user.centreId } : {}) },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        include: { child: { select: { id: true, firstName: true, lastName: true, room: { select: { name: true } } } } },
      });
      return rows.map((r) => ({
        ...casualView(r),
        child: { id: r.child.id, firstName: r.child.firstName, lastName: r.child.lastName },
        roomName: r.child.room?.name ?? null,
      }));
    });
  }

  async approveCasualDay(user: RequestUser, requestId: string, input: { feeScheduleId?: string }, now: Date = new Date()): Promise<CasualDayRequestView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ADMIN_ROLES, 'casual_day.approve');

    // One transaction: the booking and the status change land together or not at all.
    const { request, bookingId } = await this.tenancy.withTenant(ctx, async (tx) => {
      const found = await tx.casualDayRequest.findUnique({ where: { id: requestId } });
      if (!found) throw new NotFoundException('Request not found');
      this.assertSameCentre(user, found.centreId);
      if (found.status !== 'PENDING') throw new ConflictException(`This request is already ${found.status.toLowerCase()}`);

      const date = dayString(found.date);
      if (date < centreToday(await this.timezone(tx, found.centreId), now)) throw new BadRequestException('That day has already passed');

      const child = await this.childOrThrow(tx, found.childId);
      if (!child.roomId) throw new BadRequestException('This child is not in a room, so a day cannot be booked');
      if (await this.isBooked(tx, found.childId, date)) throw new ConflictException('This child is already booked on that day');

      const day = found.date;
      const effective: Prisma.FeeScheduleWhereInput = {
        centreId: found.centreId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      };
      let feeScheduleId: string | undefined;
      if (input.feeScheduleId) {
        feeScheduleId = (await tx.feeSchedule.findFirst({ where: { ...effective, id: input.feeScheduleId }, select: { id: true } }))?.id;
        if (!feeScheduleId) throw new BadRequestException('That fee schedule does not apply to this centre and day');
      } else {
        const order = { effectiveFrom: 'desc' } as const;
        feeScheduleId = (await tx.feeSchedule.findFirst({ where: { ...effective, roomId: child.roomId }, orderBy: order, select: { id: true } }))?.id;
        feeScheduleId ??= (await tx.feeSchedule.findFirst({ where: { ...effective, roomId: null }, orderBy: order, select: { id: true } }))?.id;
        if (!feeScheduleId) throw new BadRequestException('No fee schedule applies on that day; choose one to approve');
      }

      // The claim is the lock: whoever flips PENDING first wins; a concurrent approve, decline or cancel updates zero rows.
      const claimed = await tx.casualDayRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'APPROVED', decidedByUserId: user.userId, decidedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('This request has just been decided by someone else');

      const booking = await tx.booking.create({
        data: {
          orgId: found.orgId,
          centreId: found.centreId,
          childId: found.childId,
          roomId: child.roomId,
          feeScheduleId,
          bookingType: 'CASUAL',
          daysOfWeek: [],
          specificDate: day,
          startDate: day,
          endDate: day,
        },
      });
      const request = await tx.casualDayRequest.update({ where: { id: requestId }, data: { bookingId: booking.id } });
      return { request, bookingId: booking.id };
    });

    await this.recordAudit(user, request.centreId, 'casual_day.approved', 'CasualDayRequest', request.id, { requestId: request.id, bookingId });
    await this.notify(request.orgId, request.centreId, [request.requestedByUserId], 'CHILD_UPDATE', {
      type: 'casual_day_decided', requestId: request.id, childId: request.childId, date: dayString(request.date), status: 'APPROVED',
    });
    return casualView(request);
  }

  async declineCasualDay(user: RequestUser, requestId: string, input: { reason?: string }, _now: Date = new Date()): Promise<CasualDayRequestView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ADMIN_ROLES, 'casual_day.decline');
    const reason = cleanText(input.reason);
    if (reason && reason.length > MAX_REASON) throw new BadRequestException(`reason must be at most ${MAX_REASON} characters`);

    const declined = await this.tenancy.withTenant(ctx, async (tx) => {
      const found = await tx.casualDayRequest.findUnique({ where: { id: requestId } });
      if (!found) throw new NotFoundException('Request not found');
      this.assertSameCentre(user, found.centreId);
      if (found.status !== 'PENDING') throw new ConflictException(`This request is already ${found.status.toLowerCase()}`);
      const claimed = await tx.casualDayRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'DECLINED', decidedByUserId: user.userId, decidedAt: new Date(), declineReason: reason },
      });
      if (claimed.count !== 1) throw new ConflictException('This request has just been decided by someone else');
      return tx.casualDayRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
    await this.recordAudit(user, declined.centreId, 'casual_day.declined', 'CasualDayRequest', declined.id, { requestId: declined.id });
    await this.notify(declined.orgId, declined.centreId, [declined.requestedByUserId], 'CHILD_UPDATE', {
      type: 'casual_day_decided', requestId: declined.id, childId: declined.childId, date: dayString(declined.date), status: 'DECLINED',
    });
    return casualView(declined);
  }

  async cancelCasualDayRequest(user: RequestUser, requestId: string): Promise<CasualDayRequestView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ['PARENT'], 'casual_day.cancel');
    const found = await this.tenancy.withTenant(ctx, (tx) => tx.casualDayRequest.findUnique({ where: { id: requestId } }));
    if (!found) throw new NotFoundException('Request not found');
    // Only whoever asked can withdraw it, and only while they still have access to the child.
    if (found.requestedByUserId !== user.userId) throw new ForbiddenException('Only the person who made this request can cancel it');
    await this.authorization.assertCanAccessChild(user, found.childId, 'view');

    const cancelled = await this.tenancy.withTenant(ctx, async (tx) => {
      const current = await tx.casualDayRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (current.status === 'APPROVED') throw new ConflictException('This day is already approved. Please contact the centre to change it.');
      if (current.status !== 'PENDING') throw new ConflictException(`This request is already ${current.status.toLowerCase()}`);
      const claimed = await tx.casualDayRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('This request has just been decided. Please contact the centre if you need to change it.');
      return tx.casualDayRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
    await this.recordAudit(user, cancelled.centreId, 'casual_day.cancelled', 'CasualDayRequest', cancelled.id, { requestId: cancelled.id });
    return casualView(cancelled);
  }

  // ------------------------------------------------------- pickup nominations

  async nominatePickup(
    user: RequestUser,
    childId: string,
    input: { date: string; personName: string; personPhone?: string; note?: string },
    now: Date = new Date(),
  ): Promise<PickupNominationView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, FAMILY_AND_ADMIN, 'pickup.nominate');
    await this.authorization.assertCanAccessChild(user, childId, 'pickup');

    const date = parseDate(input.date);
    const personName = cleanText(input.personName) ?? '';
    if (personName.length < 2 || personName.length > 100) throw new BadRequestException("The person's name must be 2 to 100 characters");
    const personPhone = input.personPhone?.trim() ? input.personPhone.trim() : null;
    if (personPhone && !PHONE.test(personPhone)) throw new BadRequestException('The phone number may only contain digits, spaces and + ( ) -, and must be 6 to 20 characters');
    const note = cleanText(input.note);
    if (note && note.length > MAX_PICKUP_NOTE) throw new BadRequestException(`note must be at most ${MAX_PICKUP_NOTE} characters`);

    const created = await this.tenancy.withTenant(ctx, async (tx) => {
      const child = await this.childOrThrow(tx, childId);
      this.assertWindow(date, centreToday(await this.timezone(tx, child.centreId), now), 0, 30, 'Pickup date');
      // One lock per child and day, so two guardians submitting together cannot both slip under the cap.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${childId}), hashtext(${date}))`;
      const active = await tx.pickupNomination.count({ where: { childId, date: toDate(date), status: 'ACTIVE' } });
      if (active >= MAX_ACTIVE_NOMINATIONS_PER_DAY) {
        throw new ConflictException(`At most ${MAX_ACTIVE_NOMINATIONS_PER_DAY} people can be nominated for one day; cancel one first`);
      }
      return tx.pickupNomination.create({
        data: { orgId: child.orgId, centreId: child.centreId, childId, date: toDate(date), personName, personPhone, note, createdByUserId: user.userId },
      });
    });
    await this.recordAudit(user, created.centreId, 'pickup.nominated', 'PickupNomination', created.id, { childId, date, nominationId: created.id });
    await this.notify(created.orgId, created.centreId, await this.roomEducatorsIfToday(created.orgId, created.centreId, childId, date, now), 'CHILD_UPDATE', {
      type: 'pickup_nominated', nominationId: created.id, childId, date,
    });
    return pickupView(created);
  }

  async listPickupNominations(user: RequestUser, childId: string, now: Date = new Date()): Promise<PickupNominationView[]> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, FAMILY_AND_ADMIN, 'pickup.list');
    await this.authorization.assertCanAccessChild(user, childId, 'pickup');
    return this.tenancy.withTenant(ctx, async (tx) => {
      const child = await this.childOrThrow(tx, childId);
      const today = centreToday(await this.timezone(tx, child.centreId), now);
      const rows = await tx.pickupNomination.findMany({
        where: { childId, status: 'ACTIVE', date: { gte: toDate(today) } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map(pickupView);
    });
  }

  async cancelPickupNomination(user: RequestUser, nominationId: string, now: Date = new Date()): Promise<PickupNominationView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, FAMILY_AND_ADMIN, 'pickup.cancel');
    const found = await this.tenancy.withTenant(ctx, (tx) => tx.pickupNomination.findUnique({ where: { id: nominationId } }));
    if (!found) throw new NotFoundException('Nomination not found');
    if (user.role === 'PARENT') {
      // The parent who made it, and only while they still have pickup rights for this child.
      if (found.createdByUserId !== user.userId) throw new ForbiddenException('Only the person who made this nomination can cancel it');
      await this.authorization.assertCanAccessChild(user, found.childId, 'pickup');
    } else {
      this.assertSameCentre(user, found.centreId);
    }

    const cancelled = await this.tenancy.withTenant(ctx, async (tx) => {
      const current = await tx.pickupNomination.findUniqueOrThrow({ where: { id: nominationId } });
      if (current.status !== 'ACTIVE') throw new ConflictException('This nomination is already cancelled');
      if (current.verifiedAt) throw new ConflictException('This pickup has already been checked at the door and can no longer be cancelled');
      const claimed = await tx.pickupNomination.updateMany({ where: { id: nominationId, status: 'ACTIVE', verifiedAt: null }, data: { status: 'CANCELLED' } });
      if (claimed.count !== 1) throw new ConflictException('This pickup has already been checked at the door or cancelled');
      return tx.pickupNomination.findUniqueOrThrow({ where: { id: nominationId } });
    });
    await this.recordAudit(user, cancelled.centreId, 'pickup.cancelled', 'PickupNomination', cancelled.id, { nominationId: cancelled.id, childId: cancelled.childId });
    await this.notify(cancelled.orgId, cancelled.centreId, await this.roomEducatorsIfToday(cancelled.orgId, cancelled.centreId, cancelled.childId, dayString(cancelled.date), now), 'CHILD_UPDATE', {
      type: 'pickup_cancelled', nominationId: cancelled.id, childId: cancelled.childId, date: dayString(cancelled.date),
    });
    return pickupView(cancelled);
  }

  /** What staff need at the door: nominated pickups for a day. Educators see their own rooms; admins see the centre. */
  async listPickupsForDate(
    user: RequestUser,
    filter: { date?: string },
    now: Date = new Date(),
  ): Promise<(PickupNominationView & { child: ChildSummary; roomName: string | null })[]> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ['EDUCATOR', ...ADMIN_ROLES], 'pickup.list_for_date');
    const rooms = user.role === 'EDUCATOR' ? await this.authorization.activeRoomIds(user) : null;
    if (rooms && rooms.length === 0) return [];

    return this.tenancy.withTenant(ctx, async (tx) => {
      const today = centreToday(user.centreId ? await this.timezone(tx, user.centreId) : 'Australia/Sydney', now);
      const date = filter.date ? parseDate(filter.date) : today;
      const rows = await tx.pickupNomination.findMany({
        where: {
          status: 'ACTIVE',
          date: toDate(date),
          ...(user.centreId ? { centreId: user.centreId } : {}),
          ...(rooms ? { child: { roomId: { in: rooms } } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        include: { child: { select: { id: true, firstName: true, lastName: true, room: { select: { name: true } } } } },
      });
      return rows.map((n) => ({
        ...pickupView(n),
        child: { id: n.child.id, firstName: n.child.firstName, lastName: n.child.lastName },
        roomName: n.child.room?.name ?? null,
      }));
    });
  }

  /** Staff record that they checked the nominated person's identity at handover. Idempotent: the first check stands. */
  async verifyPickup(user: RequestUser, nominationId: string, now: Date = new Date()): Promise<PickupNominationView> {
    const ctx = this.ctx(user);
    await this.authorization.assertRole(user, ['EDUCATOR', ...ADMIN_ROLES], 'pickup.verify');
    const found = await this.tenancy.withTenant(ctx, async (tx) => {
      const nomination = await tx.pickupNomination.findUnique({ where: { id: nominationId } });
      if (!nomination) return null;
      const child = await tx.child.findUnique({ where: { id: nomination.childId }, select: { roomId: true } });
      return { nomination, roomId: child?.roomId ?? null, today: centreToday(await this.timezone(tx, nomination.centreId), now) };
    });
    if (!found) throw new NotFoundException('Nomination not found');
    const { nomination, roomId, today } = found;

    if (user.role === 'EDUCATOR') {
      const rooms = await this.authorization.activeRoomIds(user);
      if (!roomId || !rooms.includes(roomId)) throw new ForbiddenException('You are not assigned to this child’s room');
    } else {
      this.assertSameCentre(user, nomination.centreId);
    }

    if (nomination.status !== 'ACTIVE') throw new BadRequestException('This nomination was cancelled');
    if (nomination.verifiedAt) return pickupView(nomination);
    if (dayString(nomination.date) !== today) throw new BadRequestException('A pickup can only be verified on its day');

    const { verified, first } = await this.tenancy.withTenant(ctx, async (tx) => {
      // Conditional update so two staff verifying at once record one verifier.
      const result = await tx.pickupNomination.updateMany({
        where: { id: nominationId, verifiedAt: null, status: 'ACTIVE' },
        data: { verifiedAt: new Date(), verifiedByUserId: user.userId },
      });
      const current = await tx.pickupNomination.findUniqueOrThrow({ where: { id: nominationId } });
      // Cancelled between our read and this write: refuse rather than record a check for a cancelled pickup.
      if (result.count !== 1 && current.status !== 'ACTIVE') throw new BadRequestException('This nomination was cancelled');
      return { verified: current, first: result.count === 1 };
    });
    if (first) {
      await this.recordAudit(user, verified.centreId, 'pickup.verified', 'PickupNomination', verified.id, { nominationId: verified.id, childId: verified.childId });
    }
    return pickupView(verified);
  }
}
