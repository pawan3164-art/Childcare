import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { GuardianRelationshipsService } from '../../src/guardian-relationships/guardian-relationships.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * Regression test for a bug found building the portal UI: a PARENT user's
 * own User row has no orgId (set only once linked to a child), but
 * TenancyService.withTenant requires an orgId to set RLS context for ANY
 * tenant-scoped query — including a parent listing their own children. A
 * parent created via UsersService, or linked via
 * GuardianRelationshipsService.create, must end up with an orgId so this
 * doesn't 403.
 */
describe('ChildrenService.list: a parent can list their own children', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let children: ChildrenService;
  let relationships: GuardianRelationshipsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    children = new ChildrenService(tenancy, audit);
    relationships = new GuardianRelationshipsService(prismaService, tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('a parent created WITHOUT an orgId is backfilled on first relationship, and can then list their child', async () => {
    const tenant = await seedOrgCentreRoom('ParentBackfill');
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Backfill-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    // Simulate a guardian created with no org, as UsersService used to do for PARENT.
    const guardian = await fixturePrisma.user.create({
      data: { email: `parent-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'P', lastName: 'G' },
    });
    expect(guardian.orgId).toBeNull();

    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 's' };
    await relationships.create(adminUser, { guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT' });

    const backfilled = await fixturePrisma.user.findUniqueOrThrow({ where: { id: guardian.id } });
    expect(backfilled.orgId).toBe(tenant.orgId);

    const parentUser: RequestUser = { userId: guardian.id, orgId: backfilled.orgId, centreId: backfilled.centreId, role: 'PARENT', sessionId: 's' };
    const list = await children.list(parentUser);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(child.id);
  });

  it('a parent cannot see another family\'s children via the list endpoint', async () => {
    const tenant = await seedOrgCentreRoom('ParentIsolation');
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const myChild = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'Mine', lastName: `Iso-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const otherChild = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'Other', lastName: `Iso-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const guardian = await fixturePrisma.user.create({
      data: { email: `parent-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'P', lastName: 'G' },
    });
    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 's' };
    await relationships.create(adminUser, { guardianUserId: guardian.id, childId: myChild.id, relationshipType: 'PARENT' });
    void otherChild;

    const backfilled = await fixturePrisma.user.findUniqueOrThrow({ where: { id: guardian.id } });
    const parentUser: RequestUser = { userId: guardian.id, orgId: backfilled.orgId, centreId: backfilled.centreId, role: 'PARENT', sessionId: 's' };
    const list = await children.list(parentUser);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(myChild.id);
  });
});
