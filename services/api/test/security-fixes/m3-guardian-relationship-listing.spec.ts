import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { GuardianRelationshipsService } from '../../src/guardian-relationships/guardian-relationships.service';
import { disconnectAll } from '../test-utils';
import { asRequestUser, linkGuardian, makeUser, seedFamily } from './security-fixtures';

/**
 * Security finding M3: GET /guardian-relationships?childId returned every
 * relationship row for the child to any guardian — other guardians' user
 * ids, isRestricted flags (which can reveal custody/court-order
 * arrangements), pickup rights and expiries. A parent must only see their
 * own row. Staff still see the full list, with guardian names so the portal
 * can ask "authorised by whom?" instead of guessing (finding H2's portal half).
 */
describe('M3: guardian relationship listing does not expose the family graph to parents', () => {
  let prismaService: PrismaService;
  let relationships: GuardianRelationshipsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    relationships = new GuardianRelationshipsService(prismaService, tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function seedTwoGuardians(label: string) {
    const fam = await seedFamily(label);
    const restrictedParent = await makeUser('PARENT', fam.tenant.orgId, fam.tenant.centreId, 'restricted');
    await linkGuardian(fam.tenant, restrictedParent.id, fam.child.id, { isRestricted: true });
    const coParent = await makeUser('PARENT', fam.tenant.orgId, fam.tenant.centreId, 'coparent');
    await linkGuardian(fam.tenant, coParent.id, fam.child.id);
    return { ...fam, restrictedParent, coParent };
  }

  it('returns only the calling parent\'s own relationship row', async () => {
    const fam = await seedTwoGuardians('m3-parent');

    const rows = await relationships.listForChild(fam.parentUser, fam.child.id);

    expect(rows.map((r) => r.guardianUserId)).toEqual([fam.parent.id]);
  });

  it('a co-parent likewise sees only their own row', async () => {
    const fam = await seedTwoGuardians('m3-coparent');

    const rows = await relationships.listForChild(asRequestUser(fam.coParent), fam.child.id);

    expect(rows.map((r) => r.guardianUserId)).toEqual([fam.coParent.id]);
  });

  it('staff see every relationship, with guardian names for the authorising-guardian picker', async () => {
    const fam = await seedTwoGuardians('m3-staff');

    const rows = await relationships.listForChild(fam.adminUser, fam.child.id);

    expect(rows.map((r) => r.guardianUserId).sort()).toEqual([fam.parent.id, fam.restrictedParent.id, fam.coParent.id].sort());
    const own = rows.find((r) => r.guardianUserId === fam.parent.id);
    expect(own?.guardian).toEqual({ firstName: fam.parent.firstName, lastName: fam.parent.lastName });
  });
});
