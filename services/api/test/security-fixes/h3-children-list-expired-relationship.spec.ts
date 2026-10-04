import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { disconnectAll, seedOrgCentreRoom } from '../test-utils';
import { asRequestUser, linkGuardian, makeChild, makeUser } from './security-fixtures';

/**
 * Security finding H3: ChildrenService.list for a PARENT filtered on
 * isRestricted but ignored expiresAt, so a guardian whose relationship had
 * lapsed (e.g. a time-boxed guardianship) still saw the child's name, DOB,
 * room and live attendance status — even though AuthorizationService already
 * denies them the detail view.
 */
describe('H3: ChildrenService.list excludes expired guardian relationships', () => {
  let prismaService: PrismaService;
  let children: ChildrenService;
  let authorization: AuthorizationService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    children = new ChildrenService(tenancy, audit);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function seed() {
    const tenant = await seedOrgCentreRoom('H3Expired');
    const parent = await makeUser('PARENT', tenant.orgId, tenant.centreId);
    const current = await makeChild(tenant, tenant.roomId, 'Current');
    const future = await makeChild(tenant, tenant.roomId, 'Future');
    const lapsed = await makeChild(tenant, tenant.roomId, 'Lapsed');
    await linkGuardian(tenant, parent.id, current.id, { relationshipType: 'PARENT' });
    await linkGuardian(tenant, parent.id, future.id, { relationshipType: 'GUARDIAN', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await linkGuardian(tenant, parent.id, lapsed.id, { relationshipType: 'GUARDIAN', expiresAt: new Date(Date.now() - 60 * 1000) });
    return { parentUser: asRequestUser(parent), current, future, lapsed };
  }

  it('excludes a child whose relationship expiresAt is in the past', async () => {
    const { parentUser, lapsed } = await seed();
    const ids = (await children.list(parentUser)).map((c) => c.id);
    expect(ids).not.toContain(lapsed.id);
  });

  it('returns exactly the non-expired children (no expiry, and future expiry)', async () => {
    const { parentUser, current, future } = await seed();
    const ids = (await children.list(parentUser)).map((c) => c.id).sort();
    expect(ids).toEqual([current.id, future.id].sort());
  });

  it('every child in a parent\'s list is one they are authorized to view', async () => {
    const { parentUser } = await seed();
    for (const c of await children.list(parentUser)) {
      expect(await authorization.canAccessChild(parentUser, c.id, 'view')).toBe(true);
    }
  });
});
