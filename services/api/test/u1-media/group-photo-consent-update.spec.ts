import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

describe('ChildrenService.setGroupPhotoConsent: who may record group-photo consent', () => {
  let prismaService: PrismaService;
  let children: ChildrenService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    children = new ChildrenService(tenancy, new AuditService(tenancy));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Consent-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const mk = async (role: 'PARENT' | 'EDUCATOR' | 'CENTRE_ADMIN'): Promise<RequestUser> => {
      const u = await fixturePrisma.user.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: 'X', lastName: 'Y' },
      });
      return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
    };
    const parent = await mk('PARENT');
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: parent.userId, childId: child.id, relationshipType: 'PARENT' },
    });
    return { tenant, child, parent, mk };
  }

  it('the child\'s guardian can turn consent on and off, and each change is audited with who and when', async () => {
    const { child, parent } = await setup('ConsentParent');

    const on = await children.setGroupPhotoConsent(parent, child.id, true);
    expect(on).toMatchObject({ id: child.id, groupPhotoConsent: true, groupPhotoConsentUpdatedBy: parent.userId });
    expect(on.groupPhotoConsentUpdatedAt).not.toBeNull();
    await children.setGroupPhotoConsent(parent, child.id, false);

    const audits = await fixturePrisma.auditLogEntry.findMany({ where: { entityId: child.id, action: 'child.groupPhotoConsent.update' }, orderBy: { timestamp: 'asc' } });
    expect(audits.map((a) => (a.metadata as { consent: boolean }).consent)).toEqual([true, false]);
  });

  it('a centre admin can record consent on a family\'s behalf', async () => {
    const { child, mk } = await setup('ConsentAdmin');
    const admin = await mk('CENTRE_ADMIN');
    await expect(children.setGroupPhotoConsent(admin, child.id, true)).resolves.toMatchObject({ groupPhotoConsent: true });
  });

  it('educators, other families and restricted guardians cannot change it', async () => {
    const { tenant, child, mk } = await setup('ConsentDenied');
    const educator = await mk('EDUCATOR');
    const otherParent = await mk('PARENT');
    const restricted = await mk('PARENT');
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: restricted.userId, childId: child.id, relationshipType: 'GUARDIAN', isRestricted: true },
    });

    for (const user of [educator, otherParent, restricted]) {
      await expect(children.setGroupPhotoConsent(user, child.id, true)).rejects.toThrow();
    }
    const unchanged = await fixturePrisma.child.findUniqueOrThrow({ where: { id: child.id } });
    expect(unchanged.groupPhotoConsent).toBe(false);
  });
});
