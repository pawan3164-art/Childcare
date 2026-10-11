import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, assignAreaManager, attend, buildHq, db, expectHttp, hqAudit, makeHqChild, makeOrgUser, seedHqOrg, CHILD_SURNAME_PREFIX, HqOrg } from './helpers';

/**
 * Clock: NOW = 2026-10-13T20:00Z.
 *   Sydney (+11)   -> 2026-10-14 07:00
 *   Perth (+8)     -> 2026-10-14 04:00
 *   Brisbane (+10) -> 2026-10-14 06:00
 * The instant 2026-10-13T14:30Z is 01:30 on the 14th in Sydney, 00:30 on the 14th in Brisbane but 22:30 on the
 * 13th in Perth, so code that uses one timezone (or UTC) for every centre gets the wrong day.
 *
 * Hand-computed figures (centre A Sydney cap 40, B Perth cap null, C Brisbane cap 30):
 *   A today: attended 3 (a1,a2,a3), signedInNow 2 (a1,a3), 3/40 = 7.5%
 *            trend 10-12:1  10-13:2  10-14:3
 *   B today: attended 1 (b2), signedInNow 1, occupancyPercent null; trend 0, 1, 1
 *   C today: attended 1, signedInNow 1, 1/30 = 3.3%; trend 0, 0, 1
 *   Org: attended 5, capacity 70, signedInNow 4, trend 1, 3, 5
 */
describe('HqService.occupancy', () => {
  let ctx: Awaited<ReturnType<typeof buildHq>>;
  let org: HqOrg;
  let other: HqOrg;
  const leakNames: string[] = [];

  beforeAll(async () => {
    ctx = await buildHq();
    org = await seedHqOrg('hq-occ', [
      { timezone: 'Australia/Sydney', licensedCapacity: 40 },
      { timezone: 'Australia/Perth', licensedCapacity: null },
      { timezone: 'Australia/Brisbane', licensedCapacity: 30 },
    ]);
    other = await seedHqOrg('hq-occ-other', [{ timezone: 'Australia/Sydney', licensedCapacity: 10 }]);
    await assignAreaManager(org, [0, 2]);

    const kid = async (centre: number) => {
      const c = await makeHqChild(org, centre);
      leakNames.push(c.lastName);
      return c;
    };

    // Centre A (Sydney)
    const a1 = await kid(0);
    const a2 = await kid(0);
    const a3 = await kid(0);
    const a4 = await kid(0);
    const a5 = await kid(0);
    await attend(org, 0, a1.id, 'SIGN_IN', '2026-10-12T22:00Z'); // 09:00 on the 13th
    await attend(org, 0, a1.id, 'SIGN_OUT', '2026-10-13T06:00Z');
    await attend(org, 0, a1.id, 'SIGN_IN', '2026-10-13T18:30Z'); // 05:30 on the 14th, still in
    await attend(org, 0, a2.id, 'SIGN_IN', '2026-10-13T19:00Z');
    await attend(org, 0, a2.id, 'SIGN_OUT', '2026-10-13T19:40Z'); // gone home
    await attend(org, 0, a3.id, 'SIGN_IN', '2026-10-13T18:45Z');
    const a3out = await attend(org, 0, a3.id, 'SIGN_OUT', '2026-10-13T19:10Z'); // wrongly signed out...
    await attend(org, 0, a3.id, 'SIGN_IN', '2026-10-13T19:20Z', { isCorrection: true, correctedEventId: a3out.id }); // ...corrected: back in
    await attend(org, 0, a4.id, 'SIGN_IN', '2026-10-13T00:00Z'); // 11:00 on the 13th, never signed out
    await attend(org, 0, a5.id, 'SIGN_IN', '2026-10-12T01:00Z'); // 12:00 on the 12th

    // Centre B (Perth)
    const b1 = await kid(1);
    const b2 = await kid(1);
    await attend(org, 1, b1.id, 'SIGN_IN', '2026-10-13T14:30Z'); // 22:30 on the 13th in Perth
    await attend(org, 1, b2.id, 'SIGN_IN', '2026-10-13T17:00Z'); // 01:00 on the 14th in Perth

    // Centre C (Brisbane)
    const c1 = await kid(2);
    await attend(org, 2, c1.id, 'SIGN_IN', '2026-10-13T14:30Z'); // 00:30 on the 14th in Brisbane

    // Another org with a busy centre: must never leak anywhere.
    const o1 = await makeHqChild(other, 0);
    await attend(other, 0, o1.id, 'SIGN_IN', '2026-10-13T18:00Z');
  });
  afterAll(async () => {
    await ctx.prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const byCentre = (r: any, i: number) => r.centres.find((c: any) => c.centreId === org.centres[i].id);
  const trendOf = (c: any) => c.trend.map((t: any) => [t.date, t.attended]);
  const DAYS3 = { days: 3 };

  describe('golden case, org admin', () => {
    it('centre A: Sydney-local figures, corrections handled, occupancy 7.5%', async () => {
      const r = await ctx.service.occupancy(org.orgAdmin, DAYS3, NOW);
      const a = byCentre(r, 0);
      expect(a.name).toBe(org.centres[0].name);
      expect(a.licensedCapacity).toBe(40);
      expect(a.today).toEqual({ date: '2026-10-14', signedInNow: 2, attended: 3, occupancyPercent: 7.5 });
      expect(trendOf(a)).toEqual([['2026-10-12', 1], ['2026-10-13', 2], ['2026-10-14', 3]]);
    });

    it('centre B: Perth-local day, null capacity gives null occupancyPercent', async () => {
      const b = byCentre(await ctx.service.occupancy(org.orgAdmin, DAYS3, NOW), 1);
      expect(b.licensedCapacity).toBeNull();
      expect(b.today).toEqual({ date: '2026-10-14', signedInNow: 1, attended: 1, occupancyPercent: null });
      expect(trendOf(b)).toEqual([['2026-10-12', 0], ['2026-10-13', 1], ['2026-10-14', 1]]);
    });

    it('centre C: Brisbane-local day, occupancy rounded to one decimal (1/30 = 3.3)', async () => {
      const c = byCentre(await ctx.service.occupancy(org.orgAdmin, DAYS3, NOW), 2);
      expect(c.today).toEqual({ date: '2026-10-14', signedInNow: 1, attended: 1, occupancyPercent: 3.3 });
      expect(trendOf(c)).toEqual([['2026-10-12', 0], ['2026-10-13', 0], ['2026-10-14', 1]]);
    });

    it('organisation totals: attended 5, capacity 70, signedInNow 4, per-date sums', async () => {
      const r = await ctx.service.occupancy(org.orgAdmin, DAYS3, NOW);
      expect(r.totals.attended).toBe(5);
      expect(r.totals.licensedCapacity).toBe(70);
      expect(r.totals.signedInNow).toBe(4);
      expect(r.totals.trend.map((t: any) => [t.date, t.attended])).toEqual([['2026-10-12', 1], ['2026-10-13', 3], ['2026-10-14', 5]]);
    });

    it('totals equal the sum of the centres (invariant)', async () => {
      const r = await ctx.service.occupancy(org.orgAdmin, { days: 14 }, NOW);
      const sum = (f: (c: any) => number) => r.centres.reduce((s: number, c: any) => s + f(c), 0);
      expect(r.totals.attended).toBe(sum((c) => c.today.attended));
      expect(r.totals.signedInNow).toBe(sum((c) => c.today.signedInNow));
      expect(r.totals.licensedCapacity).toBe(sum((c) => c.licensedCapacity ?? 0));
      r.totals.trend.forEach((t: any, i: number) => expect(t.attended).toBe(sum((c) => c.trend[i].attended)));
    });

    it('totals.licensedCapacity is null when no visible centre has a capacity', async () => {
      const bare = await seedHqOrg('hq-occ-nocap', [{ timezone: 'Australia/Sydney' }, { timezone: 'Australia/Perth' }]);
      const r = await ctx.service.occupancy(bare.orgAdmin, {}, NOW);
      expect(r.totals.licensedCapacity).toBeNull();
      expect(r.totals.attended).toBe(0);
    });

    it('capacity 0 gives null occupancyPercent and is excluded from nothing (no divide by zero)', async () => {
      const z = await seedHqOrg('hq-occ-zero', [{ timezone: 'Australia/Sydney' }]);
      await db.centre.update({ where: { id: z.centres[0].id }, data: { licensedCapacity: 0 } });
      const kidZ = await makeHqChild(z, 0);
      await attend(z, 0, kidZ.id, 'SIGN_IN', '2026-10-13T18:00Z');
      const r = await ctx.service.occupancy(z.orgAdmin, {}, NOW);
      expect(r.centres[0].today.occupancyPercent).toBeNull();
      expect(r.centres[0].today.attended).toBe(1);
    });

    it('PLATFORM_ADMIN sees the same org figures', async () => {
      const r = await ctx.service.occupancy(org.platformAdmin, DAYS3, NOW);
      expect(r.centres).toHaveLength(3);
      expect(r.totals.attended).toBe(5);
    });

    it('a sign-in yesterday with no sign-out is not signed in now (mirrors the child list status)', async () => {
      const a = byCentre(await ctx.service.occupancy(org.orgAdmin, DAYS3, NOW), 0);
      // a4 signed in on the 13th and never out; a5 on the 12th. Neither is in the building on the 14th.
      expect(a.today.signedInNow).toBe(2);
    });
  });

  describe('dates and trend window', () => {
    it('default is 14 days oldest first, ending at the centre-local today', async () => {
      const r = await ctx.service.occupancy(org.orgAdmin, {}, NOW);
      const a = byCentre(r, 0);
      expect(a.trend).toHaveLength(14);
      expect(a.trend[0].date).toBe('2026-10-01');
      expect(a.trend[13].date).toBe('2026-10-14');
      expect(r.totals.trend).toHaveLength(14);
    });

    it('days=1 returns a single point', async () => {
      const a = byCentre(await ctx.service.occupancy(org.orgAdmin, { days: 1 }, NOW), 0);
      expect(trendOf(a)).toEqual([['2026-10-14', 3]]);
    });

    it('days=90 is allowed', async () => {
      const a = byCentre(await ctx.service.occupancy(org.orgAdmin, { days: 90 }, NOW), 0);
      expect(a.trend).toHaveLength(90);
    });

    it('an explicit date moves the window; the Perth event belongs to the 13th, not the 14th, even for the same instant', async () => {
      const r = await ctx.service.occupancy(org.orgAdmin, { date: '2026-10-13', days: 2 }, NOW);
      expect(byCentre(r, 0).today).toMatchObject({ date: '2026-10-13', attended: 2 });
      expect(trendOf(byCentre(r, 0))).toEqual([['2026-10-12', 1], ['2026-10-13', 2]]);
      expect(byCentre(r, 1).today).toMatchObject({ date: '2026-10-13', attended: 1 });
      expect(byCentre(r, 2).today).toMatchObject({ date: '2026-10-13', attended: 0 });
    });

    it.each(['2026-13-45', 'tomorrow', '2026-02-30', '14/10/2026', '2026-10-14T00:00:00Z', ''])('invalid date %p is BadRequest', async (date) => {
      await expect(ctx.service.occupancy(org.orgAdmin, { date }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([0, -1, 91, 1.5, NaN])('invalid days %p is BadRequest', async (days) => {
      await expect(ctx.service.occupancy(org.orgAdmin, { days }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('area manager scoping', () => {
    it('sees only assigned centres, with totals over just those centres', async () => {
      const r = await ctx.service.occupancy(org.areaManager, DAYS3, NOW);
      expect(r.centres.map((c: any) => c.centreId).sort()).toEqual([org.centres[0].id, org.centres[2].id].sort());
      expect(r.totals.attended).toBe(4);
      expect(r.totals.licensedCapacity).toBe(70);
      expect(r.totals.signedInNow).toBe(3);
      expect(r.totals.trend.map((t: any) => [t.date, t.attended])).toEqual([['2026-10-12', 1], ['2026-10-13', 2], ['2026-10-14', 4]]);
    });

    it('attendance in the unassigned centre never leaks into centres, totals or serialised output', async () => {
      const r = await ctx.service.occupancy(org.areaManager, DAYS3, NOW);
      const json = JSON.stringify(r);
      expect(json).not.toContain(org.centres[1].id);
      expect(json).not.toContain(org.centres[1].name);
      expect(r.totals.attended).not.toBe(5);
    });

    it('an area manager with no assignments gets empty centres and zero totals', async () => {
      const none = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      const r = await ctx.service.occupancy(none, DAYS3, NOW);
      expect(r.centres).toEqual([]);
      expect(r.totals.attended).toBe(0);
      expect(r.totals.signedInNow).toBe(0);
      expect(r.totals.licensedCapacity).toBeNull();
    });

    it('un-assigning a centre removes it from the next call', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await assignAreaManager(org, [0, 1], am);
      expect((await ctx.service.occupancy(am, DAYS3, NOW)).centres).toHaveLength(2);
      await ctx.service.setAreaManagerCentres(org.orgAdmin, am.userId, [org.centres[0].id]);
      expect((await ctx.service.occupancy(am, DAYS3, NOW)).centres.map((c: any) => c.centreId)).toEqual([org.centres[0].id]);
    });
  });

  describe('cross-org isolation', () => {
    it("never includes another org's centres or attendance", async () => {
      const r = await ctx.service.occupancy(org.orgAdmin, DAYS3, NOW);
      const json = JSON.stringify(r);
      expect(json).not.toContain(other.centres[0].id);
      expect(r.totals.attended).toBe(5);
      const theirs = await ctx.service.occupancy(other.orgAdmin, DAYS3, NOW);
      expect(theirs.centres).toHaveLength(1);
      expect(theirs.totals.attended).toBe(1);
      expect(JSON.stringify(theirs)).not.toContain(org.centres[0].id);
    });
  });

  describe('roles', () => {
    it.each(['centreAdmin', 'educator', 'parent'] as const)('%s is Forbidden', async (who) => {
      await expect(ctx.service.occupancy(org[who], DAYS3, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('a user with no orgId is Forbidden', async () => {
      await expectHttp(ctx.service.occupancy({ userId: 'u', orgId: null, centreId: null, role: 'ORG_ADMIN', sessionId: 's' }, DAYS3, NOW), [403]);
    });
  });

  describe('privacy', () => {
    it('output holds no child-level data (names, child ids, attendance event rows)', async () => {
      const r = await ctx.service.occupancy(org.orgAdmin, DAYS3, NOW);
      const json = JSON.stringify(r);
      expect(json).not.toContain(CHILD_SURNAME_PREFIX);
      for (const n of leakNames) expect(json).not.toContain(n);
      expect(json).not.toMatch(/childId|firstName|lastName|dateOfBirth/);
    });
  });

  describe('audit of reads', () => {
    it("writes one 'hq.viewed' entry per call with report and centreCount only", async () => {
      const fresh = await seedHqOrg('hq-occ-audit');
      const before = (await hqAudit(fresh.orgId, 'hq.viewed', fresh.orgAdmin.userId)).length;
      await ctx.service.occupancy(fresh.orgAdmin, {}, NOW);
      const entries: any[] = await hqAudit(fresh.orgId, 'hq.viewed', fresh.orgAdmin.userId);
      expect(entries).toHaveLength(before + 1);
      const e = entries[entries.length - 1];
      expect(e.entityType).toBe('Organisation');
      expect(e.outcome).toBe('SUCCESS');
      expect(e.metadata).toEqual({ report: 'occupancy', centreCount: 3 });
    });

    it('an area manager view records their visible centre count', async () => {
      await ctx.service.occupancy(org.areaManager, {}, NOW);
      const entries: any[] = await hqAudit(org.orgId, 'hq.viewed', org.areaManager.userId);
      expect(entries[entries.length - 1].metadata).toEqual({ report: 'occupancy', centreCount: 2 });
      expect(entries[entries.length - 1].actorRole).toBe('AREA_MANAGER');
    });

    it('a Forbidden call writes no hq.viewed entry', async () => {
      const before = (await hqAudit(org.orgId, 'hq.viewed', org.educator.userId)).length;
      await expect(ctx.service.occupancy(org.educator, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await hqAudit(org.orgId, 'hq.viewed', org.educator.userId)).length).toBe(before);
    });
  });
});
