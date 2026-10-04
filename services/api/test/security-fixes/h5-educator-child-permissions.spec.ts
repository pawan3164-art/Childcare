import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService, ChildPermission } from '../../src/authorization/authorization.service';
import { disconnectAll, fixturePrisma, uniqueSuffix } from '../test-utils';
import { makeChild, seedFamily } from './security-fixtures';

/**
 * Security finding H5: canAccessChild returned `!!assignment` for an EDUCATOR
 * regardless of the requested permission, so a room educator passed
 * 'viewBilling' (family ledger, payments, CCS entitlement) and 'pickup'.
 * Educators need view + viewMedia for their room; billing and pickup are not
 * theirs. CENTRE_ADMIN keeps all four for children in their centre.
 */
describe('H5: AuthorizationService.canAccessChild permission matrix for staff', () => {
  let prismaService: PrismaService;
  let authorization: AuthorizationService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const expectedForAssignedEducator: [ChildPermission, boolean][] = [
    ['view', true],
    ['viewMedia', true],
    ['viewBilling', false],
    ['pickup', false],
  ];

  it.each(expectedForAssignedEducator)('EDUCATOR assigned to the child\'s room: %s -> %s', async (permission, expected) => {
    const { educatorUser, child } = await seedFamily(`H5Edu-${permission}`);
    expect(await authorization.canAccessChild(educatorUser, child.id, permission)).toBe(expected);
  });

  it.each(['view', 'viewMedia', 'viewBilling', 'pickup'] as ChildPermission[])(
    'EDUCATOR NOT assigned to the child\'s room: %s -> false (sanity)',
    async (permission) => {
      const { tenant, educatorUser } = await seedFamily(`H5EduOut-${permission}`);
      const otherRoom = await fixturePrisma.room.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `H5 Other ${uniqueSuffix()}` },
      });
      const outsider = await makeChild(tenant, otherRoom.id);
      expect(await authorization.canAccessChild(educatorUser, outsider.id, permission)).toBe(false);
    },
  );

  it.each(['view', 'viewMedia', 'viewBilling', 'pickup'] as ChildPermission[])(
    'CENTRE_ADMIN for a child in their centre: %s -> true',
    async (permission) => {
      const { adminUser, child } = await seedFamily(`H5Admin-${permission}`);
      expect(await authorization.canAccessChild(adminUser, child.id, permission)).toBe(true);
    },
  );
});
