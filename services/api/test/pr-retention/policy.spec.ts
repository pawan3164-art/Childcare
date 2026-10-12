import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RECORD_TYPES, RETENTION_DEFAULTS } from '../../src/retention/retention-rules';
import { RetentionService } from '../../src/retention/retention.service';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext } from '../test-utils';
import { auditFor, buildServices, db, makeUser } from './helpers';

describe('PR retention: rules table (RET-001, DL-026)', () => {
  it('lists exactly the twelve record types', () => {
    expect([...RECORD_TYPES]).toEqual([
      'attendance', 'care_records', 'medication', 'learning', 'media', 'messages', 'billing', 'enrolment', 'incidents', 'audit_logs', 'health', 'forms',
    ]);
  });

  it('defaults to 7 years everywhere except incidents, which are kept until the child is 25', () => {
    const expected: Record<string, unknown> = {};
    for (const t of RECORD_TYPES) expected[t] = { years: 7 };
    expected.incidents = { untilAge: 25 };
    expect(RETENTION_DEFAULTS).toEqual(expected);
  });

  it('cannot be mutated by callers', () => {
    expect(Object.isFrozen(RETENTION_DEFAULTS)).toBe(true);
    try {
      (RETENTION_DEFAULTS as any).attendance = { years: 1 };
    } catch {
      /* strict mode throws; either way the value must not change */
    }
    try {
      (RETENTION_DEFAULTS.attendance as any).years = 1;
    } catch {
      /* ignore */
    }
    expect(RETENTION_DEFAULTS.attendance).toEqual({ years: 7 });
  });
});

describe('PR retention: RetentionService policy and overrides', () => {
  let service: RetentionService;
  let prismaService: any;
  let a: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let sibling: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let other: Awaited<ReturnType<typeof seedOrgCentreRoom>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    const s = await buildServices();
    prismaService = s.prismaService;
    service = new RetentionService(s.tenancy, s.audit, s.authorization);
    a = await seedOrgCentreRoom('ret-a');
    other = await seedOrgCentreRoom('ret-other');
    // a second centre in the same org as `a`
    const c2 = await fixturePrisma.centre.create({ data: { orgId: a.orgId, name: `Second centre ${Date.now()}` } });
    const r2 = await fixturePrisma.room.create({ data: { orgId: a.orgId, centreId: c2.id, name: 'R2' } });
    sibling = { orgId: a.orgId, centreId: c2.id, roomId: r2.id };
    admin = await makeUser(a, 'CENTRE_ADMIN');
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy?.();
    await disconnectAll();
  });

  it('shows the defaults with source default', async () => {
    const policy = await service.effectivePolicy(admin);
    for (const t of RECORD_TYPES) expect(policy[t].source).toBe('default');
    expect(policy.attendance.years).toBe(7);
    expect(policy.incidents.untilAge).toBe(25);
  });

  it('is admin-only', async () => {
    const educator = await makeUser(a, 'EDUCATOR');
    const parent = await makeUser(a, 'PARENT');
    await expect(service.effectivePolicy(educator)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.effectivePolicy(parent)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.effectivePolicy({ ...admin, centreId: null })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setRetentionOverride(educator, 'attendance', 10)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setRetentionOverride(parent, 'attendance', 10)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lengthens a type, upserts, audits and marks source centre', async () => {
    const entry = await service.setRetentionOverride(admin, 'attendance', 10);
    expect(entry).toMatchObject({ years: 10, source: 'centre' });

    const again = await service.setRetentionOverride(admin, 'attendance', 12);
    expect(again).toMatchObject({ years: 12, source: 'centre' });

    const rows = await db.centreRetentionOverride.findMany({ where: { centreId: a.centreId, recordType: 'attendance' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].years).toBe(12);
    expect(rows[0].orgId).toBe(a.orgId);
    expect(rows[0].updatedByUserId).toBe(admin.userId);

    const policy = await service.effectivePolicy(admin);
    expect(policy.attendance).toMatchObject({ years: 12, source: 'centre' });
    expect(policy.care_records).toMatchObject({ years: 7, source: 'default' });

    const entries = await fixturePrisma.auditLogEntry.findMany({
      where: { action: 'retention.override_set', actorUserId: admin.userId },
    });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.map((e) => e.metadata)).toContainEqual({ recordType: 'attendance', years: 12 });
  });

  it('accepts the default itself and the 50 year ceiling', async () => {
    await expect(service.setRetentionOverride(admin, 'billing', 7)).resolves.toMatchObject({ years: 7 });
    await expect(service.setRetentionOverride(admin, 'billing', 50)).resolves.toMatchObject({ years: 50 });
  });

  it.each([[6], [51], [7.5], [NaN], [Infinity], [-1], [0]])('rejects years=%p for a 7 year type', async (years) => {
    await expect(service.setRetentionOverride(admin, 'messages', years as number)).rejects.toBeInstanceOf(BadRequestException);
    const rows = await db.centreRetentionOverride.findMany({ where: { centreId: a.centreId, recordType: 'messages' } });
    expect(rows).toHaveLength(0);
  });

  it('refuses to override age-based incidents and unknown types', async () => {
    await expect(service.setRetentionOverride(admin, 'incidents', 30)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setRetentionOverride(admin, 'nonsense', 10)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not affect other centres in the same org', async () => {
    const siblingAdmin = await makeUser(sibling, 'CENTRE_ADMIN');
    const policy = await service.effectivePolicy(siblingAdmin);
    expect(policy.attendance).toMatchObject({ years: 7, source: 'default' });
  });

  it('does not let an admin of another centre change this centre (centre taken from the request user)', async () => {
    const siblingAdmin = await makeUser(sibling, 'CENTRE_ADMIN');
    await service.setRetentionOverride(siblingAdmin, 'media', 9);
    const mine = await service.effectivePolicy(admin);
    expect(mine.media).toMatchObject({ years: 7, source: 'default' });
    const rows = await db.centreRetentionOverride.findMany({ where: { recordType: 'media', centreId: a.centreId } });
    expect(rows).toHaveLength(0);
  });

  it('isolates overrides by organisation (RLS)', async () => {
    await service.setRetentionOverride(admin, 'learning', 8);
    await setTenantContext(appPrisma, other.orgId, other.centreId);
    const seenByOther = await (appPrisma as any).centreRetentionOverride.findMany({ where: { centreId: a.centreId } });
    expect(seenByOther).toHaveLength(0);
    await expect(
      (appPrisma as any).centreRetentionOverride.updateMany({ where: { centreId: a.centreId }, data: { years: 1 } }),
    ).resolves.toMatchObject({ count: 0 });
    await setTenantContext(appPrisma, a.orgId, a.centreId);
    const seenByOwner = await (appPrisma as any).centreRetentionOverride.findMany({ where: { centreId: a.centreId } });
    expect(seenByOwner.length).toBeGreaterThan(0);
  });

  it('another org admin cannot read this centre policy', async () => {
    const otherAdmin = await makeUser(other, 'CENTRE_ADMIN');
    const policy = await service.effectivePolicy(otherAdmin);
    expect(policy.learning).toMatchObject({ years: 7, source: 'default' });
  });

  it('writes audit rows without leaking anything but type and years', async () => {
    const entries = await fixturePrisma.auditLogEntry.findMany({ where: { action: 'retention.override_set', orgId: a.orgId } });
    for (const e of entries) expect(Object.keys(e.metadata as object).sort()).toEqual(['recordType', 'years']);
    expect(await auditFor(admin.userId, 'retention.override_set')).toBeDefined();
  });
});
