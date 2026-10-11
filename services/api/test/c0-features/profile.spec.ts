import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/auth/auth.service';
import { FeaturesService } from '../../src/features/features.service';
import { MODULES } from '../../src/features/features.registry';
import { disconnectAll } from '../test-utils';
import { buildFeatures, CRITICAL, makePlatformAdmin, OPTIONAL_FULL_ONLY, setupOrg } from './helpers';

describe('C0 profile carries enabledModules and brand', () => {
  let built: Awaited<ReturnType<typeof buildFeatures>>;
  let features: FeaturesService;
  let auth: AuthService;
  let brandCalls: any[];
  const branding = {
    getBrand: async (user: any) => {
      brandCalls.push(user);
      return { name: 'Stub Brand', primaryColour: '#123456' };
    },
  } as any;

  beforeAll(async () => {
    built = await buildFeatures();
    features = built.features;
    auth = new AuthService(built.prismaService, built.tenancy, new JwtService({ secret: 'test' }), built.audit, features, branding);
  });

  beforeEach(() => {
    brandCalls = [];
  });

  afterAll(async () => {
    await (built.prismaService as any).onModuleDestroy?.();
    await disconnectAll();
  });

  it('without the new services the existing fields are unchanged and the new keys are absent', async () => {
    const o = await setupOrg('profile-legacy');
    const legacy = new AuthService(built.prismaService, built.tenancy, new JwtService({ secret: 'test' }), built.audit);
    const profile: any = await legacy.getProfile(o.parent.userId);
    expect(Object.keys(profile).sort()).toEqual(
      ['userId', 'email', 'firstName', 'lastName', 'role', 'orgId', 'orgName', 'centreId', 'centreName', 'mfaEnabled'].sort(),
    );
    expect(profile).toMatchObject({ userId: o.parent.userId, role: 'PARENT', orgId: o.tenant.orgId, centreId: o.tenant.centreId, mfaEnabled: false });
    expect('enabledModules' in profile).toBe(false);
    expect('brand' in profile).toBe(false);
  });

  it('keeps every existing field and adds enabledModules and brand when services are provided', async () => {
    const o = await setupOrg('profile-new');
    const profile: any = await auth.getProfile(o.parent.userId);
    expect(profile).toMatchObject({ userId: o.parent.userId, role: 'PARENT', orgId: o.tenant.orgId, centreId: o.tenant.centreId, mfaEnabled: false });
    expect(profile.orgName).toEqual(expect.any(String));
    expect(profile.centreName).toEqual(expect.any(String));
    expect(profile.enabledModules).toEqual(MODULES.map((m) => m.key));
    expect(profile.brand).toEqual({ name: 'Stub Brand', primaryColour: '#123456' });
  });

  it('asks branding for the brand using a RequestUser built from the profile', async () => {
    const o = await setupOrg('profile-brand');
    await auth.getProfile(o.educator.userId);
    expect(brandCalls).toHaveLength(1);
    expect(brandCalls[0]).toEqual({
      userId: o.educator.userId,
      orgId: o.tenant.orgId,
      centreId: o.tenant.centreId,
      role: 'EDUCATOR',
      sessionId: 'profile',
    });
  });

  it('parent and educator profiles list all critical modules', async () => {
    const o = await setupOrg('profile-critical');
    for (const u of [o.parent, o.educator]) {
      const profile: any = await auth.getProfile(u.userId);
      for (const k of CRITICAL) expect(profile.enabledModules).toContain(k);
    }
  });

  it('switching family_requests off removes it from a parent profile, and back on restores it', async () => {
    const o = await setupOrg('profile-toggle');
    expect(((await auth.getProfile(o.parent.userId)) as any).enabledModules).toContain('family_requests');
    await features.setEnabled(o.admin, 'family_requests', false);
    const off: any = await auth.getProfile(o.parent.userId);
    expect(off.enabledModules).not.toContain('family_requests');
    for (const k of CRITICAL) expect(off.enabledModules).toContain(k);
    await features.setEnabled(o.admin, 'family_requests', true);
    expect(((await auth.getProfile(o.parent.userId)) as any).enabledModules).toContain('family_requests');
  });

  it('downgrading the org to core removes learning, billing and checklists from every role', async () => {
    const o = await setupOrg('profile-core');
    const platform = await makePlatformAdmin();
    await features.setPlan(platform, o.tenant.orgId, 'core');
    for (const u of [o.parent, o.educator, o.admin, o.orgAdmin]) {
      const profile: any = await auth.getProfile(u.userId);
      for (const k of OPTIONAL_FULL_ONLY) expect(profile.enabledModules).not.toContain(k);
      for (const k of CRITICAL) expect(profile.enabledModules).toContain(k);
      expect(profile.enabledModules).toContain('family_requests');
    }
  });

  it('an org-level admin (no centre) still gets enabledModules', async () => {
    const o = await setupOrg('profile-org-admin');
    const profile: any = await auth.getProfile(o.orgAdmin.userId);
    expect(profile.centreId).toBeNull();
    expect(profile.enabledModules).toEqual(MODULES.map((m) => m.key));
  });
});
