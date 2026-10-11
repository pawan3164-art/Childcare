import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ROLES, AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { DEFAULT_PLAN, isModuleKey, isPlanKey, moduleDef, MODULES, PLANS, PlanKey } from './features.registry';

export interface ModuleEntry {
  key: string;
  label: string;
  critical: boolean;
  includedInPlan: boolean;
  enabled: boolean;
}

export interface PlanStatus {
  plan: PlanKey;
  validUntil: string | null;
  expired: boolean;
}

/**
 * Which optional modules an organisation's plan includes and which a centre has switched off. The server
 * is the authority: the apps hide what is off, but every gated route is refused here too (see ModuleGuard).
 */
@Injectable()
export class FeaturesService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Admins of a centre. A user with no centre fails closed. */
  private async adminCtx(user: RequestUser, action: string): Promise<{ orgId: string; centreId: string }> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException('Not authorized for this centre');
    await this.authorization.assertRole(user, ADMIN_ROLES, action);
    return { orgId: user.orgId, centreId: user.centreId };
  }

  // -------------------------------------------------------------------- plan

  private planRow(orgId: string) {
    return this.prisma.organisationPlan.findUnique({ where: { orgId } });
  }

  /**
   * An expired plan degrades to 'core'; it never locks anything critical (PLT-002). An unknown plan name
   * also falls to the minimum, never to everything.
   */
  async effectivePlan(orgId: string, now: Date = new Date()): Promise<PlanKey> {
    const row = await this.planRow(orgId);
    if (!row) return DEFAULT_PLAN;
    if (!isPlanKey(row.plan)) return 'core';
    if (row.validUntil && row.validUntil.getTime() <= now.getTime()) return 'core';
    return row.plan;
  }

  private async planStatus(orgId: string, now: Date): Promise<PlanStatus> {
    const row = await this.planRow(orgId);
    const expired = !!row?.validUntil && row.validUntil.getTime() <= now.getTime();
    return { plan: await this.effectivePlan(orgId, now), validUntil: row?.validUntil ? row.validUntil.toISOString() : null, expired };
  }

  async getPlan(user: RequestUser, now: Date = new Date()): Promise<PlanStatus> {
    if (!user.orgId) throw new ForbiddenException();
    await this.authorization.assertRole(user, ADMIN_ROLES, 'plan.read');
    return this.planStatus(user.orgId, now);
  }

  async setPlan(platformAdmin: RequestUser, orgId: string, plan: string, validUntil?: string | null): Promise<PlanStatus> {
    await this.authorization.assertRole(platformAdmin, ['PLATFORM_ADMIN'], 'plan.change');
    if (!isPlanKey(plan)) throw new BadRequestException('Unknown plan');
    let until: Date | null = null;
    if (validUntil !== undefined && validUntil !== null) {
      until = new Date(validUntil);
      if (typeof validUntil !== 'string' || Number.isNaN(until.getTime())) throw new BadRequestException('validUntil must be a date');
    }
    if (!(await this.prisma.organisation.findUnique({ where: { id: orgId }, select: { id: true } }))) throw new NotFoundException('Organisation not found');

    await this.prisma.organisationPlan.upsert({ where: { orgId }, create: { orgId, plan, validUntil: until }, update: { plan, validUntil: until } });
    // Written against the organisation that changed, not the platform administrator's own.
    await this.audit.record({
      orgId,
      actorUserId: platformAdmin.userId,
      actorRole: platformAdmin.role,
      action: 'plan.changed',
      entityType: 'Organisation',
      entityId: orgId,
      outcome: 'SUCCESS',
      metadata: { plan, validUntil: until ? until.toISOString() : null },
    });
    return this.planStatus(orgId, new Date());
  }

  // ----------------------------------------------------------------- modules

  private async switchedOff(orgId: string, centreId: string): Promise<Set<string>> {
    const rows = await this.tenancy.withTenant({ orgId, centreId }, (tx) => tx.centreModuleSetting.findMany({ where: { centreId, enabled: false } }));
    return new Set(rows.map((r) => r.moduleKey));
  }

  /** True when the module is available to this centre right now. Critical modules always are. */
  async isEnabled(orgId: string, centreId: string | null, key: string, now: Date = new Date()): Promise<boolean> {
    const def = moduleDef(key);
    if (!def) return false;
    if (def.critical) return true;
    if (!PLANS[await this.effectivePlan(orgId, now)].includes(key)) return false;
    if (!centreId) return true;
    return !(await this.switchedOff(orgId, centreId)).has(key);
  }

  private entries(plan: PlanKey, off: Set<string>): ModuleEntry[] {
    return MODULES.map((m) => {
      const includedInPlan = PLANS[plan].includes(m.key);
      return { key: m.key, label: m.label, critical: m.critical, includedInPlan, enabled: m.critical || (includedInPlan && !off.has(m.key)) };
    });
  }

  async list(admin: RequestUser, now: Date = new Date()): Promise<ModuleEntry[]> {
    const ctx = await this.adminCtx(admin, 'modules.list');
    return this.entries(await this.effectivePlan(ctx.orgId, now), await this.switchedOff(ctx.orgId, ctx.centreId));
  }

  async setEnabled(admin: RequestUser, key: string, enabled: boolean, now: Date = new Date()): Promise<ModuleEntry> {
    const ctx = await this.adminCtx(admin, 'modules.toggle');
    if (!isModuleKey(key)) throw new BadRequestException('Unknown module');
    if (moduleDef(key)?.critical) throw new BadRequestException('This module protects children and cannot be switched off');
    const plan = await this.effectivePlan(ctx.orgId, now);
    if (!PLANS[plan].includes(key)) throw new ForbiddenException('This module is not included in your plan');

    await this.tenancy.withTenant(ctx, (tx) =>
      tx.centreModuleSetting.upsert({
        where: { centreId_moduleKey: { centreId: ctx.centreId, moduleKey: key } },
        create: { orgId: ctx.orgId, centreId: ctx.centreId, moduleKey: key, enabled, updatedByUserId: admin.userId },
        update: { enabled, updatedByUserId: admin.userId },
      }),
    );
    await this.audit.record({
      orgId: ctx.orgId,
      centreId: ctx.centreId,
      actorUserId: admin.userId,
      actorRole: admin.role,
      action: 'module.toggled',
      entityType: 'Centre',
      entityId: ctx.centreId,
      outcome: 'SUCCESS',
      metadata: { moduleKey: key, enabled },
    });
    return this.entries(plan, await this.switchedOff(ctx.orgId, ctx.centreId)).find((e) => e.key === key) as ModuleEntry;
  }

  /** The module keys this user's centre has right now, in registry order. Sent to the apps with the profile. */
  async enabledKeys(user: RequestUser, now: Date = new Date()): Promise<string[]> {
    if (!user.orgId) return [];
    const plan = await this.effectivePlan(user.orgId, now);
    const off = user.centreId ? await this.switchedOff(user.orgId, user.centreId) : new Set<string>();
    return this.entries(plan, off)
      .filter((e) => e.enabled)
      .map((e) => e.key);
  }
}
