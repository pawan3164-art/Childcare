import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { disconnectAll } from '../test-utils';
import { NOW, attend, buildHq, db, makeHqChild, seedHqOrg } from './helpers';

/** Fixes from the U5b security review (M2, L5). */
describe('U5b review fixes', () => {
  afterAll(disconnectAll);

  it('M2: an area manager is refused the centre child list even if a centre id is ever set on them', async () => {
    const org = await seedHqOrg('hq-fix-m2');
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const tenancy = new TenancyService(prisma);
    const children = new ChildrenService(tenancy, new AuditService(tenancy));
    // The database now refuses this combination, so simulate a token that somehow carries it: the service must still refuse.
    const risky = { ...org.areaManager, centreId: org.centres[0].id };
    await makeHqChild(org, 0);
    await expect(children.list(risky)).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.onModuleDestroy();
  });

  it('M2: the database refuses an area manager with a centre id', async () => {
    const org = await seedHqOrg('hq-fix-m2-db');
    await expect(
      db.user.create({ data: { orgId: org.orgId, centreId: org.centres[0].id, email: `am-${Date.now()}@example.test`, passwordHash: 'x', role: 'AREA_MANAGER', firstName: 'A', lastName: 'M' } }),
    ).rejects.toThrow();
    await expect(db.user.update({ where: { id: org.areaManager.userId }, data: { centreId: org.centres[0].id } })).rejects.toThrow();
  });

  it('L5: the total occupancy percent uses only centres that have a capacity', async () => {
    const org = await seedHqOrg('hq-fix-l5', [
      { timezone: 'Australia/Sydney', licensedCapacity: 10 },
      { timezone: 'Australia/Sydney', licensedCapacity: null },
    ]);
    const { service } = await buildHq();
    const a = await makeHqChild(org, 0);
    const b = await makeHqChild(org, 1);
    const c = await makeHqChild(org, 1);
    await attend(org, 0, a.id, 'SIGN_IN', '2026-10-13T19:00Z');
    await attend(org, 1, b.id, 'SIGN_IN', '2026-10-13T19:00Z');
    await attend(org, 1, c.id, 'SIGN_IN', '2026-10-13T19:05Z');
    const r = await service.occupancy(org.orgAdmin, {}, NOW);
    expect(r.totals.attended).toBe(3);
    expect(r.totals.licensedCapacity).toBe(10);
    // 1 child attended at the only centre with a capacity: 1 of 10, not 3 of 10.
    expect(r.totals.occupancyPercent).toBe(10);
  });

  it('L5: the total occupancy percent is null when no centre has a capacity', async () => {
    const org = await seedHqOrg('hq-fix-l5-none', [{ timezone: 'Australia/Sydney' }]);
    const { service } = await buildHq();
    expect((await service.occupancy(org.orgAdmin, {}, NOW)).totals.occupancyPercent).toBeNull();
  });
});
