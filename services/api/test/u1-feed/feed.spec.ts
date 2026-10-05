import sharp from 'sharp';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { FeedService } from '../../src/feed/feed.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * U1 family feed (Delivery Plan §13): photo posts and announcements in one
 * per-child feed, plus a per-day timeline. Visibility reuses
 * MediaService.canView, so the group-photo consent rule applies to posts.
 */
describe('FeedService: family feed and daily timeline', () => {
  let prismaService: PrismaService;
  let media: MediaService;
  let feed: FeedService;
  let photo: Buffer;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    media = new MediaService(tenancy, audit, authorization, new InMemoryObjectStorage());
    feed = new FeedService(tenancy, audit, authorization, media);
    photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ffcc00' } }).jpeg().toBuffer();
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const otherRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Other ${uniqueSuffix()}` } });
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `e-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'Priya', lastName: 'Educator' },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    const family = async (roomId: string, consent = true) => {
      const child = await fixturePrisma.child.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId, firstName: 'C', lastName: `Feed-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01'), groupPhotoConsent: consent },
      });
      const parent = await fixturePrisma.user.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `p-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'P', lastName: 'G' },
      });
      await fixturePrisma.guardianChildRelationship.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: parent.id, childId: child.id, relationshipType: 'PARENT' },
      });
      const user: RequestUser = { userId: parent.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 's' };
      return { child, user };
    };
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 's' };
    return { tenant, otherRoom, educatorUser, family };
  }

  const upload = (user: RequestUser, childIds: string[]) =>
    media.upload(user, { buffer: photo, mimetype: 'image/jpeg', size: photo.length }, { childIds });

  it('a photo post appears in the tagged child\'s feed with a view URL, and nowhere else', async () => {
    const { tenant, otherRoom, educatorUser, family } = await setup('FeedPhoto');
    const mia = await family(tenant.roomId);
    const noah = await family(otherRoom.id);
    const asset = await upload(educatorUser, [mia.child.id]);

    const post = await feed.createPhotoPost(educatorUser, { caption: 'Painting with sponges', mediaAssetIds: [asset.id] });

    const miaFeed = await feed.childFeed(mia.user, mia.child.id, {});
    const item = miaFeed.items.find((i) => i.id === post.id);
    expect(item).toMatchObject({ kind: 'PHOTO_POST', caption: 'Painting with sponges', author: { firstName: 'Priya' } });
    expect(item && item.kind === 'PHOTO_POST' && item.media[0]).toMatchObject({ id: asset.id, width: 40, height: 30 });
    expect(item && item.kind === 'PHOTO_POST' && item.media[0].url).toContain(asset.storageKey);

    const noahFeed = await feed.childFeed(noah.user, noah.child.id, {});
    expect(noahFeed.items.find((i) => i.id === post.id)).toBeUndefined();
    await expect(feed.childFeed(noah.user, mia.child.id, {})).rejects.toThrow();
  });

  it('a group post is hidden from a family until every other tagged child has consent', async () => {
    const { tenant, educatorUser, family } = await setup('FeedGroup');
    const mia = await family(tenant.roomId, true);
    const lucas = await family(tenant.roomId, false);
    const asset = await upload(educatorUser, [mia.child.id, lucas.child.id]);
    const post = await feed.createPhotoPost(educatorUser, { caption: 'Sandpit', mediaAssetIds: [asset.id] });

    expect((await feed.childFeed(mia.user, mia.child.id, {})).items.map((i) => i.id)).not.toContain(post.id);
    expect((await feed.childFeed(lucas.user, lucas.child.id, {})).items.map((i) => i.id)).toContain(post.id);
  });

  it('room announcements reach that room\'s families only; centre announcements reach everyone', async () => {
    const { tenant, otherRoom, educatorUser, family } = await setup('FeedAnnounce');
    const mia = await family(tenant.roomId);
    const noah = await family(otherRoom.id);
    const room = await fixturePrisma.message.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, scope: 'ROOM', authorUserId: educatorUser.userId, body: 'Bring a hat tomorrow' },
    });
    const centre = await fixturePrisma.message.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, scope: 'CENTRE', authorUserId: educatorUser.userId, body: 'Closed Monday' },
    });

    const miaIds = (await feed.childFeed(mia.user, mia.child.id, {})).items.map((i) => i.id);
    const noahIds = (await feed.childFeed(noah.user, noah.child.id, {})).items.map((i) => i.id);
    expect(miaIds).toEqual(expect.arrayContaining([room.id, centre.id]));
    expect(noahIds).toContain(centre.id);
    expect(noahIds).not.toContain(room.id);
  });

  it('only staff can post, and only photos they can see', async () => {
    const { tenant, educatorUser, family } = await setup('FeedPostDeny');
    const mia = await family(tenant.roomId);
    const asset = await upload(educatorUser, [mia.child.id]);
    await expect(feed.createPhotoPost(mia.user, { caption: 'x', mediaAssetIds: [asset.id] })).rejects.toThrow();

    const elsewhere = await setup('FeedPostDenyOther');
    await expect(feed.createPhotoPost(elsewhere.educatorUser, { caption: 'x', mediaAssetIds: [asset.id] })).rejects.toThrow();
  });

  it('the daily timeline merges attendance, care records and photo posts for that centre day, in time order', async () => {
    const { tenant, educatorUser, family } = await setup('FeedTimeline');
    const mia = await family(tenant.roomId);
    const now = Date.now();
    await fixturePrisma.attendanceEvent.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: mia.child.id, eventType: 'SIGN_IN', method: 'EDUCATOR', timestamp: new Date(now - 3000) },
    });
    await fixturePrisma.careRecord.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: mia.child.id, type: 'MEAL', timestamp: new Date(now - 2000), note: 'Ate all of lunch', groupEventId: uniqueSuffix(), recordedByUserId: educatorUser.userId },
    });
    await fixturePrisma.careRecord.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: mia.child.id, type: 'SLEEP', timestamp: new Date(now - 48 * 3600 * 1000), groupEventId: uniqueSuffix(), recordedByUserId: educatorUser.userId },
    });
    const asset = await upload(educatorUser, [mia.child.id]);
    const post = await feed.createPhotoPost(educatorUser, { caption: 'Garden', mediaAssetIds: [asset.id] });

    const timeline = await feed.childTimeline(mia.user, mia.child.id);

    expect(timeline.entries.map((e) => e.kind)).toEqual(['ATTENDANCE', 'CARE_RECORD', 'PHOTO_POST']);
    expect(timeline.entries[1]).toMatchObject({ kind: 'CARE_RECORD', type: 'MEAL', note: 'Ate all of lunch' });
    expect(timeline.entries[2]).toMatchObject({ kind: 'PHOTO_POST', id: post.id });
  });
});
