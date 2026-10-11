import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { disconnectAll } from '../test-utils';
import { NOW, assignAreaManager, buildHq, expectHttp, hqAudit, ledger, makeHqChild, makeOrgUser, seedHqOrg, CHILD_SURNAME_PREFIX, HqOrg } from './helpers';

const RANGE = { from: '2026-10-01', to: '2026-10-31' };
const CSV_HEADER = 'Centre,Invoiced,Subsidy expected,Subsidy received,Payments received,Credits,Outstanding,Debtors,Current,31-60 days,61-90 days,Over 90 days';

/**
 * Ledger sign convention: FEE and ADJUSTMENT positive; SUBSIDY_*, PAYMENT and CREDIT negative.
 * As-of date for ageing is `to` = 2026-10-31. Ages (days before 2026-10-31):
 *   2026-10-30 = 1, 10-12 = 19, 10-10 = 21, 09-20 = 41, 09-01 = 60, 08-20 = 72, 08-01 = 91.
 *
 * Centre A
 *   c1: FEE 10000 (10-30), FEE 8000 (10-10), FEE 6000 (09-20), ADJUSTMENT +1200 (10-12), PAYMENT -5000 (10-15)
 *       balance 20200. Newest debits first: 1200 + 10000 + 8000 = 19200 current, remaining 1000 from the 41-day-old fee -> 31-60.
 *   c2: FEE 20000 (08-01), ADJUSTMENT +3000 (09-01), SUBSIDY_ESTIMATED -4000 (10-20)
 *       balance 19000. 3000 (age 60) -> 31-60; remaining 16000 from the 91-day-old fee -> over 90.
 *   c3: FEE 5000 (10-05), CREDIT -5000 (10-06), SUBSIDY_CONFIRMED -2500 (10-07), ADJUSTMENT -700 (10-08)
 *       balance -3200: not a debtor, excluded from outstanding.
 *   Invoiced (FEE + positive ADJUSTMENT dated in October) = c1 10000+8000+1200 + c3 5000 = 24200
 *   Subsidy expected 4000, received 2500, payments 5000, credits 5000
 *   Outstanding 20200 + 19000 = 39200, debtors 2
 *   Ageing current 19200, 31-60 1000+3000 = 4000, 61-90 0, over 90 16000 (sums to 39200)
 * Centre B
 *   c4: FEE 7000 (08-20, age 72), PAYMENT -2000 (09-01), PAYMENT -1000 (11-05, AFTER the range but still all-time)
 *       balance 4000, all in 61-90. Nothing in range.
 * Centre C: no ledger entries, all zeros.
 */
describe('HqService.financials', () => {
  let ctx: Awaited<ReturnType<typeof buildHq>>;
  let org: HqOrg;
  let other: HqOrg;
  const kids: string[] = [];

  beforeAll(async () => {
    ctx = await buildHq();
    org = await seedHqOrg('hq-fin');
    other = await seedHqOrg('hq-fin-other', [{ timezone: 'Australia/Sydney' }]);
    await assignAreaManager(org, [0, 2]);
    const kid = async (o: HqOrg, i: number) => {
      const c = await makeHqChild(o, i);
      kids.push(c.lastName);
      return c;
    };
    const c1 = await kid(org, 0);
    const c2 = await kid(org, 0);
    const c3 = await kid(org, 0);
    const c4 = await kid(org, 1);

    await ledger(org, 0, c1.id, 'FEE', 10000, '2026-10-30');
    await ledger(org, 0, c1.id, 'FEE', 8000, '2026-10-10');
    await ledger(org, 0, c1.id, 'FEE', 6000, '2026-09-20');
    await ledger(org, 0, c1.id, 'ADJUSTMENT', 1200, '2026-10-12');
    await ledger(org, 0, c1.id, 'PAYMENT', -5000, '2026-10-15');

    await ledger(org, 0, c2.id, 'FEE', 20000, '2026-08-01');
    await ledger(org, 0, c2.id, 'ADJUSTMENT', 3000, '2026-09-01');
    await ledger(org, 0, c2.id, 'SUBSIDY_ESTIMATED', -4000, '2026-10-20');

    await ledger(org, 0, c3.id, 'FEE', 5000, '2026-10-05');
    await ledger(org, 0, c3.id, 'CREDIT', -5000, '2026-10-06');
    await ledger(org, 0, c3.id, 'SUBSIDY_CONFIRMED', -2500, '2026-10-07');
    await ledger(org, 0, c3.id, 'ADJUSTMENT', -700, '2026-10-08');

    await ledger(org, 1, c4.id, 'FEE', 7000, '2026-08-20');
    await ledger(org, 1, c4.id, 'PAYMENT', -2000, '2026-09-01');
    await ledger(org, 1, c4.id, 'PAYMENT', -1000, '2026-11-05');

    // Another org with big numbers that must never leak.
    const o1 = await kid(other, 0);
    await ledger(other, 0, o1.id, 'FEE', 999900, '2026-10-10');
  });
  afterAll(async () => {
    await ctx.prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const row = (r: any, i: number) => r.centres.find((c: any) => c.centreId === org.centres[i].id);

  describe('golden case, org admin', () => {
    it('centre A figures', async () => {
      const a = row(await ctx.service.financials(org.orgAdmin, RANGE, NOW), 0);
      expect(a).toMatchObject({
        name: org.centres[0].name,
        invoicedCents: 24200,
        subsidyEstimatedCents: 4000,
        subsidyConfirmedCents: 2500,
        paymentsReceivedCents: 5000,
        creditsCents: 5000,
        outstandingCents: 39200,
        debtorCount: 2,
      });
      expect(a.ageing).toEqual({ current: 19200, days31to60: 4000, days61to90: 0, over90: 16000 });
    });

    it('centre B: out-of-range entries do not count for the period but all-time balance and ageing do', async () => {
      const b = row(await ctx.service.financials(org.orgAdmin, RANGE, NOW), 1);
      expect(b).toMatchObject({ invoicedCents: 0, subsidyEstimatedCents: 0, subsidyConfirmedCents: 0, paymentsReceivedCents: 0, creditsCents: 0, outstandingCents: 4000, debtorCount: 1 });
      expect(b.ageing).toEqual({ current: 0, days31to60: 0, days61to90: 4000, over90: 0 });
    });

    it('centre C: all zeros', async () => {
      const c = row(await ctx.service.financials(org.orgAdmin, RANGE, NOW), 2);
      expect(c).toMatchObject({ invoicedCents: 0, subsidyEstimatedCents: 0, subsidyConfirmedCents: 0, paymentsReceivedCents: 0, creditsCents: 0, outstandingCents: 0, debtorCount: 0 });
      expect(c.ageing).toEqual({ current: 0, days31to60: 0, days61to90: 0, over90: 0 });
    });

    it('organisation totals equal the sum of the centres', async () => {
      const r = await ctx.service.financials(org.orgAdmin, RANGE, NOW);
      expect(r.totals).toMatchObject({
        invoicedCents: 24200,
        subsidyEstimatedCents: 4000,
        subsidyConfirmedCents: 2500,
        paymentsReceivedCents: 5000,
        creditsCents: 5000,
        outstandingCents: 43200,
        debtorCount: 3,
      });
      expect(r.totals.ageing).toEqual({ current: 19200, days31to60: 4000, days61to90: 4000, over90: 16000 });
    });

    it('invariants: ageing buckets sum to outstanding; totals are sums; all values are integers', async () => {
      const r = await ctx.service.financials(org.orgAdmin, RANGE, NOW);
      const keys = ['invoicedCents', 'subsidyEstimatedCents', 'subsidyConfirmedCents', 'paymentsReceivedCents', 'creditsCents', 'outstandingCents', 'debtorCount'];
      for (const k of keys) expect(r.totals[k]).toBe(r.centres.reduce((s: number, c: any) => s + c[k], 0));
      for (const c of [...r.centres, r.totals]) {
        expect(c.ageing.current + c.ageing.days31to60 + c.ageing.days61to90 + c.ageing.over90).toBe(c.outstandingCents);
        for (const k of keys) expect(Number.isInteger(c[k])).toBe(true);
        for (const v of Object.values(c.ageing)) expect(Number.isInteger(v)).toBe(true);
      }
    });

    it('subsidy figures are absolute values (positive) so received versus expected reads naturally', async () => {
      const a = row(await ctx.service.financials(org.orgAdmin, RANGE, NOW), 0);
      expect(a.subsidyEstimatedCents).toBeGreaterThan(0);
      expect(a.subsidyConfirmedCents).toBeGreaterThan(0);
      expect(a.paymentsReceivedCents).toBeGreaterThan(0);
      expect(a.creditsCents).toBeGreaterThan(0);
    });

    it('negative adjustments are not counted as invoiced, and credit-balance children are not debtors', async () => {
      const a = row(await ctx.service.financials(org.orgAdmin, RANGE, NOW), 0);
      expect(a.invoicedCents).toBe(24200); // not 24200 - 700
      expect(a.debtorCount).toBe(2); // c3 has a -3200 balance
    });

    it('the period window changes the period figures but not the all-time outstanding', async () => {
      const r = await ctx.service.financials(org.orgAdmin, { from: '2026-09-01', to: '2026-09-30' }, NOW);
      const a = row(r, 0);
      // September: FEE 6000 (09-20) + ADJUSTMENT 3000 (09-01) = 9000 invoiced; no payments, subsidy or credits.
      expect(a).toMatchObject({ invoicedCents: 9000, subsidyEstimatedCents: 0, subsidyConfirmedCents: 0, paymentsReceivedCents: 0, creditsCents: 0, outstandingCents: 39200 });
      // As-of date is 09-30. Entries dated after it have age <= 0 and count as current.
      // c1 balance 20200 fits within its newest debits (all age <= 10 days) -> 20200 current.
      // c2 balance 19000: 3000 (09-01, 29 days) -> current, remaining 16000 from the 60-day-old fee -> 31-60.
      expect(a.ageing).toEqual({ current: 20200 + 3000, days31to60: 16000, days61to90: 0, over90: 0 });
    });

    it('range edges are inclusive: from and to dates themselves count', async () => {
      const r = await ctx.service.financials(org.orgAdmin, { from: '2026-10-30', to: '2026-10-30' }, NOW);
      expect(row(r, 0).invoicedCents).toBe(10000);
      const r2 = await ctx.service.financials(org.orgAdmin, { from: '2026-10-10', to: '2026-10-10' }, NOW);
      expect(row(r2, 0).invoicedCents).toBe(8000);
    });

    it('PLATFORM_ADMIN sees the same org figures', async () => {
      const r = await ctx.service.financials(org.platformAdmin, RANGE, NOW);
      expect(r.totals.outstandingCents).toBe(43200);
    });
  });

  describe('default range and validation', () => {
    it('defaults to the current month in Australia/Sydney (NOW is 14 Oct there, 13 Oct in UTC)', async () => {
      const r = await ctx.service.financials(org.orgAdmin, {}, NOW);
      expect(r.period.from).toBe('2026-10-01');
      expect(r.period.to >= '2026-10-14').toBe(true);
      expect(row(r, 0).invoicedCents).toBe(24200); // all October entries are within the default month
    });

    it('a month boundary in Sydney wins over UTC: at 2026-09-30T20:00Z it is already October in Sydney', async () => {
      const r = await ctx.service.financials(org.orgAdmin, {}, new Date('2026-09-30T20:00:00Z'));
      expect(r.period.from).toBe('2026-10-01');
    });

    it('range of exactly 366 days is allowed, 367 is BadRequest', async () => {
      await expect(ctx.service.financials(org.orgAdmin, { from: '2025-10-31', to: '2026-10-31' }, NOW)).resolves.toBeDefined(); // 366 days inclusive span boundary
      await expect(ctx.service.financials(org.orgAdmin, { from: '2025-10-01', to: '2026-10-31' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('from after to is BadRequest', async () => {
      await expect(ctx.service.financials(org.orgAdmin, { from: '2026-10-31', to: '2026-10-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([['2026-13-01', '2026-10-31'], ['2026-10-01', 'soon'], ['2026-02-30', '2026-03-10'], ['10/01/2026', '10/31/2026']])('invalid dates %p..%p are BadRequest', async (from, to) => {
      await expect(ctx.service.financials(org.orgAdmin, { from, to }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('from and to may be equal (a single day)', async () => {
      await expect(ctx.service.financials(org.orgAdmin, { from: '2026-10-05', to: '2026-10-05' }, NOW)).resolves.toBeDefined();
    });
  });

  describe('area manager scoping', () => {
    it('sees only assigned centres and totals over just those centres', async () => {
      const r = await ctx.service.financials(org.areaManager, RANGE, NOW);
      expect(r.centres.map((c: any) => c.centreId).sort()).toEqual([org.centres[0].id, org.centres[2].id].sort());
      expect(r.totals.outstandingCents).toBe(39200);
      expect(r.totals.debtorCount).toBe(2);
      expect(r.totals.ageing).toEqual({ current: 19200, days31to60: 4000, days61to90: 0, over90: 16000 });
    });

    it('the unassigned centre never leaks (ids, names, its 4000 balance)', async () => {
      const r = await ctx.service.financials(org.areaManager, RANGE, NOW);
      const json = JSON.stringify(r);
      expect(json).not.toContain(org.centres[1].id);
      expect(json).not.toContain(org.centres[1].name);
      expect(r.totals.outstandingCents).not.toBe(43200);
    });

    it('CSV for an area manager omits the unassigned centre and totals only theirs', async () => {
      const csv: string = await ctx.service.financialsCsv(org.areaManager, RANGE, NOW);
      expect(csv).not.toContain(org.centres[1].name);
      expect(csv).toContain(org.centres[0].name);
      expect(csv.split('\n').find((l) => l.startsWith('Total'))).toContain('392.00');
    });
  });

  describe('cross-org isolation and roles', () => {
    it("never includes another org's ledger", async () => {
      const r = await ctx.service.financials(org.orgAdmin, RANGE, NOW);
      expect(JSON.stringify(r)).not.toContain(other.centres[0].id);
      expect(r.totals.invoicedCents).toBe(24200);
      const theirs = await ctx.service.financials(other.orgAdmin, RANGE, NOW);
      expect(theirs.totals.invoicedCents).toBe(999900);
      expect(theirs.centres).toHaveLength(1);
    });

    it.each(['centreAdmin', 'educator', 'parent'] as const)('%s is Forbidden (JSON and CSV)', async (who) => {
      await expect(ctx.service.financials(org[who], RANGE, NOW)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(ctx.service.financialsCsv(org[who], RANGE, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a user with no orgId is Forbidden', async () => {
      await expectHttp(ctx.service.financials({ userId: 'u', orgId: null, centreId: null, role: 'ORG_ADMIN', sessionId: 's' }, RANGE, NOW), [403]);
    });
  });

  describe('privacy', () => {
    it('contains no child-level data', async () => {
      const json = JSON.stringify(await ctx.service.financials(org.orgAdmin, RANGE, NOW));
      expect(json).not.toContain(CHILD_SURNAME_PREFIX);
      for (const n of kids) expect(json).not.toContain(n);
      expect(json).not.toMatch(/childId|firstName|lastName|description/);
    });
  });

  describe('financialsCsv', () => {
    it('has the exact header, one row per centre, then a Total row; amounts in dollars with two decimals', async () => {
      const csv: string = await ctx.service.financialsCsv(org.orgAdmin, RANGE, NOW);
      const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
      expect(lines[0]).toBe(CSV_HEADER);
      expect(lines).toHaveLength(1 + 3 + 1);
      const a = lines.find((l) => l.startsWith(org.centres[0].name))!;
      expect(a).toBe(`${org.centres[0].name},242.00,40.00,25.00,50.00,50.00,392.00,2,192.00,40.00,0.00,160.00`);
      const b = lines.find((l) => l.startsWith(org.centres[1].name))!;
      expect(b).toBe(`${org.centres[1].name},0.00,0.00,0.00,0.00,0.00,40.00,1,0.00,0.00,40.00,0.00`);
      expect(lines[lines.length - 1]).toBe('Total,242.00,40.00,25.00,50.00,50.00,432.00,3,192.00,40.00,40.00,160.00');
    });

    it('centre names are CSV-escaped: commas, quotes and newlines', async () => {
      const tricky = await seedHqOrg('hq-csv-escape', [
        { name: 'Smith, Jones & Co', timezone: 'Australia/Sydney' },
        { name: 'The "Big" Centre', timezone: 'Australia/Sydney' },
        { name: 'Two\nLines', timezone: 'Australia/Sydney' },
      ]);
      const csv: string = await ctx.service.financialsCsv(tricky.orgAdmin, RANGE, NOW);
      expect(csv).toContain('"Smith, Jones & Co",');
      expect(csv).toContain('"The ""Big"" Centre",');
      expect(csv).toContain('"Two\nLines",');
    });

    it.each(['=HYPERLINK("http://evil")', '+1+1', '-2+3', '@SUM(A1)'])('formula-injection: a name starting with %p gets a leading single quote', async (name) => {
      const evil = await seedHqOrg('hq-csv-inject', [{ name, timezone: 'Australia/Sydney' }]);
      const csv: string = await ctx.service.financialsCsv(evil.orgAdmin, RANGE, NOW);
      const dataLine = csv.split(/\r?\n/)[1];
      // The cell may additionally be quoted, but its content must start with ' and never with the raw trigger character.
      const cell = dataLine.startsWith('"') ? dataLine.slice(1) : dataLine;
      expect(cell.startsWith("'")).toBe(true);
      expect(dataLine).not.toMatch(/^"?[=+\-@]/);
    });

    it('a normal name is not altered', async () => {
      const csv: string = await ctx.service.financialsCsv(org.orgAdmin, RANGE, NOW);
      expect(csv).toContain(`${org.centres[2].name},0.00,`);
    });

    it('contains no child-level data', async () => {
      const csv: string = await ctx.service.financialsCsv(org.orgAdmin, RANGE, NOW);
      expect(csv).not.toContain(CHILD_SURNAME_PREFIX);
    });
  });

  describe('audit of reads', () => {
    it("financials writes one 'hq.viewed' entry {report:'financials', centreCount}", async () => {
      const fresh = await seedHqOrg('hq-fin-audit');
      await ctx.service.financials(fresh.orgAdmin, RANGE, NOW);
      const entries: any[] = await hqAudit(fresh.orgId, 'hq.viewed', fresh.orgAdmin.userId);
      expect(entries).toHaveLength(1);
      expect(entries[0].entityType).toBe('Organisation');
      expect(entries[0].metadata).toEqual({ report: 'financials', centreCount: 3 });
    });

    it("financialsCsv writes one 'hq.viewed' entry {report:'financials_csv', centreCount} and no extra financials entry", async () => {
      const fresh = await seedHqOrg('hq-csv-audit');
      await ctx.service.financialsCsv(fresh.orgAdmin, RANGE, NOW);
      const entries: any[] = await hqAudit(fresh.orgId, 'hq.viewed', fresh.orgAdmin.userId);
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata).toEqual({ report: 'financials_csv', centreCount: 3 });
    });

    it('an area manager view counts only their centres', async () => {
      const am = await makeOrgUser(org.orgId, 'AREA_MANAGER');
      await assignAreaManager(org, [1], am);
      await ctx.service.financials(am, RANGE, NOW);
      const entries: any[] = await hqAudit(org.orgId, 'hq.viewed', am.userId);
      expect(entries[entries.length - 1].metadata).toEqual({ report: 'financials', centreCount: 1 });
    });

    it('invalid input writes no entry', async () => {
      const fresh = await seedHqOrg('hq-fin-audit-bad');
      await expect(ctx.service.financials(fresh.orgAdmin, { from: '2026-10-31', to: '2026-10-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
      expect(await hqAudit(fresh.orgId, 'hq.viewed', fresh.orgAdmin.userId)).toHaveLength(0);
    });
  });
});
