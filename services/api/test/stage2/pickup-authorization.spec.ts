import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { GuardianRelationshipsService } from '../../src/guardian-relationships/guardian-relationships.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

describe('GuardianRelationshipsService: authorized pickup management (BRD §13)', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let relationships: GuardianRelationshipsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    relationships = new GuardianRelationshipsService(prismaService, tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('a centre admin can grant pickup authorization with an expiry', async () => {
    const tenant = await seedOrgCentreRoom('PickupGrant');
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Pickup-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const aunt = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `aunt-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'Aunt', lastName: 'P' },
    });
    const relationship = await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: aunt.id, childId: child.id, relationshipType: 'AUTHORIZED_PICKUP', canPickup: false },
    });

    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 'test-session' };
    const expiresAt = new Date('2026-12-31T00:00:00Z').toISOString();
    const updated = await relationships.updatePickupAuthorization(adminUser, relationship.id, { canPickup: true, expiresAt });

    expect(updated.canPickup).toBe(true);
    expect(updated.expiresAt?.toISOString()).toBe(expiresAt);
  });

  it('an expired pickup authorization denies the pickup permission check', async () => {
    const tenant = await seedOrgCentreRoom('PickupExpired');
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Pickup-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const neighbour = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `neighbour-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'N', lastName: 'P' },
    });
    const relationship = await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: neighbour.id, childId: child.id, relationshipType: 'AUTHORIZED_PICKUP', canPickup: true },
    });

    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 'test-session' };
    // Set an expiry in the past.
    await relationships.updatePickupAuthorization(adminUser, relationship.id, {
      canPickup: true,
      expiresAt: new Date('2020-01-01T00:00:00Z').toISOString(),
    });

    const authorization = new AuthorizationService(tenancy, new AuditService(tenancy));
    const neighbourUser: RequestUser = { userId: neighbour.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 'test-session' };
    await expect(authorization.canAccessChild(neighbourUser, child.id, 'pickup')).resolves.toBe(false);
  });

  it('a non-admin (e.g. an educator) cannot change pickup authorization', async () => {
    const tenant = await seedOrgCentreRoom('PickupDeniedRole');
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `educator-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Pickup-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const guardian = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `g-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'G', lastName: 'P' },
    });
    const relationship = await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'AUTHORIZED_PICKUP' },
    });

    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    await expect(
      relationships.updatePickupAuthorization(educatorUser, relationship.id, { canPickup: true }),
    ).rejects.toThrow();
  });
});
