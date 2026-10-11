import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AllergySeverity, ImmunisationSource, ImmunisationStatus, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const SEVERITY_RANK: Record<AllergySeverity, number> = { ANAPHYLAXIS: 0, SEVERE: 1, MODERATE: 2, MILD: 3 };
const DAY_MS = 86_400_000;

export interface AddAllergyInput {
  allergen: string;
  severity: AllergySeverity;
  reaction?: string;
  actionPlan?: string;
  replacesId?: string;
}

export type ImmunisationFlag = 'OK' | 'CHECK';

/** A recorded status is only trusted while its statement is under a year old. */
export function immunisationFlag(status: ImmunisationStatus, statementDate: string | null, today: string): ImmunisationFlag {
  if (status === 'UNKNOWN') return 'CHECK';
  if (status !== 'UP_TO_DATE') return 'OK';
  if (!statementDate) return 'CHECK';
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${statementDate}T00:00:00Z`)) / DAY_MS;
  return ageDays > 365 ? 'CHECK' : 'OK';
}

function centreToday(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function parseDate(value: string, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} must be a real date (YYYY-MM-DD)`);
  }
  return value;
}

function text(value: string | undefined, label: string, min: number, max: number): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length < min || v.length > max) throw new BadRequestException(`${label} must be ${min === 0 ? 'at most' : `${min} to`} ${max} characters`);
  return v;
}

function optionalText(value: string | undefined, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  if (v.length > max) throw new BadRequestException(`${label} must be at most ${max} characters`);
  return v || null;
}

/**
 * Allergy and immunisation records (U4a). Safety-critical, so it is never gated by a plan. History is kept: an
 * allergy is ended (never edited or deleted) and a dose is voided with a reason. The audit log holds ids and
 * categories only, never the allergen, reaction or vaccine text, because those are health information.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  private assertAdmin(user: RequestUser): { orgId: string; centreId: string } {
    if (!user.orgId || !user.centreId) throw new ForbiddenException('Requires an administrator with centre context');
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can change health records');
    return { orgId: user.orgId, centreId: user.centreId };
  }

  private async audited(admin: RequestUser, ctx: { orgId: string; centreId: string }, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
    await this.audit.record({
      orgId: ctx.orgId,
      centreId: ctx.centreId,
      actorUserId: admin.userId,
      actorRole: admin.role,
      action,
      entityType,
      entityId,
      outcome: 'SUCCESS',
      metadata,
    });
  }

  /** The child must be in the administrator's centre. Another centre's or org's child is simply not found. */
  private async childInCentre(tx: Prisma.TransactionClient, ctx: { orgId: string; centreId: string }, childId: string) {
    const child = await tx.child.findFirst({ where: { id: childId, orgId: ctx.orgId, centreId: ctx.centreId }, select: { id: true, dateOfBirth: true, centre: { select: { timezone: true } } } });
    if (!child) throw new NotFoundException('Child not found');
    return child;
  }

  private present(a: { id: string; childId: string; allergen: string; severity: AllergySeverity; reaction: string | null; actionPlan: string | null; createdAt: Date; replacesId: string | null; endedAt: Date | null; endReason?: string | null }, ended = false) {
    return {
      id: a.id,
      childId: a.childId,
      allergen: a.allergen,
      severity: a.severity,
      reaction: a.reaction,
      actionPlan: a.actionPlan,
      createdAt: a.createdAt,
      replacesId: a.replacesId,
      endedAt: a.endedAt,
      ...(ended ? { endReason: a.endReason ?? null } : {}),
    };
  }

  async addAllergy(admin: RequestUser, childId: string, dto: AddAllergyInput, now: Date = new Date()) {
    const ctx = this.assertAdmin(admin);
    const allergen = text(dto.allergen, 'Allergen', 1, 100);
    if (!(dto.severity in SEVERITY_RANK)) throw new BadRequestException('Severity is not valid');
    const reaction = optionalText(dto.reaction, 'Reaction', 1000);
    const actionPlan = optionalText(dto.actionPlan, 'Action plan', 1000);

    const created = await this.tenancy.withTenant(ctx, async (tx) => {
      await this.childInCentre(tx, ctx, childId);
      // Serialise per child so two simultaneous entries of the same allergen cannot both pass the duplicate check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('allergy'), hashtext(${childId}))`;
      const active = await tx.childAllergy.findMany({ where: { childId, endedAt: null } });
      if (dto.replacesId) {
        const old = active.find((a) => a.id === dto.replacesId);
        if (!old) throw new BadRequestException('The allergy being replaced must be an active allergy of this child');
        await tx.childAllergy.update({ where: { id: old.id }, data: { endedAt: now, endedByUserId: admin.userId, endReason: 'Replaced' } });
      }
      const others = active.filter((a) => a.id !== dto.replacesId);
      if (others.some((a) => a.allergen.toLowerCase() === allergen.toLowerCase())) {
        throw new ConflictException('This allergy is already recorded for the child');
      }
      return tx.childAllergy.create({
        data: { orgId: ctx.orgId, centreId: ctx.centreId, childId, allergen, severity: dto.severity, reaction, actionPlan, recordedByUserId: admin.userId, createdAt: now, replacesId: dto.replacesId ?? null },
      });
    });
    await this.audited(admin, ctx, 'health.allergy_added', 'ChildAllergy', created.id, { childId, severity: created.severity });
    return this.present(created);
  }

  async endAllergy(admin: RequestUser, childId: string, allergyId: string, reason: string, now: Date = new Date()) {
    const ctx = this.assertAdmin(admin);
    const why = text(reason, 'Reason', 3, 300);
    const ended = await this.tenancy.withTenant(ctx, async (tx) => {
      await this.childInCentre(tx, ctx, childId);
      const allergy = await tx.childAllergy.findFirst({ where: { id: allergyId, childId } });
      if (!allergy) throw new NotFoundException('Allergy not found');
      if (allergy.endedAt) throw new ConflictException('This allergy has already been ended');
      return tx.childAllergy.update({ where: { id: allergyId }, data: { endedAt: now, endedByUserId: admin.userId, endReason: why } });
    });
    await this.audited(admin, ctx, 'health.allergy_ended', 'ChildAllergy', allergyId, { childId });
    return { id: ended.id, endedAt: ended.endedAt };
  }

  async listAllergies(user: RequestUser, childId: string, opts: { includeEnded?: boolean } = {}) {
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    const includeEnded = !!opts.includeEnded && user.role !== 'PARENT';
    const orgId = user.orgId as string;
    const rows = await this.tenancy.withTenant({ orgId, centreId: user.centreId }, (tx) =>
      tx.childAllergy.findMany({ where: { childId, ...(includeEnded ? {} : { endedAt: null }) } }),
    );
    return rows
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.allergen.localeCompare(b.allergen, 'en', { sensitivity: 'base' }))
      .map((a) => this.present(a, includeEnded));
  }

  async addImmunisation(admin: RequestUser, childId: string, dto: { vaccine: string; doseDate: string; source: ImmunisationSource }, now: Date = new Date()) {
    const ctx = this.assertAdmin(admin);
    const vaccine = text(dto.vaccine, 'Vaccine', 1, 100);
    const doseDate = parseDate(dto.doseDate, 'Dose date');
    if (!['CERTIFICATE', 'AIR_STATEMENT', 'PARENT_DECLARED'].includes(dto.source)) throw new BadRequestException('Source is not valid');

    const created = await this.tenancy.withTenant(ctx, async (tx) => {
      const child = await this.childInCentre(tx, ctx, childId);
      if (doseDate > centreToday(child.centre.timezone, now)) throw new BadRequestException('The dose date cannot be in the future');
      if (doseDate < child.dateOfBirth.toISOString().slice(0, 10)) throw new BadRequestException('The dose date cannot be before the child was born');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('immunisation'), hashtext(${childId}))`;
      const existing = await tx.childImmunisation.findMany({ where: { childId, voidedAt: null, doseDate: new Date(`${doseDate}T00:00:00Z`) } });
      if (existing.some((i) => i.vaccine.toLowerCase() === vaccine.toLowerCase())) throw new ConflictException('This dose is already recorded');
      return tx.childImmunisation.create({
        data: { orgId: ctx.orgId, centreId: ctx.centreId, childId, vaccine, doseDate: new Date(`${doseDate}T00:00:00Z`), source: dto.source, recordedByUserId: admin.userId, createdAt: now },
      });
    });
    await this.audited(admin, ctx, 'health.immunisation_added', 'ChildImmunisation', created.id, { childId, source: created.source });
    return { id: created.id, childId, vaccine: created.vaccine, doseDate: created.doseDate.toISOString().slice(0, 10), source: created.source, voidedAt: null };
  }

  async voidImmunisation(admin: RequestUser, childId: string, immunisationId: string, reason: string, now: Date = new Date()) {
    const ctx = this.assertAdmin(admin);
    const why = text(reason, 'Reason', 3, 300);
    const voided = await this.tenancy.withTenant(ctx, async (tx) => {
      await this.childInCentre(tx, ctx, childId);
      const dose = await tx.childImmunisation.findFirst({ where: { id: immunisationId, childId } });
      if (!dose) throw new NotFoundException('Immunisation record not found');
      if (dose.voidedAt) throw new ConflictException('This record has already been voided');
      return tx.childImmunisation.update({ where: { id: immunisationId }, data: { voidedAt: now, voidedByUserId: admin.userId, voidReason: why } });
    });
    await this.audited(admin, ctx, 'health.immunisation_voided', 'ChildImmunisation', immunisationId, { childId });
    return { id: voided.id, voidedAt: voided.voidedAt };
  }

  async setImmunisationStatus(admin: RequestUser, childId: string, dto: { status: ImmunisationStatus; statementDate?: string; note?: string }, now: Date = new Date()) {
    const ctx = this.assertAdmin(admin);
    if (!['UNKNOWN', 'UP_TO_DATE', 'CATCH_UP_PLAN', 'MEDICAL_EXEMPTION'].includes(dto.status)) throw new BadRequestException('Status is not valid');
    const note = optionalText(dto.note, 'Note', 500);
    if (dto.status === 'MEDICAL_EXEMPTION' && !note) throw new BadRequestException('A medical exemption needs a note');
    const statementDate = dto.statementDate ? parseDate(dto.statementDate, 'Statement date') : null;

    const row = await this.tenancy.withTenant(ctx, async (tx) => {
      const child = await this.childInCentre(tx, ctx, childId);
      if (statementDate && statementDate > centreToday(child.centre.timezone, now)) throw new BadRequestException('The statement date cannot be in the future');
      const data = { status: dto.status, statementDate: statementDate ? new Date(`${statementDate}T00:00:00Z`) : null, note, updatedByUserId: admin.userId, updatedAt: now };
      return tx.childImmunisationStatus.upsert({
        where: { childId },
        create: { orgId: ctx.orgId, centreId: ctx.centreId, childId, ...data },
        update: data,
      });
    });
    await this.audited(admin, ctx, 'health.immunisation_status_set', 'ChildImmunisationStatus', row.id, { childId, status: row.status });
    return { childId, status: row.status, statementDate: row.statementDate ? row.statementDate.toISOString().slice(0, 10) : null, note: row.note, updatedAt: row.updatedAt };
  }

  async getHealth(user: RequestUser, childId: string, now: Date = new Date()) {
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    const orgId = user.orgId as string;
    const { allergies, immunisations, status, timezone } = await this.tenancy.withTenant({ orgId, centreId: user.centreId }, async (tx) => {
      const child = await tx.child.findFirst({ where: { id: childId }, select: { centre: { select: { timezone: true } } } });
      return {
        allergies: await tx.childAllergy.findMany({ where: { childId, endedAt: null } }),
        immunisations: await tx.childImmunisation.findMany({ where: { childId, voidedAt: null }, orderBy: [{ doseDate: 'desc' }, { createdAt: 'desc' }] }),
        status: await tx.childImmunisationStatus.findUnique({ where: { childId } }),
        timezone: child?.centre.timezone ?? 'Australia/Sydney',
      };
    });
    const statementDate = status?.statementDate ? status.statementDate.toISOString().slice(0, 10) : null;
    const key: ImmunisationStatus = status?.status ?? 'UNKNOWN';
    return {
      childId,
      allergies: allergies
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.allergen.localeCompare(b.allergen, 'en', { sensitivity: 'base' }))
        .map((a) => this.present(a)),
      immunisations: immunisations.map((i) => ({ id: i.id, childId: i.childId, vaccine: i.vaccine, doseDate: i.doseDate.toISOString().slice(0, 10), source: i.source })),
      immunisationStatus: { status: key, statementDate, note: status?.note ?? null, flag: immunisationFlag(key, statementDate, centreToday(timezone, now)) },
    };
  }

  async allergyRegister(user: RequestUser, now: Date = new Date()) {
    void now;
    if (!user.orgId || !user.centreId) throw new ForbiddenException('Requires a staff user with centre context');
    const isAdmin = ADMIN_ROLES.includes(user.role);
    if (!isAdmin && user.role !== 'EDUCATOR') throw new ForbiddenException('Only staff can see the allergy register');
    const ctx = { orgId: user.orgId, centreId: user.centreId };

    const children = await this.tenancy.withTenant(ctx, async (tx) => {
      let roomIds: string[] | undefined;
      if (!isAdmin) {
        const assignments = await tx.staffRoomAssignment.findMany({ where: { userId: user.userId, endDate: null }, select: { roomId: true } });
        roomIds = assignments.map((a) => a.roomId);
      }
      return tx.child.findMany({
        where: {
          centreId: ctx.centreId,
          departedOn: null,
          ...(roomIds ? { roomId: { in: roomIds } } : {}),
          allergies: { some: { endedAt: null } },
        },
        select: { id: true, firstName: true, lastName: true, room: { select: { name: true } }, allergies: { where: { endedAt: null }, select: { allergen: true, severity: true } } },
      });
    });

    const worst = (c: (typeof children)[number]) => Math.min(...c.allergies.map((a) => SEVERITY_RANK[a.severity]));
    return children
      .sort((a, b) => worst(a) - worst(b) || a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }))
      .map((c) => ({
        childId: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        roomName: c.room?.name ?? null,
        allergies: c.allergies.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.allergen.localeCompare(b.allergen, 'en', { sensitivity: 'base' })),
      }));
  }
}
