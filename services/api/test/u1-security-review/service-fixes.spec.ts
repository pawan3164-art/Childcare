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
import { CareRecordsService } from '../../src/care-records/care-records.service';
import { CareAlertsService } from '../../src/care-records/care-alerts.service';
import { ChecklistsService } from '../../src/checklists/checklists.service';
import { MessagingService } from '../../src/messaging/messaging.service';
import { SyncService } from '../../src/sync/sync.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext, uniqueSuffix } from '../test-utils';

/**
 * Fixes for the U1 security review (2026-10-05): M1 future-dated sleep checks,
 * M2 backdated checklists, M3 room announcements outside an educator's rooms,
 * M5 upload decoder and tag limits, and lows L1-L5.
 */
describe('U1 security review fixes', () => {
  let prismaService: PrismaService;
  let media: MediaService;
  let care: CareRecordsService;
  let checklists: ChecklistsService;
  let messaging: MessagingService;
  let sync: SyncService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    const notifications = new NotificationsService(tenancy, new StubPushProvider());
    const alerts = new CareAlertsService(tenancy, notifications);
    media = new MediaService(tenancy, audit, authorization, new InMemoryObjectStorage());
    care = new CareRecordsService(tenancy, audit, authorization, alerts);
    checklists = new ChecklistsService(tenancy, audit, authorization, notifications);
    messaging = new MessagingService(tenancy, audit, notifications, authorization);
    sync = new SyncService(tenancy, authorization, audit, checklists, alerts);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function user(tenant: { orgId: string; centreId: string }, role: RequestUser['role'], roomId?: string): Promise<RequestUser> {
    const u = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: role, lastName: 'T' },
    });
    if (roomId) await fixturePrisma.staffRoomAssignment.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: u.id, roomId, startDate: new Date('2026-01-01') } });
    return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
  }

  async function child(tenant: { orgId: string; centreId: string; roomId: string }) {
    return fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Sec-${uniqueSuffix()}`, dateOfBirth: new Date('2025-01-01') },
    });
  }

  const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

  function syncOp(entityType: string, payload: Record<string, unknown>, entityId = randomUUID()) {
    return {
      idempotencyKey: `k-${uniqueSuffix()}`,
      clientOperationId: `o-${uniqueSuffix()}`,
      entityType,
      entityId,
      operationType: 'CREATE' as const,
      clientTimestamp: new Date().toISOString(),
      payload,
    };
  }

  describe('M1: care record times must be plausible', () => {
    it('rejects future-dated or very old care records on REST and sync', async () => {
      const tenant = await seedOrgCentreRoom('SecTimeRest');
      const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
      const kid = await child(tenant);
      const base = { type: 'SLEEP_CHECK' as const, childIds: [kid.id], defaultDetails: { position: 'BACK', breathingOk: true } };

      await expect(care.createGroupEvent(educator, { ...base, timestamp: minutesFromNow(120) })).rejects.toThrow(/future/i);
      await expect(care.createGroupEvent(educator, { ...base, timestamp: minutesFromNow(-60 * 24 * 4) })).rejects.toThrow(/too far in the past/i);
      await expect(care.createGroupEvent(educator, { ...base, timestamp: minutesFromNow(2) })).resolves.toBeDefined();

      await expect(
        sync.submit(educator, syncOp('CareRecord', { childId: kid.id, type: 'SLEEP_CHECK', timestamp: minutesFromNow(120), details: { position: 'BACK', breathingOk: true } })),
      ).rejects.toThrow(/future/i);
    });

    it('sleep status ignores records stamped in the future', async () => {
      const tenant = await seedOrgCentreRoom('SecSleepStatus');
      const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
      const kid = await child(tenant);
      await care.createGroupEvent(educator, { type: 'SLEEP', timestamp: minutesFromNow(-30), childIds: [kid.id], defaultDetails: { phase: 'START' } });
      // A row that slipped in with a bad clock (written directly, as an older client could have).
      await fixturePrisma.careRecord.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: kid.id, type: 'SLEEP_CHECK', timestamp: new Date(minutesFromNow(90)), details: { position: 'BACK', breathingOk: true, flagged: false }, groupEventId: randomUUID(), recordedByUserId: educator.userId },
      });
      const [status] = await care.roomSleepStatus(educator, tenant.roomId);
      expect(status).toMatchObject({ childId: kid.id, lastCheckAt: null, overdue: true });
    });
  });

  describe('L4: flagged sleep checks alert the centre admins', () => {
    it('front sleeping or a breathing concern raises an ACTION_REQUIRED alert with ids only, and is audited', async () => {
      const tenant = await seedOrgCentreRoom('SecFlagged');
      const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
      const admin = await user(tenant, 'CENTRE_ADMIN');
      const [k1, k2] = [await child(tenant), await child(tenant)];
      const result = await care.createGroupEvent(educator, {
        type: 'SLEEP_CHECK',
        timestamp: minutesFromNow(0),
        childIds: [k1.id, k2.id],
        defaultDetails: { position: 'BACK', breathingOk: true },
        exceptions: [{ childId: k2.id, details: { position: 'FRONT', breathingOk: true } }],
      });

      await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
      const alerts = await appPrisma.notificationQueueItem.findMany({ where: { recipientUserId: admin.userId } });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].priority).toBe('ACTION_REQUIRED');
      expect(alerts[0].payload).toEqual({ type: 'sleep_check_flagged', careRecordId: result.records.find((r) => r.childId === k2.id)?.id, childId: k2.id, roomId: tenant.roomId });

      const audit = await fixturePrisma.auditLogEntry.findFirstOrThrow({ where: { entityId: result.groupEventId } });
      expect(audit.metadata).toMatchObject({ flagged: [k2.id] });

      // The same rule applies to a check that arrives through offline sync.
      await sync.submit(educator, syncOp('CareRecord', { childId: k1.id, type: 'SLEEP_CHECK', timestamp: minutesFromNow(0), details: { position: 'BACK', breathingOk: false } }));
      expect(await appPrisma.notificationQueueItem.count({ where: { recipientUserId: admin.userId } })).toBe(2);
    });
  });

  describe('M2 / L1: checklist completion time and retries', () => {
    async function setup(label: string) {
      const tenant = await seedOrgCentreRoom(label);
      const admin = await user(tenant, 'CENTRE_ADMIN');
      const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
      const template = await checklists.createTemplate(admin, { name: 'Outdoor', items: ['Gate shut'] });
      const results = [{ itemId: template.items[0].id, result: 'PASS' }];
      return { tenant, admin, educator, template, results };
    }

    it('offline completions can be backdated only within 72 hours, and both times are kept', async () => {
      const { tenant, educator, template, results } = await setup('SecBackdate');
      const old = syncOp('ChecklistCompletion', { templateId: template.id, roomId: tenant.roomId, completedAt: minutesFromNow(-60 * 24 * 5), results });
      await expect(sync.submit(educator, old)).rejects.toThrow(/too far in the past/i);

      const recent = syncOp('ChecklistCompletion', { templateId: template.id, roomId: tenant.roomId, completedAt: minutesFromNow(-60 * 5), results });
      await sync.submit(educator, recent);
      const [entry] = await checklists.completions(educator, { roomId: tenant.roomId });
      expect(entry.id).toBe(recent.entityId);
      expect(new Date(entry.recordedAt).getTime() - new Date(entry.completedAt).getTime()).toBeGreaterThan(4 * 3600_000);

      const audit = await fixturePrisma.auditLogEntry.findFirstOrThrow({ where: { entityId: recent.entityId, action: 'checklist.complete' } });
      expect(audit.metadata).toMatchObject({ completedAt: entry.completedAt, lateByMinutes: expect.any(Number) });
    });

    it('a retry with someone else\'s completion id does not return their completion', async () => {
      const { tenant, admin, educator, template, results } = await setup('SecRetry');
      const id = randomUUID();
      await checklists.complete(educator, { id, templateId: template.id, roomId: tenant.roomId, results: [{ itemId: template.items[0].id, result: 'FAIL', note: 'private note' }] });
      await expect(checklists.complete(admin, { id, templateId: template.id, roomId: tenant.roomId, results: results as never })).rejects.toThrow(/already/i);
    });
  });

  describe('L5: sync payloads are validated', () => {
    it('rejects malformed checklist and care-record payloads with a 400, never matching a default template', async () => {
      const tenant = await seedOrgCentreRoom('SecSyncShape');
      const admin = await user(tenant, 'CENTRE_ADMIN');
      const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
      const kid = await child(tenant);
      const template = await checklists.createTemplate(admin, { name: 'Only one', items: ['x'] });

      const noTemplate = syncOp('ChecklistCompletion', { roomId: tenant.roomId, results: [{ itemId: template.items[0].id, result: 'PASS' }] });
      await expect(sync.submit(educator, noTemplate)).rejects.toThrow(/templateId/i);
      expect(await fixturePrisma.checklistCompletion.count({ where: { id: noTemplate.entityId } })).toBe(0);

      await expect(sync.submit(educator, syncOp('ChecklistCompletion', { templateId: template.id, roomId: tenant.roomId, results: 'nope' }))).rejects.toThrow(/results/i);
      await expect(sync.submit(educator, syncOp('CareRecord', { childId: kid.id, type: 'NOT_A_TYPE', timestamp: minutesFromNow(0) }))).rejects.toThrow(/type/i);
    });
  });

  describe('M3 / L3: announcements', () => {
    it('educators announce only to their own rooms and list only what concerns them', async () => {
      const tenant = await seedOrgCentreRoom('SecAnnounce');
      const otherRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Kindy ${uniqueSuffix()}` } });
      const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
      const admin = await user(tenant, 'CENTRE_ADMIN');

      await expect(messaging.send(educator, { scope: 'ROOM', roomId: otherRoom.id, body: 'Hats' })).rejects.toThrow(/assigned/i);
      await expect(messaging.send(educator, { scope: 'ROOM', roomId: tenant.roomId, body: 'Hats' })).resolves.toBeDefined();
      const kindy = await messaging.send(admin, { scope: 'ROOM', roomId: otherRoom.id, body: 'Kindy only' });
      const centre = await messaging.send(admin, { scope: 'CENTRE', roomId: otherRoom.id, body: 'Everyone' });
      expect(centre.roomId).toBeNull();

      const listed = (await messaging.list(educator)).map((m) => m.id);
      expect(listed).toContain(centre.id);
      expect(listed).not.toContain(kindy.id);
      expect((await messaging.list(admin)).map((m) => m.id)).toContain(kindy.id);

      await expect(messaging.send(admin, { scope: 'CENTRE', body: 'x'.repeat(4001) })).rejects.toThrow(/4000/);
    });
  });

  describe('M5 / L2: uploads', () => {
    async function setup(label: string) {
      const tenant = await seedOrgCentreRoom(label);
      const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
      const kid = await child(tenant);
      return { tenant, educator, kid };
    }
    const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();

    it('decodes only real JPEG, PNG or WebP bytes, whatever the declared type', async () => {
      const { educator, kid } = await setup('SecSvg');
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
      await expect(media.upload(educator, { buffer: svg, mimetype: 'image/png', size: svg.length }, { childIds: [kid.id] })).rejects.toThrow(/JPEG, PNG or WebP/);
      const real = await png();
      await expect(media.upload(educator, { buffer: real, mimetype: 'image/png', size: real.length }, { childIds: [kid.id] })).resolves.toBeDefined();
    });

    it('caps tagged children and validates the room', async () => {
      const { tenant, educator, kid } = await setup('SecTags');
      const buf = await png();
      const file = { buffer: buf, mimetype: 'image/png', size: buf.length };
      await expect(media.upload(educator, file, { childIds: Array.from({ length: 31 }, () => kid.id) })).rejects.toThrow(/30/);

      const elsewhere = await seedOrgCentreRoom('SecTagsOther');
      await expect(media.upload(educator, file, { childIds: [kid.id], roomId: elsewhere.roomId })).rejects.toThrow(/room/i);
      const unassigned = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `U ${uniqueSuffix()}` } });
      await expect(media.upload(educator, file, { childIds: [kid.id], roomId: unassigned.id })).rejects.toThrow(/room/i);
      await expect(media.upload(educator, file, { childIds: [kid.id], roomId: tenant.roomId })).resolves.toMatchObject({ roomId: tenant.roomId });
    });
  });
});
