import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerEntry, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../authorization/request-user.interface';
import { addDaysToDate, centreDateString, isRealDate, startOfCentreDate } from '../common/time/centre-day';

const HQ_ROLES = ['ORG_ADMIN', 'PLATFORM_ADMIN', 'AREA_MANAGER'];
const ADMIN_ROLES = ['ORG_ADMIN', 'PLATFORM_ADMIN'];
const DEFAULT_TREND_DAYS = 14;
const MAX_TREND_DAYS = 90;
const MAX_RANGE_DAYS = 366;
const REPORT_TZ = 'Australia/Sydney';

export interface HqCentre {
  id: string;
  name: string;
  timezone: string;
  licensedCapacity: number | null;
}

export interface Ageing {
  current: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

export interface FinancialRow {
  invoicedCents: number;
  subsidyEstimatedCents: number;
  subsidyConfirmedCents: number;
  paymentsReceivedCents: number;
  creditsCents: number;
  outstandingCents: number;
  debtorCount: number;
  ageing: Ageing;
}

const emptyRow = (): FinancialRow => ({
  invoicedCents: 0,
  subsidyEstimatedCents: 0,
  subsidyConfirmedCents: 0,
  paymentsReceivedCents: 0,
  creditsCents: 0,
  outstandingCents: 0,
  debtorCount: 0,
  ageing: { current: 0, days31to60: 0, days61to90: 0, over90: 0 },
});

function addRows(a: FinancialRow, b: FinancialRow): FinancialRow {
  return {
    invoicedCents: a.invoicedCents + b.invoicedCents,
    subsidyEstimatedCents: a.subsidyEstimatedCents + b.subsidyEstimatedCents,
    subsidyConfirmedCents: a.subsidyConfirmedCents + b.subsidyConfirmedCents,
    paymentsReceivedCents: a.paymentsReceivedCents + b.paymentsReceivedCents,
    creditsCents: a.creditsCents + b.creditsCents,
    outstandingCents: a.outstandingCents + b.outstandingCents,
    debtorCount: a.debtorCount + b.debtorCount,
    ageing: {
      current: a.ageing.current + b.ageing.current,
      days31to60: a.ageing.days31to60 + b.ageing.days31to60,
      days61to90: a.ageing.days61to90 + b.ageing.days61to90,
      over90: a.ageing.over90 + b.ageing.over90,
    },
  };
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Multi-site HQ views (BRD v2.3 HQ-001, HQ-003, HQ-004). Everything here is aggregate: counts and money per centre, never a
 * child's name or id. Organisation figures are the sum of the centres a person is allowed to see, so an area manager's
 * totals cover only their centres. Reads run inside the organisation's row-level security; the centre list narrows it.
 */
@Injectable()
export class HqService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  private viewer(user: RequestUser): string {
    if (!user.orgId || !HQ_ROLES.includes(user.role)) throw new ForbiddenException('Only organisation administrators and area managers can see the HQ views');
    return user.orgId;
  }

  private admin(user: RequestUser): string {
    if (!user.orgId || !ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only organisation administrators can do this');
    return user.orgId;
  }

  private async visibleCentres(tx: Prisma.TransactionClient, user: RequestUser, orgId: string): Promise<HqCentre[]> {
    let where: Prisma.CentreWhereInput = { orgId };
    if (user.role === 'AREA_MANAGER') {
      const assigned = await tx.areaManagerCentre.findMany({ where: { userId: user.userId, orgId }, select: { centreId: true } });
      where = { orgId, id: { in: assigned.map((a) => a.centreId) } };
    }
    const rows = await tx.centre.findMany({ where, orderBy: { name: 'asc' }, select: { id: true, name: true, timezone: true, licensedCapacity: true } });
    return rows;
  }

  private async viewed(user: RequestUser, orgId: string, report: string, centreCount: number) {
    await this.audit.record({
      orgId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'hq.viewed',
      entityType: 'Organisation',
      entityId: orgId,
      outcome: 'SUCCESS',
      metadata: { report, centreCount },
    });
  }

  async listCentres(user: RequestUser): Promise<HqCentre[]> {
    const orgId = this.viewer(user);
    return this.tenancy.withTenant({ orgId }, (tx) => this.visibleCentres(tx, user, orgId));
  }

  // ---- administration ------------------------------------------------------------------------------------------

  async setAreaManagerCentres(admin: RequestUser, userId: string, centreIds: unknown): Promise<string[]> {
    const orgId = this.admin(admin);
    if (!Array.isArray(centreIds) || centreIds.some((c) => typeof c !== 'string')) throw new BadRequestException('centreIds must be a list of centre ids');
    const ids = [...new Set(centreIds as string[])];
    return this.tenancy.withTenant({ orgId }, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, orgId, role: 'AREA_MANAGER' }, select: { id: true } });
      if (!target) throw new NotFoundException('Area manager not found');
      const centres = await tx.centre.count({ where: { orgId, id: { in: ids } } });
      if (centres !== ids.length) throw new BadRequestException('A centre is not part of this organisation');
      const before = new Set((await tx.areaManagerCentre.findMany({ where: { orgId, userId }, select: { centreId: true } })).map((r) => r.centreId));
      const added = ids.filter((c) => !before.has(c)).sort();
      const removed = [...before].filter((c) => !ids.includes(c)).sort();
      await tx.areaManagerCentre.deleteMany({ where: { orgId, userId } });
      if (ids.length > 0) await tx.areaManagerCentre.createMany({ data: ids.map((centreId) => ({ orgId, userId, centreId })) });
      await this.audit.record(
        { orgId, actorUserId: admin.userId, actorRole: admin.role, action: 'hq.area_manager_centres_set', entityType: 'User', entityId: userId, outcome: 'SUCCESS', metadata: { centreCount: ids.length, addedCentreIds: added, removedCentreIds: removed } },
        tx,
      );
      return ids;
    });
  }

  async getAreaManagerCentres(admin: RequestUser, userId: string): Promise<string[]> {
    const orgId = this.admin(admin);
    return this.tenancy.withTenant({ orgId }, async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, orgId, role: 'AREA_MANAGER' }, select: { id: true } });
      if (!target) throw new NotFoundException('Area manager not found');
      const rows = await tx.areaManagerCentre.findMany({ where: { orgId, userId }, select: { centreId: true } });
      return rows.map((r) => r.centreId);
    });
  }

  async setCentreCapacity(admin: RequestUser, centreId: string, capacity: unknown): Promise<{ centreId: string; licensedCapacity: number | null }> {
    const orgId = this.admin(admin);
    if (capacity !== null && (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000)) {
      throw new BadRequestException('Capacity must be a whole number from 1 to 1000, or empty');
    }
    return this.tenancy.withTenant({ orgId }, async (tx) => {
      const centre = await tx.centre.findFirst({ where: { id: centreId, orgId }, select: { id: true } });
      if (!centre) throw new NotFoundException('Centre not found');
      await tx.centre.update({ where: { id: centreId }, data: { licensedCapacity: capacity as number | null } });
      await this.audit.record(
        { orgId, centreId, actorUserId: admin.userId, actorRole: admin.role, action: 'hq.centre_capacity_set', entityType: 'Centre', entityId: centreId, outcome: 'SUCCESS', metadata: { cleared: capacity === null } },
        tx,
      );
      return { centreId, licensedCapacity: capacity as number | null };
    });
  }

  // ---- occupancy (HQ-001) --------------------------------------------------------------------------------------

  async occupancy(user: RequestUser, opts: { date?: string; days?: number } = {}, now: Date = new Date()) {
    const orgId = this.viewer(user);
    if (opts.date !== undefined && !isRealDate(opts.date)) throw new BadRequestException('date must be a real date (YYYY-MM-DD)');
    const days = opts.days ?? DEFAULT_TREND_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_TREND_DAYS) throw new BadRequestException(`days must be a whole number from 1 to ${MAX_TREND_DAYS}`);

    const result = await this.tenancy.withTenant({ orgId }, async (tx) => {
      const centres = await this.visibleCentres(tx, user, orgId);
      const rows = [];
      for (const c of centres) {
        const date = opts.date ?? centreDateString(c.timezone, now);
        const first = addDaysToDate(date, -(days - 1));
        const events = await tx.attendanceEvent.findMany({
          where: { centreId: c.id, timestamp: { gte: startOfCentreDate(c.timezone, first), lt: startOfCentreDate(c.timezone, addDaysToDate(date, 1)) } },
          orderBy: { timestamp: 'asc' },
          select: { childId: true, eventType: true, timestamp: true },
        });
        const attendedByDay = new Map<string, Set<string>>();
        const latestToday = new Map<string, string>();
        for (const e of events) {
          const day = centreDateString(c.timezone, e.timestamp);
          if (e.eventType === 'SIGN_IN') {
            if (!attendedByDay.has(day)) attendedByDay.set(day, new Set());
            attendedByDay.get(day)!.add(e.childId);
          }
          if (day === date) latestToday.set(e.childId, e.eventType);
        }
        const trend = Array.from({ length: days }, (_, i) => {
          const d = addDaysToDate(first, i);
          return { date: d, attended: attendedByDay.get(d)?.size ?? 0 };
        });
        const attended = trend[trend.length - 1].attended;
        const signedInNow = [...latestToday.values()].filter((t) => t === 'SIGN_IN').length;
        rows.push({
          centreId: c.id,
          name: c.name,
          licensedCapacity: c.licensedCapacity,
          today: {
            date,
            signedInNow,
            attended,
            occupancyPercent: c.licensedCapacity ? Math.round((attended / c.licensedCapacity) * 1000) / 10 : null,
          },
          trend,
        });
      }

      const withCapacity = rows.filter((r) => r.licensedCapacity);
      // Trends are summed by position: every centre's trend ends on the same requested date, or on its own local today.
      const trendTotals = new Map<string, number>();
      for (const r of rows) for (const t of r.trend) trendTotals.set(t.date, (trendTotals.get(t.date) ?? 0) + t.attended);
      return {
        centres: rows,
        totals: {
          attended: rows.reduce((s, r) => s + r.today.attended, 0),
          licensedCapacity: withCapacity.length ? withCapacity.reduce((s, r) => s + (r.licensedCapacity as number), 0) : null,
          signedInNow: rows.reduce((s, r) => s + r.today.signedInNow, 0),
          // Only centres with a capacity count, on both sides of the division, so a centre with no capacity cannot inflate it.
          occupancyPercent: withCapacity.length
            ? Math.round((withCapacity.reduce((s, r) => s + r.today.attended, 0) / withCapacity.reduce((s, r) => s + (r.licensedCapacity as number), 0)) * 1000) / 10
            : null,
          trend: [...trendTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, attended]) => ({ date, attended })),
        },
      };
    });
    await this.viewed(user, orgId, 'occupancy', result.centres.length);
    return result;
  }

  // ---- financials (HQ-003) -------------------------------------------------------------------------------------

  private resolveRange(range: { from?: string; to?: string }, now: Date): { from: string; to: string } {
    const today = centreDateString(REPORT_TZ, now);
    // Default: the current month in Sydney, first day to last day.
    const monthEnd = addDaysToDate(`${addDaysToDate(`${today.slice(0, 7)}-01`, 32).slice(0, 7)}-01`, -1);
    const to = range.to ?? monthEnd;
    const from = range.from ?? (range.to ? `${to.slice(0, 7)}-01` : `${today.slice(0, 7)}-01`);
    if (!isRealDate(from) || !isRealDate(to)) throw new BadRequestException('from and to must be real dates (YYYY-MM-DD)');
    if (from > to) throw new BadRequestException('from must not be after to');
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequestException(`The range can be at most ${MAX_RANGE_DAYS} days`);
    return { from, to };
  }

  /** Where a ledger entry belongs in time: the session it is for, else when it was recorded, in the centre's own day. */
  private entryDay(e: LedgerEntry, timezone: string): string {
    return e.sessionDate ? e.sessionDate.toISOString().slice(0, 10) : centreDateString(timezone, e.createdAt);
  }

  async financials(user: RequestUser, range: { from?: string; to?: string } = {}, now: Date = new Date()) {
    const orgId = this.viewer(user);
    const result = await this.financialFigures(user, orgId, range, now);
    await this.viewed(user, orgId, 'financials', result.centres.length);
    return result;
  }

  private async financialFigures(user: RequestUser, orgId: string, range: { from?: string; to?: string }, now: Date) {
    const period = this.resolveRange(range, now);

    return this.tenancy.withTenant({ orgId }, async (tx) => {
      const centres = await this.visibleCentres(tx, user, orgId);
      const entries = centres.length ? await tx.ledgerEntry.findMany({ where: { centreId: { in: centres.map((c) => c.id) } } }) : [];
      const byCentre = new Map<string, LedgerEntry[]>();
      for (const e of entries) byCentre.set(e.centreId, [...(byCentre.get(e.centreId) ?? []), e]);

      const rows = centres.map((c) => ({ centreId: c.id, name: c.name, ...this.centreFigures(byCentre.get(c.id) ?? [], c.timezone, period) }));
      const totals = rows.reduce<FinancialRow>((sum, r) => addRows(sum, r), emptyRow());
      return { period, centres: rows, totals };
    });
  }

  private centreFigures(entries: LedgerEntry[], timezone: string, period: { from: string; to: string }): FinancialRow {
    const row = emptyRow();
    const inRange = (e: LedgerEntry) => {
      const d = this.entryDay(e, timezone);
      return d >= period.from && d <= period.to;
    };
    for (const e of entries) {
      if (!inRange(e)) continue;
      if (e.entryType === 'FEE' || (e.entryType === 'ADJUSTMENT' && e.amountCents > 0)) row.invoicedCents += e.amountCents;
      else if (e.entryType === 'SUBSIDY_ESTIMATED') row.subsidyEstimatedCents += Math.abs(e.amountCents);
      else if (e.entryType === 'SUBSIDY_CONFIRMED') row.subsidyConfirmedCents += Math.abs(e.amountCents);
      else if (e.entryType === 'PAYMENT') row.paymentsReceivedCents += Math.abs(e.amountCents);
      else if (e.entryType === 'CREDIT') row.creditsCents += Math.abs(e.amountCents);
    }

    // Outstanding is all-time and per child. A confirmed subsidy replaces its estimate, exactly as the family's own balance does.
    const byChild = new Map<string, LedgerEntry[]>();
    for (const e of entries) byChild.set(e.childId, [...(byChild.get(e.childId) ?? []), e]);
    for (const childEntries of byChild.values()) {
      const confirmedFor = new Set(childEntries.filter((e) => e.entryType === 'SUBSIDY_CONFIRMED' && e.sourceFeeEntryId).map((e) => e.sourceFeeEntryId));
      const counted = childEntries.filter((e) => !(e.entryType === 'SUBSIDY_ESTIMATED' && e.sourceFeeEntryId && confirmedFor.has(e.sourceFeeEntryId)));
      const balance = counted.reduce((s, e) => s + e.amountCents, 0);
      if (balance <= 0) continue;
      row.outstandingCents += balance;
      row.debtorCount += 1;

      // Ageing: the balance is the most recent charges still unpaid, so allocate it newest first.
      const debits = counted
        .filter((e) => e.entryType === 'FEE' || (e.entryType === 'ADJUSTMENT' && e.amountCents > 0))
        .map((e) => ({ day: this.entryDay(e, timezone), cents: e.amountCents }))
        .sort((a, b) => b.day.localeCompare(a.day));
      let left = balance;
      const put = (day: string | null, cents: number) => {
        const age = day === null ? Number.MAX_SAFE_INTEGER : daysBetween(day, period.to);
        if (age <= 30) row.ageing.current += cents;
        else if (age <= 60) row.ageing.days31to60 += cents;
        else if (age <= 90) row.ageing.days61to90 += cents;
        else row.ageing.over90 += cents;
      };
      for (const d of debits) {
        if (left <= 0) break;
        const part = Math.min(left, d.cents);
        put(d.day, part);
        left -= part;
      }
      if (left > 0) put(null, left); // a balance the charges do not explain is treated as the oldest
    }
    return row;
  }

  async financialsCsv(user: RequestUser, range: { from?: string; to?: string } = {}, now: Date = new Date()): Promise<string> {
    const orgId = this.viewer(user);
    const f = await this.financialFigures(user, orgId, range, now);
    const dollars = (c: number) => (c / 100).toFixed(2);
    const cell = (v: string) => {
      // A name starting with = + - or @ would be run as a formula by a spreadsheet, so it is made plain text.
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const line = (name: string, r: FinancialRow) =>
      [cell(name), dollars(r.invoicedCents), dollars(r.subsidyEstimatedCents), dollars(r.subsidyConfirmedCents), dollars(r.paymentsReceivedCents), dollars(r.creditsCents), dollars(r.outstandingCents), String(r.debtorCount), dollars(r.ageing.current), dollars(r.ageing.days31to60), dollars(r.ageing.days61to90), dollars(r.ageing.over90)].join(',');
    const header = 'Centre,Invoiced,Subsidy expected,Subsidy received,Payments received,Credits,Outstanding,Debtors,Current,31-60 days,61-90 days,Over 90 days';
    await this.viewed(user, orgId, 'financials_csv', f.centres.length);
    return [header, ...f.centres.map((c) => line(c.name, c)), line('Total', f.totals)].join('\n') + '\n';
  }
}
