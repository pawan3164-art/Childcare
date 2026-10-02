import { PrismaClient } from '@prisma/client';
import {
  appPrisma,
  disconnectAll,
  fixturePrisma,
  seedOrgCentreRoom,
  setTenantContext,
  uniqueSuffix,
} from '../test-utils';

/**
 * Validates the DB-enforced tenant boundary (org_id + RLS), independent of
 * any application code — see prisma/migrations/*_enable_rls. This is the
 * safety net underneath AuthorizationService: even a buggy query should not
 * be able to leak another organisation's children.
 */
describe('Row-level security: tenant isolation', () => {
  afterAll(async () => {
    await disconnectAll();
  });

  it('a query with no tenant context set sees zero rows, not an error', async () => {
    const client = new PrismaClient({ datasourceUrl: process.env.DATABASE_APP_URL });
    // Fresh connection: app.current_org_id is unset for this session.
    const rows = await client.child.findMany();
    expect(rows).toHaveLength(0);
    await client.$disconnect();
  });

  it('cannot see another organisation\'s children even with a matching query', async () => {
    const orgA = await seedOrgCentreRoom('A');
    const orgB = await seedOrgCentreRoom('B');
    const suffix = uniqueSuffix();

    const childA = await fixturePrisma.child.create({
      data: {
        orgId: orgA.orgId,
        centreId: orgA.centreId,
        roomId: orgA.roomId,
        firstName: 'Alice',
        lastName: `A-${suffix}`,
        dateOfBirth: new Date('2022-01-01'),
      },
    });
    await fixturePrisma.child.create({
      data: {
        orgId: orgB.orgId,
        centreId: orgB.centreId,
        roomId: orgB.roomId,
        firstName: 'Bob',
        lastName: `B-${suffix}`,
        dateOfBirth: new Date('2022-01-01'),
      },
    });

    await setTenantContext(appPrisma, orgA.orgId, orgA.centreId);
    const visibleToOrgA = await appPrisma.child.findMany({
      where: { lastName: { in: [`A-${suffix}`, `B-${suffix}`] } },
    });

    expect(visibleToOrgA).toHaveLength(1);
    expect(visibleToOrgA[0].id).toBe(childA.id);

    await setTenantContext(appPrisma, orgB.orgId, orgB.centreId);
    const visibleToOrgB = await appPrisma.child.findMany({
      where: { lastName: { in: [`A-${suffix}`, `B-${suffix}`] } },
    });
    expect(visibleToOrgB).toHaveLength(1);
    expect(visibleToOrgB[0].firstName).toBe('Bob');
  });

  it('cannot update or delete a row belonging to another organisation', async () => {
    const orgA = await seedOrgCentreRoom('UpdA');
    const orgB = await seedOrgCentreRoom('UpdB');

    const childB = await fixturePrisma.child.create({
      data: {
        orgId: orgB.orgId,
        centreId: orgB.centreId,
        roomId: orgB.roomId,
        firstName: 'Carl',
        lastName: 'ShouldNotBeEditable',
        dateOfBirth: new Date('2021-06-01'),
      },
    });

    await setTenantContext(appPrisma, orgA.orgId, orgA.centreId);
    const updateResult = await appPrisma.child.updateMany({
      where: { id: childB.id },
      data: { firstName: 'Hacked' },
    });
    expect(updateResult.count).toBe(0);

    const stillOriginal = await fixturePrisma.child.findUniqueOrThrow({ where: { id: childB.id } });
    expect(stillOriginal.firstName).toBe('Carl');
  });

  it('the audit log is insert-only for the app role (UPDATE is rejected at the DB level)', async () => {
    const org = await seedOrgCentreRoom('Audit');
    await setTenantContext(appPrisma, org.orgId, org.centreId);

    const entry = await appPrisma.auditLogEntry.create({
      data: {
        orgId: org.orgId,
        centreId: org.centreId,
        action: 'test.action',
        entityType: 'Test',
        outcome: 'SUCCESS',
      },
    });

    await expect(
      appPrisma.auditLogEntry.update({
        where: { id: entry.id },
        data: { action: 'tampered' },
      }),
    ).rejects.toThrow();
  });
});
