import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { LearningService } from '../../src/learning/learning.service';
import { FeedService } from '../../src/feed/feed.service';
import { ChecklistsService } from '../../src/checklists/checklists.service';
import { CareAlertsService } from '../../src/care-records/care-alerts.service';
import { SyncService } from '../../src/sync/sync.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * U2 acceptance (Delivery Plan §13): "An educator writes a learning story
 * offline, links outcomes and photos, and publishes it; the parent sees it in
 * the feed and the portfolio; another family cannot see it."
 */
describe('Learning in the family feed and offline drafts', () => {
  let prismaService: PrismaService;
  let learning: LearningService;
  let feed: FeedService;
  let sync: SyncService;
  let media: MediaService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    const notifications = new NotificationsService(tenancy, new StubPushProvider());
    media = new MediaService(tenancy, audit, authorization, new InMemoryObjectStorage());
    learning = new LearningService(tenancy, audit, authorization, media, notifications);
    feed = new FeedService(tenancy, audit, authorization, media, learning);
    sync = new SyncService(tenancy, authorization, audit, new ChecklistsService(tenancy, audit, authorization, notifications), new CareAlertsService(tenancy, notifications), learning);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const mk = async (role: 'EDUCATOR' | 'PARENT') =>
      fixturePrisma.user.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: role, lastName: 'T' } });
    const asUser = (id: string, role: RequestUser['role']): RequestUser => ({ userId: id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' });
    const [a, b] = [await mk('EDUCATOR'), await mk('EDUCATOR')];
    for (const e of [a, b]) {
      await fixturePrisma.staffRoomAssignment.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: e.id, roomId: tenant.roomId, startDate: new Date('2026-01-01'), isLead: e === b } });
    }
    const families = [];
    for (let i = 0; i < 2; i++) {
      const child = await fixturePrisma.child.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: `K${i}`, lastName: `F-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') } });
      const g = await mk('PARENT');
      await fixturePrisma.guardianChildRelationship.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: g.id, childId: child.id, relationshipType: 'PARENT' } });
      families.push({ child, user: asUser(g.id, 'PARENT') });
    }
    return { tenant, author: asUser(a.id, 'EDUCATOR'), reviewer: asUser(b.id, 'EDUCATOR'), mine: families[0], other: families[1] };
  }

  function op(entityId: string, operationType: 'CREATE' | 'UPDATE', payload: Record<string, unknown>) {
    return { idempotencyKey: `k-${uniqueSuffix()}`, clientOperationId: `o-${uniqueSuffix()}`, entityType: 'LearningRecordDraft', entityId, operationType, clientTimestamp: new Date().toISOString(), payload };
  }

  it('a story drafted offline is saved via sync, published, and appears in only that family\'s feed and portfolio', async () => {
    const { tenant, author, reviewer, mine, other } = await setup('LrnFeed');
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#88aa44' } }).jpeg().toBuffer();
    const photo = await media.upload(author, { buffer: jpeg, mimetype: 'image/jpeg', size: jpeg.length }, { childIds: [mine.child.id], roomId: tenant.roomId });
    const id = randomUUID();
    const content = { roomId: tenant.roomId, kind: 'LEARNING_STORY', title: 'Mud kitchen', observation: 'Mixed mud pies', outcomes: ['4.2'], childIds: [mine.child.id], mediaAssetIds: [photo.id] };

    await sync.submit(author, op(id, 'CREATE', { ...content, title: 'Mud' }));
    // A later offline auto-save of the same draft is an UPDATE of the same record.
    const update = await sync.submit(author, op(id, 'UPDATE', content));
    expect(update.status).toBe('APPLIED');
    expect(await fixturePrisma.learningRecord.findUniqueOrThrow({ where: { id } })).toMatchObject({ title: 'Mud kitchen', status: 'DRAFT' });

    // Not visible to the family while it is a draft.
    expect((await feed.childFeed(mine.user, mine.child.id, {})).items.find((i) => i.id === id)).toBeUndefined();

    await learning.submit(author, id);
    await learning.publish(reviewer, id);

    const item = (await feed.childFeed(mine.user, mine.child.id, {})).items.find((i) => i.id === id);
    expect(item).toMatchObject({ kind: 'LEARNING', title: 'Mud kitchen', outcomes: [{ code: '4.2' }] });
    expect(item && 'media' in item && item.media).toHaveLength(1);
    expect((await learning.portfolio(mine.user, mine.child.id, {})).items.map((i) => i.id)).toContain(id);

    expect((await feed.childFeed(other.user, other.child.id, {})).items.find((i) => i.id === id)).toBeUndefined();
    await expect(learning.portfolio(other.user, mine.child.id, {})).rejects.toThrow();
  });

  it('offline saves cannot change a record that has left draft', async () => {
    const { tenant, author, reviewer, mine } = await setup('LrnSyncLocked');
    const id = randomUUID();
    const content = { roomId: tenant.roomId, kind: 'OBSERVATION', title: 'Stacking', observation: 'Stacked 6 blocks', outcomes: ['4.1'], childIds: [mine.child.id] };
    await sync.submit(author, op(id, 'CREATE', content));
    await learning.submit(author, id);
    await learning.publish(reviewer, id);
    await expect(sync.submit(author, op(id, 'UPDATE', { ...content, title: 'Changed offline' }))).rejects.toThrow(/draft/i);
    expect((await fixturePrisma.learningRecord.findUniqueOrThrow({ where: { id } })).title).toBe('Stacking');
  });
});
