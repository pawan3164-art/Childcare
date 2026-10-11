import { ForbiddenException } from '@nestjs/common';
import { RECORD_TYPES } from '../../src/retention/retention-rules';
import { RetentionService } from '../../src/retention/retention.service';
import { disconnectAll, seedOrgCentreRoom } from '../test-utils';
import { buildServices, db, ELIGIBLE_7Y, makeChild, makeUser, NOT_YET_7Y, NOW, TODAY } from './helpers';

const SEVEN_YEAR_TYPES = RECORD_TYPES.filter((t) => t !== 'incidents');

describe('PR retention: purge plan (RET-001, RET-002)', () => {
  let service: RetentionService;
  let prismaService: any;

  beforeAll(async () => {
    const s = await buildServices();
    prismaService = s.prismaService;
    service = new RetentionService(s.tenancy, s.audit, s.authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  async function fresh(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const admin = await makeUser(tenant, 'CENTRE_ADMIN');
    return { tenant, admin };
  }

  const typesFor = (items: { childId: string; recordType: string }[], childId: string) =>
    items.filter((i) => i.childId === childId).map((i) => i.recordType).sort();

  it('is admin-only', async () => {
    const { tenant } = await fresh('plan-authz');
    const educator = await makeUser(tenant, 'EDUCATOR');
    const parent = await makeUser(tenant, 'PARENT');
    await expect(service.plan(educator, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.plan(parent, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports asOf as the centre-local date', async () => {
    const { admin } = await fresh('plan-asof');
    const p = await service.plan(admin, NOW);
    expect(p.asOf).toBe(TODAY);
    expect(p.items).toEqual([]);
    expect(p.held).toEqual([]);
  });

  it('includes a child on the day retention ends (centre-local) and excludes the day before', async () => {
    const { tenant, admin } = await fresh('plan-boundary');
    const due = await makeChild(tenant, { departedOn: ELIGIBLE_7Y });
    const notYet = await makeChild(tenant, { departedOn: NOT_YET_7Y });
    const p = await service.plan(admin, NOW);
    expect(typesFor(p.items, due.id)).toEqual([...SEVEN_YEAR_TYPES].sort());
    for (const item of p.items.filter((i) => i.childId === due.id)) expect(item.eligibleOn).toBe(TODAY);
    expect(typesFor(p.items, notYet.id)).toEqual([]);
  });

  it('does not include children who have not departed, even with old records', async () => {
    const { tenant, admin } = await fresh('plan-active');
    const active = await makeChild(tenant, { departedOn: null, dob: '1990-01-01' });
    const p = await service.plan(admin, NOW);
    expect(typesFor(p.items, active.id)).toEqual([]);
    expect(p.held).not.toContain(active.id);
  });

  it('does not include anonymised children', async () => {
    const { tenant, admin } = await fresh('plan-anon');
    const done = await makeChild(tenant, { departedOn: '2015-01-01', anonymisedAt: new Date('2026-01-01T00:00:00Z') });
    const p = await service.plan(admin, NOW);
    expect(typesFor(p.items, done.id)).toEqual([]);
  });

  it('keeps incidents until the 25th birthday (included on the day, excluded the day before)', async () => {
    const { tenant, admin } = await fresh('plan-incidents');
    const turns25Today = await makeChild(tenant, { departedOn: '2020-01-01', dob: '2001-10-14' });
    const turns25Tomorrow = await makeChild(tenant, { departedOn: '2020-01-01', dob: '2001-10-15' });
    const p = await service.plan(admin, NOW);
    const inc = p.items.filter((i) => i.childId === turns25Today.id);
    expect(inc).toEqual([{ childId: turns25Today.id, recordType: 'incidents', eligibleOn: '2026-10-14' }]);
    expect(typesFor(p.items, turns25Tomorrow.id)).toEqual([]);
  });

  it('a toddler long past 7 years of departure still keeps incidents out of the plan', async () => {
    const { tenant, admin } = await fresh('plan-incidents-young');
    const kid = await makeChild(tenant, { departedOn: '2010-01-01', dob: '2008-01-01' });
    const p = await service.plan(admin, NOW);
    expect(typesFor(p.items, kid.id)).toEqual([...SEVEN_YEAR_TYPES].sort());
    expect(typesFor(p.items, kid.id)).not.toContain('incidents');
  });

  it('applies a centre override to its record type only', async () => {
    const { tenant, admin } = await fresh('plan-override');
    const kid = await makeChild(tenant, { departedOn: ELIGIBLE_7Y });
    await service.setRetentionOverride(admin, 'attendance', 10);
    const p = await service.plan(admin, NOW);
    const types = typesFor(p.items, kid.id);
    expect(types).not.toContain('attendance');
    expect(types).toContain('care_records');
    // 2019-10-14 + 10 years = 2029-10-14: eligible on that day, not before.
    const later = await service.plan(admin, new Date('2029-10-13T20:00:00Z'));
    expect(later.asOf).toBe('2029-10-14');
    expect(later.items.find((i) => i.childId === kid.id && i.recordType === 'attendance')?.eligibleOn).toBe('2029-10-14');
    const dayBefore = await service.plan(admin, new Date('2029-10-12T20:00:00Z'));
    expect(typesFor(dayBefore.items, kid.id)).not.toContain('attendance');
  });

  it('resolves a 29 February departure plus 7 years to 1 March (documented choice: calendar overflow, like JS Date)', async () => {
    const { tenant, admin } = await fresh('plan-leap');
    const kid = await makeChild(tenant, { departedOn: '2020-02-29' });
    // 2027 is not a leap year. 28 Feb 2027 local is 2027-02-27T13:00:00Z in AEDT (UTC+11).
    const feb28 = await service.plan(admin, new Date('2027-02-27T20:00:00Z'));
    expect(feb28.asOf).toBe('2027-02-28');
    expect(typesFor(feb28.items, kid.id)).toEqual([]);
    const mar1 = await service.plan(admin, new Date('2027-02-28T20:00:00Z'));
    expect(mar1.asOf).toBe('2027-03-01');
    expect(typesFor(mar1.items, kid.id)).toEqual([...SEVEN_YEAR_TYPES].sort());
    expect(mar1.items.find((i) => i.childId === kid.id)?.eligibleOn).toBe('2027-03-01');
  });

  it('lists held children in held and never in items', async () => {
    const { tenant, admin } = await fresh('plan-held');
    const held = await makeChild(tenant, { departedOn: ELIGIBLE_7Y, legalHold: true, legalHoldReason: 'dispute' });
    const free = await makeChild(tenant, { departedOn: ELIGIBLE_7Y });
    const p = await service.plan(admin, NOW);
    expect(p.held).toContain(held.id);
    expect(p.held).not.toContain(free.id);
    expect(typesFor(p.items, held.id)).toEqual([]);
    expect(typesFor(p.items, free.id).length).toBeGreaterThan(0);
  });

  it('contains only the admin centre: other centres and orgs never appear', async () => {
    const mine = await fresh('plan-scope-a');
    const theirs = await fresh('plan-scope-b');
    const c2 = await db.centre.create({ data: { orgId: mine.tenant.orgId, name: `Sibling ${Date.now()}` } });
    const r2 = await db.room.create({ data: { orgId: mine.tenant.orgId, centreId: c2.id, name: 'r' } });
    const siblingKid = await makeChild({ orgId: mine.tenant.orgId, centreId: c2.id, roomId: r2.id }, { departedOn: ELIGIBLE_7Y });
    const otherOrgKid = await makeChild(theirs.tenant, { departedOn: ELIGIBLE_7Y, legalHold: true, legalHoldReason: 'x' });
    const myKid = await makeChild(mine.tenant, { departedOn: ELIGIBLE_7Y });
    const p = await service.plan(mine.admin, NOW);
    expect(typesFor(p.items, myKid.id).length).toBeGreaterThan(0);
    expect(typesFor(p.items, siblingKid.id)).toEqual([]);
    expect(typesFor(p.items, otherOrgKid.id)).toEqual([]);
    expect(p.held).not.toContain(otherOrgKid.id);
  });

  it('carries only ids and dates, no names or other personal data', async () => {
    const { tenant, admin } = await fresh('plan-pii');
    const kid = await makeChild(tenant, { departedOn: ELIGIBLE_7Y, legalHold: false });
    const heldKid = await makeChild(tenant, { departedOn: ELIGIBLE_7Y, legalHold: true, legalHoldReason: 'Secret court reason' });
    const p = await service.plan(admin, NOW);
    const json = JSON.stringify(p);
    expect(json).not.toContain(kid.firstName);
    expect(json).not.toContain(kid.lastName);
    expect(json).not.toContain('Secret court reason');
    expect(Object.keys(p).sort()).toEqual(['asOf', 'held', 'items']);
    for (const item of p.items) {
      expect(Object.keys(item).sort()).toEqual(['childId', 'eligibleOn', 'recordType']);
      expect(item.eligibleOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(p.held.every((id: unknown) => typeof id === 'string')).toBe(true);
    expect(p.held).toContain(heldKid.id);
  });

  it('planning changes nothing', async () => {
    const { tenant, admin } = await fresh('plan-readonly');
    const kid = await makeChild(tenant, { departedOn: ELIGIBLE_7Y });
    const before = await db.child.findUnique({ where: { id: kid.id } });
    await service.plan(admin, NOW);
    expect(await db.child.findUnique({ where: { id: kid.id } })).toEqual(before);
  });
});
