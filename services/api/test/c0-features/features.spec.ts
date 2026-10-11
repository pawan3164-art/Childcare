import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FeaturesService } from '../../src/features/features.service';
import { MODULES } from '../../src/features/features.registry';
import { appPrisma, disconnectAll, fixturePrisma, setTenantContext } from '../test-utils';
import {
  auditFor, buildFeatures, CRITICAL, db, makePlatformAdmin, makeUser, NEXT_YEAR, NOW, OPTIONAL_FULL_ONLY,
  secondCentre, setPlanRow, setupOrg, YESTERDAY,
} from './helpers';

describe('C0 FeaturesService (CUS-001, PLT-001, PLT-002)', () => {
  let features: FeaturesService;
  let prismaService: { onModuleDestroy?: () => Promise<void> };
  let platform: Awaited<ReturnType<typeof makePlatformAdmin>>;

  beforeAll(async () => {
    const built = await buildFeatures();
    features = built.features;
    prismaService = built.prismaService as any;
    platform = await makePlatformAdmin();
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  describe('effectivePlan', () => {
    it('no row means full', async () => {
      const o = await setupOrg('plan-none');
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('full');
    });

    it('core row is core, full row with future or null validUntil is full', async () => {
      const o = await setupOrg('plan-rows');
      await setPlanRow(o.tenant.orgId, 'core');
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('core');
      await setPlanRow(o.tenant.orgId, 'full', null);
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('full');
      await setPlanRow(o.tenant.orgId, 'full', NEXT_YEAR);
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('full');
    });

    it('an expired plan degrades to core; validUntil exactly now is expired (<=)', async () => {
      const o = await setupOrg('plan-expired');
      await setPlanRow(o.tenant.orgId, 'full', YESTERDAY);
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('core');
      await setPlanRow(o.tenant.orgId, 'full', NOW);
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('core');
      await setPlanRow(o.tenant.orgId, 'full', new Date(NOW.getTime() + 1000));
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('full');
    });

    it('an unknown plan string fails to core, not to full', async () => {
      const o = await setupOrg('plan-unknown');
      await setPlanRow(o.tenant.orgId, 'enterprise-plus');
      expect(await features.effectivePlan(o.tenant.orgId, NOW)).toBe('core');
    });

    it('defaults now to real time', async () => {
      const o = await setupOrg('plan-realtime');
      await setPlanRow(o.tenant.orgId, 'full', new Date(Date.now() - 60_000));
      expect(await features.effectivePlan(o.tenant.orgId)).toBe('core');
      await setPlanRow(o.tenant.orgId, 'full', new Date(Date.now() + 3_600_000));
      expect(await features.effectivePlan(o.tenant.orgId)).toBe('full');
    });
  });

  describe('isEnabled', () => {
    it('critical modules are always on, even with plan expired and a stray disabled setting row', async () => {
      const o = await setupOrg('crit');
      await setPlanRow(o.tenant.orgId, 'full', YESTERDAY);
      for (const key of CRITICAL) {
        await db.centreModuleSetting.create({
          data: { orgId: o.tenant.orgId, centreId: o.tenant.centreId, moduleKey: key, enabled: false, updatedByUserId: o.admin.userId },
        });
      }
      for (const key of CRITICAL) expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, key, NOW)).toBe(true);
    });

    it('critical modules are on under core, unknown plan, and no plan', async () => {
      const o = await setupOrg('crit-plans');
      for (const plan of [null, 'core', 'bogus']) {
        if (plan) await setPlanRow(o.tenant.orgId, plan);
        for (const key of CRITICAL) expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, key, NOW)).toBe(true);
      }
    });

    it('optional modules follow the plan and the centre switch', async () => {
      const o = await setupOrg('optional');
      const { orgId, centreId } = o.tenant;
      for (const key of ['family_requests', ...OPTIONAL_FULL_ONLY]) expect(await features.isEnabled(orgId, centreId, key, NOW)).toBe(true);
      await db.centreModuleSetting.create({ data: { orgId, centreId, moduleKey: 'learning', enabled: false, updatedByUserId: o.admin.userId } });
      expect(await features.isEnabled(orgId, centreId, 'learning', NOW)).toBe(false);
      expect(await features.isEnabled(orgId, centreId, 'billing', NOW)).toBe(true);
      await setPlanRow(orgId, 'core');
      expect(await features.isEnabled(orgId, centreId, 'billing', NOW)).toBe(false);
      expect(await features.isEnabled(orgId, centreId, 'family_requests', NOW)).toBe(true);
    });

    it('a stray enabled=true row cannot grant a module outside the plan', async () => {
      const o = await setupOrg('stray-on');
      const { orgId, centreId } = o.tenant;
      await setPlanRow(orgId, 'core');
      await db.centreModuleSetting.create({ data: { orgId, centreId, moduleKey: 'billing', enabled: true, updatedByUserId: o.admin.userId } });
      expect(await features.isEnabled(orgId, centreId, 'billing', NOW)).toBe(false);
    });

    it('unknown keys are false', async () => {
      const o = await setupOrg('unknown-key');
      for (const key of ['nope', '', 'Learning', 'constructor']) {
        expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, key, NOW)).toBe(false);
      }
    });
  });

  describe('list', () => {
    it('returns every module in registry order with plan inclusion and state', async () => {
      const o = await setupOrg('list');
      const rows = await features.list(o.admin, NOW);
      expect(rows.map((r) => r.key)).toEqual(MODULES.map((m) => m.key));
      expect(rows.every((r) => r.enabled && r.includedInPlan)).toBe(true);
      expect(rows[0]).toEqual({ key: 'attendance', label: 'Attendance', critical: true, includedInPlan: true, enabled: true });
    });

    it('reflects a core plan and a centre switch', async () => {
      const o = await setupOrg('list-core');
      await setPlanRow(o.tenant.orgId, 'core');
      await features.setEnabled(o.admin, 'family_requests', false, NOW);
      const byKey = Object.fromEntries((await features.list(o.admin, NOW)).map((r) => [r.key, r]));
      expect(byKey.learning).toMatchObject({ includedInPlan: false, enabled: false, critical: false });
      expect(byKey.family_requests).toMatchObject({ includedInPlan: true, enabled: false });
      expect(byKey.medication).toMatchObject({ includedInPlan: true, enabled: true, critical: true });
    });

    it('admin roles with org and centre may list; others are forbidden', async () => {
      const o = await setupOrg('list-roles');
      const orgAdminWithCentre = { ...o.orgAdmin, centreId: o.tenant.centreId };
      const platformWithCentre = { ...platform, orgId: o.tenant.orgId, centreId: o.tenant.centreId };
      await expect(features.list(o.admin, NOW)).resolves.toHaveLength(MODULES.length);
      await expect(features.list(orgAdminWithCentre, NOW)).resolves.toHaveLength(MODULES.length);
      await expect(features.list(platformWithCentre, NOW)).resolves.toHaveLength(MODULES.length);
      await expect(features.list(o.educator, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(features.list(o.parent, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fails closed without orgId or centreId', async () => {
      const o = await setupOrg('list-closed');
      await expect(features.list({ ...o.admin, centreId: null }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(features.list(o.orgAdmin, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(features.list({ ...o.admin, orgId: null }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(features.list(platform, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('setEnabled', () => {
    it('switches an optional module off and on, keeping one row per centre+module', async () => {
      const o = await setupOrg('toggle');
      const off = await features.setEnabled(o.admin, 'learning', false, NOW);
      expect(off).toEqual({ key: 'learning', label: 'Learning', critical: false, includedInPlan: true, enabled: false });
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, 'learning', NOW)).toBe(false);
      const on = await features.setEnabled(o.admin, 'learning', true, NOW);
      expect(on.enabled).toBe(true);
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, 'learning', NOW)).toBe(true);
      const rows = await db.centreModuleSetting.findMany({ where: { centreId: o.tenant.centreId, moduleKey: 'learning' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ enabled: true, orgId: o.tenant.orgId, updatedByUserId: o.admin.userId });
    });

    it('audits module.toggled against the Centre with moduleKey and enabled', async () => {
      const o = await setupOrg('toggle-audit');
      await features.setEnabled(o.admin, 'checklists', false, NOW);
      await features.setEnabled(o.admin, 'checklists', true, NOW);
      const entries = await auditFor(o.tenant.centreId, 'module.toggled');
      expect(entries).toHaveLength(2);
      for (const e of entries) {
        expect(e).toMatchObject({ entityType: 'Centre', orgId: o.tenant.orgId, actorUserId: o.admin.userId, outcome: 'SUCCESS' });
      }
      expect(entries.map((e) => e.metadata).sort((a: any, b: any) => Number(a.enabled) - Number(b.enabled))).toEqual([
        { moduleKey: 'checklists', enabled: false },
        { moduleKey: 'checklists', enabled: true },
      ]);
    });

    it('unknown key is BadRequest', async () => {
      const o = await setupOrg('toggle-unknown');
      await expect(features.setEnabled(o.admin, 'nope', false, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('critical modules cannot be switched off, nor switched on, and nothing is written or audited', async () => {
      const o = await setupOrg('toggle-critical');
      for (const key of CRITICAL) {
        await expect(features.setEnabled(o.admin, key, false, NOW)).rejects.toBeInstanceOf(BadRequestException);
        await expect(features.setEnabled(o.admin, key, true, NOW)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await db.centreModuleSetting.count({ where: { centreId: o.tenant.centreId } })).toBe(0);
      expect(await auditFor(o.tenant.centreId, 'module.toggled')).toHaveLength(0);
    });

    it('an optional module outside the plan is Forbidden for enabling and disabling, naming the plan', async () => {
      const o = await setupOrg('toggle-plan');
      await setPlanRow(o.tenant.orgId, 'core');
      for (const key of OPTIONAL_FULL_ONLY) {
        for (const enabled of [true, false]) {
          const err = await features.setEnabled(o.admin, key, enabled, NOW).catch((e) => e);
          expect(err).toBeInstanceOf(ForbiddenException);
          expect(String(err.message)).toMatch(/plan/i);
        }
      }
      expect(await db.centreModuleSetting.count({ where: { centreId: o.tenant.centreId } })).toBe(0);
      await expect(features.setEnabled(o.admin, 'family_requests', false, NOW)).resolves.toMatchObject({ enabled: false });
    });

    it('an expired plan blocks toggling plan-only modules', async () => {
      const o = await setupOrg('toggle-expired');
      await setPlanRow(o.tenant.orgId, 'full', YESTERDAY);
      await expect(features.setEnabled(o.admin, 'learning', false, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only admins of the centre may toggle: educator, parent and centre-less admin are refused', async () => {
      const o = await setupOrg('toggle-roles');
      await expect(features.setEnabled(o.educator, 'learning', false, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(features.setEnabled(o.parent, 'learning', false, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(features.setEnabled({ ...o.admin, centreId: null }, 'learning', false, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      const orgAdminWithCentre = { ...o.orgAdmin, centreId: o.tenant.centreId };
      await expect(features.setEnabled(orgAdminWithCentre, 'learning', false, NOW)).resolves.toMatchObject({ enabled: false });
      expect(await db.centreModuleSetting.count({ where: { centreId: o.tenant.centreId } })).toBe(1);
    });

    it('switching off keeps data and switching on restores it', async () => {
      const o = await setupOrg('toggle-data');
      const child = await fixturePrisma.child.create({
        data: { orgId: o.tenant.orgId, centreId: o.tenant.centreId, roomId: o.tenant.roomId, firstName: 'K', lastName: 'Keep', dateOfBirth: new Date('2023-01-01') },
      });
      const absence = await fixturePrisma.absence.create({
        data: { orgId: o.tenant.orgId, centreId: o.tenant.centreId, childId: child.id, date: new Date('2026-10-14'), isAllowable: false, reason: 'family request' },
      });
      await features.setEnabled(o.admin, 'family_requests', false, NOW);
      expect(await fixturePrisma.absence.findUnique({ where: { id: absence.id } })).not.toBeNull();
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, 'family_requests', NOW)).toBe(false);
      await features.setEnabled(o.admin, 'family_requests', true, NOW);
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, 'family_requests', NOW)).toBe(true);
      expect(await fixturePrisma.absence.findUnique({ where: { id: absence.id } })).not.toBeNull();
      // history kept: both toggles audited
      expect(await auditFor(o.tenant.centreId, 'module.toggled')).toHaveLength(2);
    });

    it('one centre never affects another centre in the same org', async () => {
      const o = await setupOrg('iso-centre');
      const otherCentreId = await secondCentre(o.tenant.orgId);
      const otherAdmin = await makeUser({ orgId: o.tenant.orgId, centreId: otherCentreId }, 'CENTRE_ADMIN');
      await features.setEnabled(o.admin, 'learning', false, NOW);
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, 'learning', NOW)).toBe(false);
      expect(await features.isEnabled(o.tenant.orgId, otherCentreId, 'learning', NOW)).toBe(true);
      expect((await features.list(otherAdmin, NOW)).find((r) => r.key === 'learning')?.enabled).toBe(true);
    });

    it('one org never affects another org', async () => {
      const a = await setupOrg('iso-org-a');
      const b = await setupOrg('iso-org-b');
      await features.setEnabled(a.admin, 'billing', false, NOW);
      expect(await features.isEnabled(b.tenant.orgId, b.tenant.centreId, 'billing', NOW)).toBe(true);
    });

    it('RLS: settings rows are invisible across orgs through the app role', async () => {
      const a = await setupOrg('rls-a');
      const b = await setupOrg('rls-b');
      await features.setEnabled(a.admin, 'learning', false, NOW);
      await features.setEnabled(b.admin, 'billing', false, NOW);

      await setTenantContext(appPrisma, a.tenant.orgId, a.tenant.centreId);
      const asA: any[] = await (appPrisma as any).centreModuleSetting.findMany();
      expect(asA.length).toBeGreaterThan(0);
      expect(asA.every((r) => r.orgId === a.tenant.orgId)).toBe(true);
      expect(asA.some((r) => r.centreId === b.tenant.centreId)).toBe(false);

      await setTenantContext(appPrisma, b.tenant.orgId, b.tenant.centreId);
      const asB: any[] = await (appPrisma as any).centreModuleSetting.findMany();
      expect(asB.every((r) => r.orgId === b.tenant.orgId)).toBe(true);
      expect(asB.some((r) => r.moduleKey === 'billing')).toBe(true);
      expect(asB.some((r) => r.moduleKey === 'learning')).toBe(false);

      // writing a row for another org is rejected
      await expect(
        (appPrisma as any).centreModuleSetting.create({
          data: { orgId: a.tenant.orgId, centreId: a.tenant.centreId, moduleKey: 'checklists', enabled: false, updatedByUserId: b.admin.userId },
        }),
      ).rejects.toBeTruthy();
    });
  });

  describe('enabledKeys', () => {
    it('gives every role the same centre view in registry order', async () => {
      const o = await setupOrg('keys');
      await features.setEnabled(o.admin, 'checklists', false, NOW);
      const expected = MODULES.map((m) => m.key).filter((k) => k !== 'checklists');
      for (const user of [o.admin, o.educator, o.parent]) {
        expect(await features.enabledKeys(user, NOW)).toEqual(expected);
      }
    });

    it('core plan: critical plus family_requests only; switch-off removes family_requests', async () => {
      const o = await setupOrg('keys-core');
      await setPlanRow(o.tenant.orgId, 'core');
      expect(await features.enabledKeys(o.parent, NOW)).toEqual([...CRITICAL, 'family_requests', 'calendar', 'menus']);
      await features.setEnabled(o.admin, 'family_requests', false, NOW);
      expect(await features.enabledKeys(o.educator, NOW)).toEqual([...CRITICAL, 'calendar', 'menus']);
    });

    it('expired plan keeps critical modules', async () => {
      const o = await setupOrg('keys-expired');
      await setPlanRow(o.tenant.orgId, 'full', YESTERDAY);
      const keys = await features.enabledKeys(o.parent, NOW);
      for (const k of CRITICAL) expect(keys).toContain(k);
      for (const k of OPTIONAL_FULL_ONLY) expect(keys).not.toContain(k);
    });

    it('an org-level user (no centre) gets plan-included keys, ignoring centre switches', async () => {
      const o = await setupOrg('keys-org');
      await features.setEnabled(o.admin, 'learning', false, NOW);
      expect(await features.enabledKeys(o.orgAdmin, NOW)).toEqual(MODULES.map((m) => m.key));
      await setPlanRow(o.tenant.orgId, 'core');
      expect(await features.enabledKeys(o.orgAdmin, NOW)).toEqual([...CRITICAL, 'family_requests', 'calendar', 'menus']);
    });
  });

  describe('getPlan', () => {
    it('defaults to full, not expired, for admin roles', async () => {
      const o = await setupOrg('getplan');
      expect(await features.getPlan(o.admin, NOW)).toEqual({ plan: 'full', validUntil: null, expired: false });
      expect(await features.getPlan(o.orgAdmin, NOW)).toEqual({ plan: 'full', validUntil: null, expired: false });
    });

    it('reports validUntil as an ISO string and expired status', async () => {
      const o = await setupOrg('getplan-expired');
      await setPlanRow(o.tenant.orgId, 'full', YESTERDAY);
      const view = await features.getPlan(o.admin, NOW);
      expect(view.validUntil).toBe(YESTERDAY.toISOString());
      expect(view.expired).toBe(true);
      expect(view.plan).toBe('core');
      await setPlanRow(o.tenant.orgId, 'full', NEXT_YEAR);
      expect(await features.getPlan(o.admin, NOW)).toEqual({ plan: 'full', validUntil: NEXT_YEAR.toISOString(), expired: false });
    });

    it('educator and parent are forbidden', async () => {
      const o = await setupOrg('getplan-roles');
      await expect(features.getPlan(o.educator, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(features.getPlan(o.parent, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('setPlan', () => {
    it('is PLATFORM_ADMIN only, including for an own org', async () => {
      const o = await setupOrg('setplan-roles');
      for (const user of [o.admin, o.orgAdmin, o.educator, o.parent]) {
        await expect(features.setPlan(user, o.tenant.orgId, 'core')).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(await db.organisationPlan.findUnique({ where: { orgId: o.tenant.orgId } })).toBeNull();
    });

    it('validates plan, validUntil and org', async () => {
      const o = await setupOrg('setplan-validate');
      await expect(features.setPlan(platform, o.tenant.orgId, 'platinum')).rejects.toBeInstanceOf(BadRequestException);
      await expect(features.setPlan(platform, o.tenant.orgId, 'full', 'not-a-date')).rejects.toBeInstanceOf(BadRequestException);
      await expect(features.setPlan(platform, '00000000-0000-4000-8000-000000000000', 'core')).rejects.toBeInstanceOf(NotFoundException);
      expect(await db.organisationPlan.findUnique({ where: { orgId: o.tenant.orgId } })).toBeNull();
    });

    it('upserts, returns the view, and audits plan.changed for the target org', async () => {
      const o = await setupOrg('setplan');
      const view = await features.setPlan(platform, o.tenant.orgId, 'full', NEXT_YEAR.toISOString());
      expect(view).toEqual({ plan: 'full', validUntil: NEXT_YEAR.toISOString(), expired: false });
      const view2 = await features.setPlan(platform, o.tenant.orgId, 'core', null);
      expect(view2).toEqual({ plan: 'core', validUntil: null, expired: false });
      expect(await db.organisationPlan.count({ where: { orgId: o.tenant.orgId } })).toBe(1);
      const entries = await auditFor(o.tenant.orgId, 'plan.changed');
      expect(entries).toHaveLength(2);
      for (const e of entries) {
        expect(e).toMatchObject({ entityType: 'Organisation', orgId: o.tenant.orgId, actorUserId: platform.userId, outcome: 'SUCCESS' });
      }
      expect(entries.map((e) => (e.metadata as any).plan).sort()).toEqual(['core', 'full']);
      expect(entries.find((e) => (e.metadata as any).plan === 'core')?.metadata).toEqual({ plan: 'core', validUntil: null });
    });

    it('downgrade to core turns off learning, billing, checklists at once; critical and family_requests stay', async () => {
      const o = await setupOrg('setplan-downgrade');
      const { orgId, centreId } = o.tenant;
      expect(await features.isEnabled(orgId, centreId, 'learning', NOW)).toBe(true);
      await features.setPlan(platform, orgId, 'core');
      for (const k of OPTIONAL_FULL_ONLY) expect(await features.isEnabled(orgId, centreId, k, NOW)).toBe(false);
      for (const k of CRITICAL) expect(await features.isEnabled(orgId, centreId, k, NOW)).toBe(true);
      expect(await features.isEnabled(orgId, centreId, 'family_requests', NOW)).toBe(true);
      await features.setPlan(platform, orgId, 'full');
      for (const k of OPTIONAL_FULL_ONLY) expect(await features.isEnabled(orgId, centreId, k, NOW)).toBe(true);
    });

    it('a full plan with validUntil yesterday behaves as core; extending restores full', async () => {
      const o = await setupOrg('setplan-expiry');
      const { orgId, centreId } = o.tenant;
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const view = await features.setPlan(platform, orgId, 'full', yesterday);
      expect(view.expired).toBe(true);
      expect(await features.effectivePlan(orgId)).toBe('core');
      expect(await features.isEnabled(orgId, centreId, 'billing')).toBe(false);
      expect(await features.isEnabled(orgId, centreId, 'attendance')).toBe(true);
      const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
      await features.setPlan(platform, orgId, 'full', future);
      expect(await features.effectivePlan(orgId)).toBe('full');
      expect(await features.isEnabled(orgId, centreId, 'billing')).toBe(true);
    });

    it('a downgrade keeps centre switches so an upgrade restores earlier choices', async () => {
      const o = await setupOrg('setplan-keep');
      await features.setEnabled(o.admin, 'learning', false, NOW);
      await features.setPlan(platform, o.tenant.orgId, 'core');
      await features.setPlan(platform, o.tenant.orgId, 'full');
      expect(await features.isEnabled(o.tenant.orgId, o.tenant.centreId, 'learning', NOW)).toBe(false);
    });

    it('a plan change for org A never changes org B', async () => {
      const a = await setupOrg('setplan-iso-a');
      const b = await setupOrg('setplan-iso-b');
      await features.setPlan(platform, a.tenant.orgId, 'core');
      expect(await features.isEnabled(a.tenant.orgId, a.tenant.centreId, 'billing', NOW)).toBe(false);
      expect(await features.isEnabled(b.tenant.orgId, b.tenant.centreId, 'billing', NOW)).toBe(true);
      expect(await features.effectivePlan(b.tenant.orgId, NOW)).toBe('full');
      expect(await auditFor(b.tenant.orgId, 'plan.changed')).toHaveLength(0);
    });
  });
});
