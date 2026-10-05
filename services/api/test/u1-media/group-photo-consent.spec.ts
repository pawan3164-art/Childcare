import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * BRD §17: "media with several children shows to a family only if every
 * tagged child's permissions allow it." Before U1 a group photo was visible
 * only to a parent who was guardian of EVERY tagged child, so no family saw
 * group photos at all. Now each other tagged child needs group-photo consent
 * from their family (off by default), and the viewer must be allowed to see
 * photos of at least one tagged child of their own.
 */
describe('Group photos need consent from every other tagged child\'s family', () => {
  let prismaService: PrismaService;
  let media: MediaService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    media = new MediaService(tenancy, audit, new AuthorizationService(tenancy, audit), new InMemoryObjectStorage());
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function family(tenant: { orgId: string; centreId: string; roomId: string }, opts: { consent: boolean; canViewMedia?: boolean }) {
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'C',
        lastName: `Group-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
        groupPhotoConsent: opts.consent,
      },
    });
    const guardian = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `g-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'G', lastName: 'P' },
    });
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT', canViewMedia: opts.canViewMedia ?? true },
    });
    const user: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 's' };
    return { child, guardian, user };
  }

  async function educatorIn(tenant: { orgId: string; centreId: string; roomId: string }): Promise<RequestUser> {
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `e-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    return { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 's' };
  }

  it('both families see a two-child photo when both children have group-photo consent', async () => {
    const tenant = await seedOrgCentreRoom('GroupBoth');
    const a = await family(tenant, { consent: true });
    const b = await family(tenant, { consent: true });
    const asset = await media.register(await educatorIn(tenant), { storageKey: `k-${uniqueSuffix()}`, childIds: [a.child.id, b.child.id] });

    await expect(media.canView(a.user, asset.id)).resolves.toBe(true);
    await expect(media.canView(b.user, asset.id)).resolves.toBe(true);
  });

  it('without the other child\'s consent, a family cannot see the group photo (consent defaults to off)', async () => {
    const tenant = await seedOrgCentreRoom('GroupOneMissing');
    const a = await family(tenant, { consent: true });
    const b = await family(tenant, { consent: false });
    const asset = await media.register(await educatorIn(tenant), { storageKey: `k-${uniqueSuffix()}`, childIds: [a.child.id, b.child.id] });

    // A's family would be showing B without B's family's consent.
    await expect(media.canView(a.user, asset.id)).resolves.toBe(false);
    // B's family: A has consented, so B's family may see it.
    await expect(media.canView(b.user, asset.id)).resolves.toBe(true);

    const defaulted = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'D', lastName: `Default-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    expect(defaulted.groupPhotoConsent).toBe(false);
  });

  it('a family that is not guardian of any tagged child sees nothing, even with full consent', async () => {
    const tenant = await seedOrgCentreRoom('GroupOutsider');
    const a = await family(tenant, { consent: true });
    const b = await family(tenant, { consent: true });
    const outsider = await family(tenant, { consent: true });
    const asset = await media.register(await educatorIn(tenant), { storageKey: `k-${uniqueSuffix()}`, childIds: [a.child.id, b.child.id] });

    await expect(media.canView(outsider.user, asset.id)).resolves.toBe(false);
  });

  it('a guardian whose own media permission is off for their child cannot see a group photo of that child', async () => {
    const tenant = await seedOrgCentreRoom('GroupOwnOff');
    const a = await family(tenant, { consent: true, canViewMedia: false });
    const b = await family(tenant, { consent: true });
    const asset = await media.register(await educatorIn(tenant), { storageKey: `k-${uniqueSuffix()}`, childIds: [a.child.id, b.child.id] });

    await expect(media.canView(a.user, asset.id)).resolves.toBe(false);
  });

  it('room educators still see every photo of their room regardless of consent', async () => {
    const tenant = await seedOrgCentreRoom('GroupStaff');
    const a = await family(tenant, { consent: false });
    const b = await family(tenant, { consent: false });
    const educator = await educatorIn(tenant);
    const asset = await media.register(educator, { storageKey: `k-${uniqueSuffix()}`, childIds: [a.child.id, b.child.id] });

    await expect(media.canView(educator, asset.id)).resolves.toBe(true);
  });
});
