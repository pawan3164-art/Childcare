import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { MediaService } from '../../src/media/media.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * BRD §17: "media with several children shows to a family only if every
 * tagged child's permissions allow it." This is the one rule in the whole
 * media pipeline with real privacy risk, so it gets its own focused suite
 * even though the rest of media handling (storage/signed URLs) isn't built yet.
 */
describe('MediaService: multi-child tag visibility rule', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let authorization: AuthorizationService;
  let media: MediaService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    media = new MediaService(tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const educator = await fixturePrisma.user.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        email: `educator-${uniqueSuffix()}@example.test`,
        passwordHash: 'x',
        role: 'EDUCATOR',
        firstName: 'E',
        lastName: 'D',
      },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    return { tenant, educator };
  }

  async function makeChildWithGuardian(
    tenant: { orgId: string; centreId: string; roomId: string },
    canViewMedia: boolean,
  ) {
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'C',
        lastName: `Media-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
    const guardian = await fixturePrisma.user.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        email: `guardian-${uniqueSuffix()}@example.test`,
        passwordHash: 'x',
        role: 'PARENT',
        firstName: 'G',
        lastName: 'P',
      },
    });
    await fixturePrisma.guardianChildRelationship.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        guardianUserId: guardian.id,
        childId: child.id,
        relationshipType: 'PARENT',
        canViewMedia,
      },
    });
    return { child, guardian };
  }

  it('a single-child photo is visible to that child\'s guardian when canViewMedia is true', async () => {
    const { tenant, educator } = await setup('MediaSingleAllowed');
    const { child, guardian } = await makeChildWithGuardian(tenant, true);
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };

    const asset = await media.register(educatorUser, { storageKey: `stub-${uniqueSuffix()}`, childIds: [child.id] });

    const guardianUser: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 'test-session' };
    await expect(media.canView(guardianUser, asset.id)).resolves.toBe(true);
  });

  it('a single-child photo is NOT visible when that guardian\'s canViewMedia is false', async () => {
    const { tenant, educator } = await setup('MediaSingleDenied');
    const { child, guardian } = await makeChildWithGuardian(tenant, false);
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };

    const asset = await media.register(educatorUser, { storageKey: `stub-${uniqueSuffix()}`, childIds: [child.id] });

    const guardianUser: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 'test-session' };
    await expect(media.canView(guardianUser, asset.id)).resolves.toBe(false);
  });

  it('a two-child photo is hidden from a guardian if even one tagged child\'s permission denies it', async () => {
    const { tenant, educator } = await setup('MediaMultiMixed');
    const { child: childA } = await makeChildWithGuardian(tenant, true);
    const { child: childB, guardian: guardianOfBothViaA } = await makeChildWithGuardian(tenant, false);
    // Give the same guardian a relationship to BOTH children: allowed for A, denied for B.
    await fixturePrisma.guardianChildRelationship.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        guardianUserId: guardianOfBothViaA.id,
        childId: childA.id,
        relationshipType: 'GUARDIAN',
        canViewMedia: true,
      },
    });

    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    const asset = await media.register(educatorUser, {
      storageKey: `stub-${uniqueSuffix()}`,
      childIds: [childA.id, childB.id],
    });

    const guardianUser: RequestUser = {
      userId: guardianOfBothViaA.id,
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      role: 'PARENT',
      sessionId: 'test-session',
    };
    // Has canViewMedia:true for childA, but canViewMedia:false for childB (its original relationship) — must be denied overall.
    await expect(media.canView(guardianUser, asset.id)).resolves.toBe(false);
  });

  it('registering media tagging a child the capturer cannot access is rejected entirely', async () => {
    const { tenant, educator } = await setup('MediaOutsider');
    const outsiderRoom = await fixturePrisma.room.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Outsider Room ${uniqueSuffix()}` },
    });
    const outsiderChild = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: outsiderRoom.id,
        firstName: 'Outsider',
        lastName: `Media-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });

    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    await expect(
      media.register(educatorUser, { storageKey: `stub-${uniqueSuffix()}`, childIds: [outsiderChild.id] }),
    ).rejects.toThrow();
  });
});
