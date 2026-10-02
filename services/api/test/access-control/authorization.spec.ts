import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

describe('AuthorizationService: relationship-based access matrix', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let audit: AuditService;
  let authz: AuthorizationService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    audit = new AuditService(tenancy);
    authz = new AuthorizationService(tenancy, audit);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function makeChild(tenant: { orgId: string; centreId: string; roomId: string }) {
    return fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'Test',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
  }

  async function makeUser(
    role: 'PARENT' | 'EDUCATOR' | 'CENTRE_ADMIN' | 'ORG_ADMIN',
    orgId: string,
    centreId: string,
  ) {
    return fixturePrisma.user.create({
      data: {
        orgId,
        centreId,
        email: `${role.toLowerCase()}-${uniqueSuffix()}@example.test`,
        passwordHash: 'not-a-real-hash',
        role,
        firstName: role,
        lastName: 'Test',
      },
    });
  }

  it('a guardian with an unrestricted relationship can view their own child', async () => {
    const tenant = await seedOrgCentreRoom('ParentOwn');
    const child = await makeChild(tenant);
    const guardian = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await fixturePrisma.guardianChildRelationship.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        guardianUserId: guardian.id,
        childId: child.id,
        relationshipType: 'PARENT',
      },
    });

    const user: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT' };
    await expect(authz.canAccessChild(user, child.id, 'view')).resolves.toBe(true);
  });

  it('a guardian with no relationship to the child is denied, and a DENIED audit entry is recorded', async () => {
    const tenant = await seedOrgCentreRoom('ParentOther');
    const child = await makeChild(tenant);
    const unrelatedGuardian = await makeUser('PARENT', tenant.orgId, tenant.centreId);

    const user: RequestUser = {
      userId: unrelatedGuardian.id,
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      role: 'PARENT',
    };

    await expect(authz.assertCanAccessChild(user, child.id, 'view')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const auditRows = await fixturePrisma.auditLogEntry.findMany({
      where: { entityId: child.id, actorUserId: unrelatedGuardian.id, outcome: 'DENIED' },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('isRestricted on the relationship blocks access even though the relationship exists', async () => {
    const tenant = await seedOrgCentreRoom('Restricted');
    const child = await makeChild(tenant);
    const guardian = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await fixturePrisma.guardianChildRelationship.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        guardianUserId: guardian.id,
        childId: child.id,
        relationshipType: 'AUTHORIZED_PICKUP',
        isRestricted: true,
      },
    });

    const user: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT' };
    await expect(authz.canAccessChild(user, child.id, 'view')).resolves.toBe(false);
  });

  it('a relationship without canViewMedia allows view but denies viewMedia specifically', async () => {
    const tenant = await seedOrgCentreRoom('MediaFlag');
    const child = await makeChild(tenant);
    const guardian = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    await fixturePrisma.guardianChildRelationship.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        guardianUserId: guardian.id,
        childId: child.id,
        relationshipType: 'PARENT',
        canViewMedia: false,
      },
    });

    const user: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT' };
    await expect(authz.canAccessChild(user, child.id, 'view')).resolves.toBe(true);
    await expect(authz.canAccessChild(user, child.id, 'viewMedia')).resolves.toBe(false);
  });

  it('an educator assigned to the child\'s room can view the child', async () => {
    const tenant = await seedOrgCentreRoom('EducatorAssigned');
    const child = await makeChild(tenant);
    const educator = await makeUser('EDUCATOR', tenant.orgId, tenant.centreId);
    await fixturePrisma.staffRoomAssignment.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        userId: educator.id,
        roomId: tenant.roomId,
        startDate: new Date('2026-01-01'),
      },
    });

    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };
    await expect(authz.canAccessChild(user, child.id, 'view')).resolves.toBe(true);
  });

  it('an educator NOT assigned to the child\'s room is denied', async () => {
    const tenant = await seedOrgCentreRoom('EducatorUnassigned');
    const child = await makeChild(tenant);
    const educator = await makeUser('EDUCATOR', tenant.orgId, tenant.centreId);
    // no StaffRoomAssignment created for this educator

    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };
    await expect(authz.canAccessChild(user, child.id, 'view')).resolves.toBe(false);
  });

  it('a centre admin from a different centre in the same org is denied', async () => {
    const tenantA = await seedOrgCentreRoom('CentreA');
    const centreBOnly = await seedOrgCentreRoom('CentreB');
    // Force same org so this is a cross-centre, not cross-org, scenario.
    const sameOrgCentreB = await fixturePrisma.centre.create({
      data: { orgId: tenantA.orgId, name: `Centre B ${uniqueSuffix()}` },
    });

    const child = await makeChild(tenantA);
    const adminOfCentreB = await makeUser('CENTRE_ADMIN', tenantA.orgId, sameOrgCentreB.id);

    const user: RequestUser = {
      userId: adminOfCentreB.id,
      orgId: tenantA.orgId,
      centreId: sameOrgCentreB.id,
      role: 'CENTRE_ADMIN',
    };
    await expect(authz.canAccessChild(user, child.id, 'view')).resolves.toBe(false);
    void centreBOnly;
  });

  it('a user from a different organisation is denied even with a matching role, because RLS hides the child', async () => {
    const tenantA = await seedOrgCentreRoom('CrossOrgA');
    const tenantB = await seedOrgCentreRoom('CrossOrgB');
    const child = await makeChild(tenantA);
    const orgAdminOfB = await makeUser('ORG_ADMIN', tenantB.orgId, tenantB.centreId);

    const user: RequestUser = {
      userId: orgAdminOfB.id,
      orgId: tenantB.orgId,
      centreId: tenantB.centreId,
      role: 'ORG_ADMIN',
    };
    await expect(authz.canAccessChild(user, child.id, 'view')).resolves.toBe(false);
  });
});
