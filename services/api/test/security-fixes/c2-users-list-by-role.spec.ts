import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { UsersService } from '../../src/centre-admin/users.service';
import { disconnectAll, seedOrgCentreRoom } from '../test-utils';
import { asRequestUser, makeUser } from './security-fixtures';

/**
 * Security finding C2: UsersService.listByRole('PARENT') had no orgId filter
 * (`users` is outside RLS per ADR 0001), so any admin could enumerate every
 * parent's name + email across every organisation on the platform.
 */
describe('C2: UsersService.listByRole(PARENT) is org-scoped', () => {
  let prismaService: PrismaService;
  let users: UsersService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    users = new UsersService(prismaService, audit);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  // Names sort first so the existing take:200 cap can't hide a leak and make
  // a negative assertion pass vacuously.
  async function seedTwoOrgs() {
    const mine = await seedOrgCentreRoom('C2Mine');
    const theirs = await seedOrgCentreRoom('C2Theirs');
    const admin = await makeUser('CENTRE_ADMIN', mine.orgId, mine.centreId);
    const myParent = await makeUser('PARENT', mine.orgId, mine.centreId, 'AAA-c2-my-parent');
    const foreignParent = await makeUser('PARENT', theirs.orgId, theirs.centreId, 'AAA-c2-foreign-parent');
    const orphanParent = await makeUser('PARENT', null, null, 'AAA-c2-orphan-parent');
    return { admin, myParent, foreignParent, orphanParent };
  }

  it('does not return a parent belonging to another organisation', async () => {
    const { admin, foreignParent } = await seedTwoOrgs();
    const ids = (await users.listByRole(asRequestUser(admin), 'PARENT')).map((u) => u.id);
    expect(ids).not.toContain(foreignParent.id);
  });

  it('does not return a parent with no organisation', async () => {
    const { admin, orphanParent } = await seedTwoOrgs();
    const ids = (await users.listByRole(asRequestUser(admin), 'PARENT')).map((u) => u.id);
    expect(ids).not.toContain(orphanParent.id);
  });

  it('every returned parent has the caller\'s orgId', async () => {
    const { admin, myParent } = await seedTwoOrgs();
    const ids = (await users.listByRole(asRequestUser(admin), 'PARENT')).map((u) => u.id);
    expect(ids).toEqual([myParent.id]);
  });

  it('still returns the caller\'s own-org parent (sanity)', async () => {
    const { admin, myParent } = await seedTwoOrgs();
    const ids = (await users.listByRole(asRequestUser(admin), 'PARENT')).map((u) => u.id);
    expect(ids).toContain(myParent.id);
  });
});
