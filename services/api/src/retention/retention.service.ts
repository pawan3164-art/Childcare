import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ROLES, AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { eligibleOn, isRecordType, localDate, MAX_OVERRIDE_YEARS, RECORD_TYPES, RETENTION_DEFAULTS, RecordType } from './retention-rules';

const MAX_REASON = 500;
const UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g;
const cleanText = (value: string | undefined | null): string | null => {
  const cleaned = (value ?? '').replace(UNSAFE_TEXT, '').trim();
  return cleaned ? cleaned : null;
};
const dayString = (d: Date) => d.toISOString().slice(0, 10);

export interface PolicyEntry {
  years?: number;
  untilAge?: number;
  source: 'default' | 'centre';
}

export type RetentionPolicy = Record<RecordType, PolicyEntry>;

export interface PurgePlan {
  asOf: string;
  items: { childId: string; recordType: RecordType; eligibleOn: string }[];
  held: string[];
}

/**
 * Retention policy, child departure and legal hold (BRD v2.3 §36.3).
 *
 * This service only records decisions and reports what is due. It cannot delete
 * retained records: the web API's database role has no DELETE on them, and the
 * purge itself is a separate maintenance job (RetentionPurger) run with owner
 * credentials. Audit entries carry ids, dates and counts only; never reasons or names.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Admins of a centre only. A user with no centre fails closed rather than seeing the whole organisation. */
  private async adminCtx(user: RequestUser, action: string): Promise<{ orgId: string; centreId: string }> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException('Not authorized for this centre');
    await this.authorization.assertRole(user, ADMIN_ROLES, action);
    return { orgId: user.orgId, centreId: user.centreId };
  }

  private assertSameCentre(user: RequestUser, centreId: string): void {
    if (user.role === 'CENTRE_ADMIN' && user.centreId !== centreId) throw new ForbiddenException('Not authorized for this centre');
  }

  private async timezone(tx: Prisma.TransactionClient, centreId: string): Promise<string> {
    return (await tx.centre.findUnique({ where: { id: centreId }, select: { timezone: true } }))?.timezone ?? 'Australia/Sydney';
  }

  private async overrides(tx: Prisma.TransactionClient, centreId: string): Promise<Map<string, number>> {
    const rows = await tx.centreRetentionOverride.findMany({ where: { centreId } });
    return new Map(rows.map((r) => [r.recordType, r.years]));
  }

  private async record(user: RequestUser, centreId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
    await this.audit.record({ orgId: user.orgId as string, centreId, actorUserId: user.userId, actorRole: user.role, action, entityType, entityId, outcome: 'SUCCESS', metadata });
  }

  // ------------------------------------------------------------------ policy

  async effectivePolicy(admin: RequestUser): Promise<RetentionPolicy> {
    const ctx = await this.adminCtx(admin, 'retention.policy');
    const overrides = await this.tenancy.withTenant(ctx, (tx) => this.overrides(tx, ctx.centreId));
    return this.compose(overrides);
  }

  private compose(overrides: Map<string, number>): RetentionPolicy {
    const policy = {} as RetentionPolicy;
    for (const type of RECORD_TYPES) {
      const rule = RETENTION_DEFAULTS[type];
      const years = overrides.get(type);
      policy[type] = 'untilAge' in rule ? { untilAge: rule.untilAge, source: 'default' } : { years: years ?? rule.years, source: years ? 'centre' : 'default' };
    }
    return policy;
  }

  async setRetentionOverride(admin: RequestUser, recordType: string, years: number): Promise<PolicyEntry> {
    const ctx = await this.adminCtx(admin, 'retention.override');
    if (!isRecordType(recordType)) throw new BadRequestException('Unknown record type');
    const rule = RETENTION_DEFAULTS[recordType];
    if ('untilAge' in rule) throw new BadRequestException('Incident records are kept until the child is 25 and cannot be changed');
    if (!Number.isInteger(years) || years < rule.years || years > MAX_OVERRIDE_YEARS) {
      throw new BadRequestException(`Years must be a whole number from ${rule.years} (the legal minimum) to ${MAX_OVERRIDE_YEARS}; a centre can keep records longer, never shorter`);
    }
    await this.tenancy.withTenant(ctx, (tx) =>
      tx.centreRetentionOverride.upsert({
        where: { centreId_recordType: { centreId: ctx.centreId, recordType } },
        create: { orgId: ctx.orgId, centreId: ctx.centreId, recordType, years, updatedByUserId: admin.userId },
        update: { years, updatedByUserId: admin.userId },
      }),
    );
    await this.record(admin, ctx.centreId, 'retention.override_set', 'Centre', ctx.centreId, { recordType, years });
    return { years, source: 'centre' };
  }

  // -------------------------------------------------- departure and legal hold

  async markDeparted(admin: RequestUser, childId: string, input: { date: string }, now: Date = new Date()): Promise<{ childId: string; departedOn: string }> {
    const ctx = await this.adminCtx(admin, 'child.depart');
    const date = input?.date;
    // Date.parse guards 2026-02-30 and friends: an invalid Date would throw on toISOString instead of a clean 400.
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || dayString(new Date(`${date}T00:00:00Z`)) !== date) {
      throw new BadRequestException('date must be a valid date (YYYY-MM-DD)');
    }
    const child = await this.tenancy.withTenant(ctx, async (tx) => {
      const found = await tx.child.findUnique({ where: { id: childId } });
      if (!found) throw new NotFoundException('Child not found');
      this.assertSameCentre(admin, found.centreId);
      if (found.departedOn) throw new ConflictException('This child is already marked as departed');
      if (date > localDate(await this.timezone(tx, found.centreId), now)) throw new BadRequestException('The departure date cannot be in the future');
      if (date < dayString(found.dateOfBirth)) throw new BadRequestException('The departure date cannot be before the date of birth');
      // Conditional so two admins marking the same child cannot both win.
      const claimed = await tx.child.updateMany({ where: { id: childId, departedOn: null }, data: { departedOn: new Date(`${date}T00:00:00Z`) } });
      if (claimed.count !== 1) throw new ConflictException('This child is already marked as departed');
      return found;
    });
    await this.record(admin, child.centreId, 'child.departed', 'Child', childId, { childId, date });
    return { childId, departedOn: date };
  }

  async reinstateChild(admin: RequestUser, childId: string): Promise<{ childId: string }> {
    const ctx = await this.adminCtx(admin, 'child.reinstate');
    const child = await this.tenancy.withTenant(ctx, async (tx) => {
      const found = await tx.child.findUnique({ where: { id: childId } });
      if (!found) throw new NotFoundException('Child not found');
      this.assertSameCentre(admin, found.centreId);
      if (!found.departedOn) throw new ConflictException('This child has not departed');
      if (found.anonymisedAt) throw new ConflictException('This child record has already been anonymised and cannot be reinstated');
      const claimed = await tx.child.updateMany({ where: { id: childId, departedOn: { not: null }, anonymisedAt: null }, data: { departedOn: null } });
      if (claimed.count !== 1) throw new ConflictException('This child record can no longer be reinstated');
      return found;
    });
    await this.record(admin, child.centreId, 'child.reinstated', 'Child', childId, { childId });
    return { childId };
  }

  async setLegalHold(admin: RequestUser, childId: string, input: { hold: boolean; reason?: string }): Promise<{ childId: string; legalHold: boolean }> {
    const ctx = await this.adminCtx(admin, 'child.legal_hold');
    const hold = input?.hold === true;
    const reason = cleanText(input?.reason);
    if (hold && (!reason || reason.length > MAX_REASON)) throw new BadRequestException(`A legal hold needs a reason of up to ${MAX_REASON} characters`);
    const child = await this.tenancy.withTenant(ctx, async (tx) => {
      const found = await tx.child.findUnique({ where: { id: childId } });
      if (!found) throw new NotFoundException('Child not found');
      this.assertSameCentre(admin, found.centreId);
      await tx.child.update({ where: { id: childId }, data: { legalHold: hold, legalHoldReason: hold ? reason : null } });
      return found;
    });
    await this.record(admin, child.centreId, 'child.legal_hold_set', 'Child', childId, { childId, hold });
    return { childId, legalHold: hold };
  }

  /** What the admin screen shows for one child: departure, hold (with its reason, which admins entered) and whether the record was anonymised. */
  async childStatus(admin: RequestUser, childId: string) {
    const ctx = await this.adminCtx(admin, 'retention.child_status');
    const child = await this.tenancy.withTenant(ctx, (tx) => tx.child.findUnique({ where: { id: childId } }));
    if (!child) throw new NotFoundException('Child not found');
    this.assertSameCentre(admin, child.centreId);
    return {
      childId: child.id,
      departedOn: child.departedOn ? dayString(child.departedOn) : null,
      legalHold: child.legalHold,
      legalHoldReason: child.legalHoldReason,
      anonymised: child.anonymisedAt !== null,
    };
  }

  // -------------------------------------------------------------------- plan

  /** What is due for purging in the admin's centre as of today (centre-local). Read-only; ids and dates only. */
  async plan(admin: RequestUser, now: Date = new Date()): Promise<PurgePlan> {
    const ctx = await this.adminCtx(admin, 'retention.plan');
    return this.tenancy.withTenant(ctx, async (tx) => {
      const asOf = localDate(await this.timezone(tx, ctx.centreId), now);
      const overrides = await this.overrides(tx, ctx.centreId);
      const children = await tx.child.findMany({
        where: { centreId: ctx.centreId, departedOn: { not: null }, anonymisedAt: null },
        select: { id: true, dateOfBirth: true, departedOn: true, legalHold: true },
        orderBy: { id: 'asc' },
      });

      const plan: PurgePlan = { asOf, items: [], held: [] };
      for (const child of children) {
        if (child.legalHold) {
          plan.held.push(child.id);
          continue;
        }
        for (const type of RECORD_TYPES) {
          const due = eligibleOn(type, dayString(child.departedOn as Date), dayString(child.dateOfBirth), overrides.get(type));
          if (due <= asOf) plan.items.push({ childId: child.id, recordType: type, eligibleOn: due });
        }
      }
      return plan;
    });
  }
}
