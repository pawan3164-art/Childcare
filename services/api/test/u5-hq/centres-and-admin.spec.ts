import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { assignAreaManager, buildHq, db, expectHttp, hqAudit, makeOrgUser, seedHqOrg, HqOrg } from './helpers';

describe('HqService.listCentres', () => {
  let ctx: Awaited<ReturnType<typeof buildHq>>;
  let org: HqOrg;
  let other: HqOrg;

  beforeAll(async () => {
    ctx = await buildHq();
    org = await seedHqOrg('hq-list', [
      { timezone: 'Australia/Sydney', licensedCapacity: 40 },
      { timezone: 'Australia/Perth', licensedCapacity: null },
      { timezone: 'Australia/Brisbane', licensedCapacity: 30 },
    ]);
    other = await seedHqOrg('hq-list-other');
    await assignAreaManager(org, [0, 2]);
  });
  afterAll(async () => {
    await ctx.prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('ORG_ADMIN sees every centre in the org with id, name, timezone and licensedCapacity', async () => {
    const list = await ctx.service.listCentres(org.orgAdmin);
    expect(list).toHaveLength(3);
    for (const c of org.centres) {
      expect(list).toContainEqual({ id: c.id, name: c.name, timezone: c.timezone, licensedCapacity: c.licensedCapacity });
    }
  });

  it('items carry exactly {id, name, timezone, licensedCapacity}', async () => {
    const list = await ctx.service.listCentres(org.orgAdmin);
    for (const item of list) expect(Object.keys(item).sort()).toEqual(['id', 'licensedCapacity', 'name', 'timezone']);
  });

  it('PLATFORM_ADMIN sees every centre of their own org', async () => {
    const list = await ctx.service.listCentres(org.platformAdmin);
    expect(list.map((c: any) => c.id).sort()).toEqual(org.centres.map((c) => c.id).sort());
  });

  it("another org's centres never appear", async () => {
    const ids = (await ctx.service.listCentres(org.orgAdmin)).map((c: any) => c.id);
    for (const c of other.centres) expect(ids).not.toContain(c.id);
    const otherIds = (await ctx.service.listCentres(other.orgAdmin)).map((c: any) => c.id);
    for (const c of org.centres) expect(otherIds).not.toContain(c.id);
  });

  it('AREA_MANAGER sees only their assigned centres', async () => {
    const list = await ctx.service.listCentres(org.areaManager);
    expect(list.map((c: any) => c.id).sort()).toEqual([org.centres[0].id, org.centres[2].id].sort());
  });

  it('AREA_MANAGER with no assignments sees nothing', async () => {
    const fresh = await makeOrgUser(org.orgId, 'AREA_MANAGER');
    expect(await ctx.service.listCentres(fresh)).toEqual([]);
  });

  it('AREA_MANAGER assigned in one org never sees another org centre even if a row were crafted across orgs', async () => {
    // RLS plus the same-org check mean an assignment pointing at a foreign centre cannot surface it.
    const list = await ctx.service.listCentres(other.areaManager);
    expect(list).toEqual([]);
  });

  it.each(['centreAdmin', 'educator', 'parent'] as const)('%s is Forbidden', async (who) => {
    await expect(ctx.service.listCentres(org[who])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a user with no orgId is Forbidden', async () => {
    await expect(ctx.service.listCentres({ userId: 'u', orgId: null, centreId: null, role: 'PLATFORM_ADMIN', sessionId: 's' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('HqService area manager assignment and centre capacity', () => {
  let ctx: Awaited<ReturnType<typeof buildHq>>;
  let org: HqOrg;
  let other: HqOrg;

  beforeAll(async () => {
    ctx = await buildHq();
    org = await seedHqOrg('hq-admin');
    other = await seedHqOrg('hq-admin-other');
  });
  afterAll(async () => {
    await ctx.prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const ids = (o: HqOrg, ...idx: number[]) => idx.map((i) => o.centres[i].id);
  const sorted = (a: string[]) => [...a].sort();

  describe('setAreaManagerCentres / getAreaManagerCentres', () => {
    it('ORG_ADMIN assigns centres and getAreaManagerCentres returns the ids', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 0, 1));
      expect(sorted(await ctx.service.getAreaManagerCentres(org.orgAdmin, am.userId))).toEqual(sorted(ids(org, 0, 1)));
    });

    it('PLATFORM_ADMIN may also assign', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.platformAdmin, am.userId, ids(org, 2));
      expect(await ctx.service.getAreaManagerCentres(org.platformAdmin, am.userId)).toEqual(ids(org, 2));
    });

    it('replaces the set rather than appending, and an empty list clears it', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 0, 1));
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 1, 2));
      expect(sorted(await ctx.service.getAreaManagerCentres(org.orgAdmin, am.userId))).toEqual(sorted(ids(org, 1, 2)));
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, []);
      expect(await ctx.service.getAreaManagerCentres(org.orgAdmin, am.userId)).toEqual([]);
    });

    it('duplicate centre ids are tolerated (de-duplicated, no unique-constraint error)', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, [org.centres[0].id, org.centres[0].id]);
      expect(await ctx.service.getAreaManagerCentres(org.orgAdmin, am.userId)).toEqual(ids(org, 0));
    });

    it('the assignment takes effect for the area manager immediately (listCentres)', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      expect(await ctx.service.listCentres(am)).toEqual([]);
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 1));
      expect((await ctx.service.listCentres(am)).map((c: any) => c.id)).toEqual(ids(org, 1));
    });

    it('a centre from another org is BadRequest and nothing changes', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 0));
      await expect(ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, [org.centres[1].id, other.centres[0].id])).rejects.toBeInstanceOf(BadRequestException);
      expect(await ctx.service.getAreaManagerCentres(org.orgAdmin, am.userId)).toEqual(ids(org, 0));
    });

    it('an unknown centre id is BadRequest and nothing changes', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 0));
      await expect(ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ['00000000-0000-0000-0000-000000000000'])).rejects.toBeInstanceOf(BadRequestException);
      expect(await ctx.service.getAreaManagerCentres(org.orgAdmin, am.userId)).toEqual(ids(org, 0));
    });

    it('a non-array centreIds is BadRequest', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await expect(ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, 'abc' as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the target must be an AREA_MANAGER (an educator or org admin is rejected)', async () => {
      await expectHttp(ctx.service.setAreaManagerCentres(org.orgAdmin, org.educator.userId, ids(org, 0)), [400, 404]);
      await expectHttp(ctx.service.setAreaManagerCentres(org.orgAdmin, org.orgAdmin.userId, ids(org, 0)), [400, 404]);
    });

    it('the target must be in the same org', async () => {
      await expectHttp(ctx.service.setAreaManagerCentres(org.orgAdmin, other.areaManager.userId, ids(org, 0)), [400, 404]);
      expect(await db.areaManagerCentre.count({ where: { userId: other.areaManager.userId } })).toBe(0);
    });

    it('an admin of another org cannot read or change this org area manager', async () => {
      await expectHttp(ctx.service.getAreaManagerCentres(other.orgAdmin, org.areaManager.userId), [400, 403, 404]);
      await expectHttp(ctx.service.setAreaManagerCentres(other.orgAdmin, org.areaManager.userId, ids(other, 0)), [400, 403, 404]);
    });

    it.each(['centreAdmin', 'educator', 'parent', 'areaManager'] as const)('%s is Forbidden from setting and reading assignments', async (who) => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await expect(ctx.service.setAreaManagerCentres(org[who], am.userId, ids(org, 0))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(ctx.service.getAreaManagerCentres(org[who], am.userId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await db.areaManagerCentre.count({ where: { userId: am.userId } })).toBe(0);
    });

    it('is audited as hq.area_manager_centres_set on the target User, with the centre ids added and removed (ids, no names)', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 0, 1));
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 1, 2));
      const entries = (await hqAudit(org.orgId, 'hq.area_manager_centres_set', org.orgAdmin.userId)).filter((e: any) => e.entityId === am.userId);
      expect(entries).toHaveLength(2);
      const [first, second]: any[] = entries;
      expect(first.entityType).toBe('User');
      expect(first.outcome).toBe('SUCCESS');
      expect(first.actorRole).toBe('ORG_ADMIN');
      expect(first.metadata).toMatchObject({ centreCount: 2, addedCentreIds: [org.centres[0].id, org.centres[1].id].sort(), removedCentreIds: [] });
      expect(second.metadata).toMatchObject({ centreCount: 2, addedCentreIds: [org.centres[2].id], removedCentreIds: [org.centres[0].id] });
      for (const c of org.centres) expect(JSON.stringify(first.metadata)).not.toContain(c.name);
    });

    it('writes the audit entry in the same transaction (AuditService.record receives the tx)', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      const spy = jest.spyOn(ctx.audit, 'record');
      try {
        await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 0));
        const call = spy.mock.calls.find(([entry]) => entry.action === 'hq.area_manager_centres_set' && entry.entityId === am.userId);
        expect(call).toBeDefined();
        expect(call![1]).toBeDefined();
      } finally {
        spy.mockRestore();
      }
    });

    it('a failed audit write rolls the assignment back', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 0));
      const spy = jest.spyOn(ctx.audit, 'record').mockRejectedValueOnce(new Error('audit down'));
      try {
        await expect(ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, ids(org, 1, 2))).rejects.toThrow('audit down');
      } finally {
        spy.mockRestore();
      }
      expect(await ctx.service.getAreaManagerCentres(org.orgAdmin, am.userId)).toEqual(ids(org, 0));
    });
  });

  describe('setCentreCapacity', () => {
    it.each([1, 40, 1000])('ORG_ADMIN sets capacity %i and listCentres reflects it', async (cap) => {
      await ctx.service.setCentreCapacity(org.orgAdmin, org.centres[0].id, cap);
      const c = (await ctx.service.listCentres(org.orgAdmin)).find((x: any) => x.id === org.centres[0].id);
      expect(c.licensedCapacity).toBe(cap);
      expect((await db.centre.findUnique({ where: { id: org.centres[0].id } })).licensedCapacity).toBe(cap);
    });

    it('null clears the capacity', async () => {
      await ctx.service.setCentreCapacity(org.orgAdmin, org.centres[1].id, 25);
      await ctx.service.setCentreCapacity(org.orgAdmin, org.centres[1].id, null);
      expect((await db.centre.findUnique({ where: { id: org.centres[1].id } })).licensedCapacity).toBeNull();
    });

    it('PLATFORM_ADMIN may set capacity in their org', async () => {
      await ctx.service.setCentreCapacity(org.platformAdmin, org.centres[2].id, 55);
      expect((await db.centre.findUnique({ where: { id: org.centres[2].id } })).licensedCapacity).toBe(55);
    });

    it.each([0, -1, 1001, 1.5, NaN, '20', undefined])('invalid capacity %p is BadRequest and nothing changes', async (bad) => {
      await ctx.service.setCentreCapacity(org.orgAdmin, org.centres[0].id, 12);
      await expect(ctx.service.setCentreCapacity(org.orgAdmin, org.centres[0].id, bad as any)).rejects.toBeInstanceOf(BadRequestException);
      expect((await db.centre.findUnique({ where: { id: org.centres[0].id } })).licensedCapacity).toBe(12);
    });

    it('a centre in another org is rejected (400 or 404) and left untouched', async () => {
      await expectHttp(ctx.service.setCentreCapacity(org.orgAdmin, other.centres[0].id, 10), [400, 404]);
      expect((await db.centre.findUnique({ where: { id: other.centres[0].id } })).licensedCapacity).toBeNull();
    });

    it.each(['centreAdmin', 'educator', 'parent', 'areaManager'] as const)('%s is Forbidden', async (who) => {
      await expect(ctx.service.setCentreCapacity(org[who], org.centres[0].id, 10)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is audited as hq.centre_capacity_set (no PII; entity is the centre)', async () => {
      await ctx.service.setCentreCapacity(org.orgAdmin, org.centres[2].id, 77);
      const entries: any[] = (await hqAudit(org.orgId, 'hq.centre_capacity_set', org.orgAdmin.userId)).filter((e: any) => e.entityId === org.centres[2].id);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[entries.length - 1].outcome).toBe('SUCCESS');
      expect(entries[entries.length - 1].entityType).toBe('Centre');
    });
  });
});
