import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { ChecklistsService } from '../../src/checklists/checklists.service';
import { SyncService } from '../../src/sync/sync.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext, uniqueSuffix } from '../test-utils';
import { CareAlertsService } from '../../src/care-records/care-alerts.service';
import { LearningService } from '../../src/learning/learning.service';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';

/**
 * U1 room checklists (BRD v2.2 CMP-003, CMP-009): configurable per centre and
 * room, completed by educators (including offline via sync), time-stamped and
 * attributed, immutable once submitted, and a failed item raises an exception
 * to the responsible person. Until the responsible-person log (CMP-004) is
 * built, the centre's admins are the responsible people (working default).
 */
describe('ChecklistsService: U1 room checklists', () => {
  let prismaService: PrismaService;
  let checklists: ChecklistsService;
  let sync: SyncService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    checklists = new ChecklistsService(tenancy, audit, authorization, new NotificationsService(tenancy, new StubPushProvider()));
    sync = new SyncService(tenancy, authorization, audit, checklists, new CareAlertsService(tenancy, new NotificationsService(tenancy, new StubPushProvider())), new LearningService(tenancy, audit, authorization, new MediaService(tenancy, audit, authorization, new InMemoryObjectStorage()), new NotificationsService(tenancy, new StubPushProvider())));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function user(tenant: { orgId: string; centreId: string }, role: RequestUser['role'], roomId?: string): Promise<RequestUser> {
    const u = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: role, lastName: 'T' },
    });
    if (roomId) {
      await fixturePrisma.staffRoomAssignment.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: u.id, roomId, startDate: new Date('2026-01-01') },
      });
    }
    return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
  }

  async function setup(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const admin = await user(tenant, 'CENTRE_ADMIN');
    const educator = await user(tenant, 'EDUCATOR', tenant.roomId);
    const roomTemplate = await checklists.createTemplate(admin, { name: 'Sleep room', roomId: tenant.roomId, items: ['Cots clear of soft toys', 'Room temperature 16-20°C'] });
    const centreTemplate = await checklists.createTemplate(admin, { name: 'Opening', items: ['Gates locked'] });
    return { tenant, admin, educator, roomTemplate, centreTemplate };
  }

  function allPass(template: { id: string; items: { id: string }[] }) {
    return template.items.map((i) => ({ itemId: i.id, result: 'PASS' as const }));
  }

  it('admins configure templates for a room or the whole centre; educators see both for their room; others cannot', async () => {
    const { tenant, admin, educator, roomTemplate, centreTemplate } = await setup('ChkTemplates');
    const parent = await user(tenant, 'PARENT');

    expect(roomTemplate.items).toHaveLength(2);
    expect(roomTemplate.items[0]).toMatchObject({ id: expect.any(String), label: 'Cots clear of soft toys' });

    const forRoom = await checklists.roomChecklists(educator, tenant.roomId);
    expect(forRoom.map((c) => c.template.id).sort()).toEqual([roomTemplate.id, centreTemplate.id].sort());
    expect(forRoom.every((c) => c.lastCompletion === null)).toBe(true);

    await expect(checklists.createTemplate(educator, { name: 'Nope', items: ['x'] })).rejects.toThrow();
    await expect(checklists.roomChecklists(parent, tenant.roomId)).rejects.toThrow();
    await expect(checklists.createTemplate(admin, { name: 'Empty', items: [] })).rejects.toThrow(/item/i);

    const other = await seedOrgCentreRoom('ChkTemplatesOther');
    await expect(checklists.createTemplate(admin, { name: 'Elsewhere', roomId: other.roomId, items: ['x'] })).rejects.toThrow(/room/i);
  });

  it('an educator completes a checklist: every item answered, a failure needs a note, time-stamped and attributed', async () => {
    const { tenant, educator, roomTemplate } = await setup('ChkComplete');

    await expect(
      checklists.complete(educator, { id: randomUUID(), templateId: roomTemplate.id, roomId: tenant.roomId, results: [{ itemId: roomTemplate.items[0].id, result: 'PASS' }] }),
    ).rejects.toThrow(/every item/i);
    await expect(
      checklists.complete(educator, {
        id: randomUUID(),
        templateId: roomTemplate.id,
        roomId: tenant.roomId,
        results: [
          { itemId: roomTemplate.items[0].id, result: 'FAIL' },
          { itemId: roomTemplate.items[1].id, result: 'PASS' },
        ],
      }),
    ).rejects.toThrow(/note/i);

    const done = await checklists.complete(educator, { id: randomUUID(), templateId: roomTemplate.id, roomId: tenant.roomId, results: allPass(roomTemplate) });
    expect(done).toMatchObject({ completedByUserId: educator.userId, failedCount: 0, templateName: 'Sleep room' });
    expect(done.completedAt).toBeInstanceOf(Date);

    const forRoom = await checklists.roomChecklists(educator, tenant.roomId);
    expect(forRoom.find((c) => c.template.id === roomTemplate.id)?.lastCompletion).toMatchObject({ id: done.id, failedCount: 0, completedBy: { firstName: 'EDUCATOR' } });
  });

  it('a failed item alerts the centre admins (ids only, no note text) and is audited', async () => {
    const { tenant, admin, educator, roomTemplate } = await setup('ChkFail');
    const done = await checklists.complete(educator, {
      id: randomUUID(),
      templateId: roomTemplate.id,
      roomId: tenant.roomId,
      results: [
        { itemId: roomTemplate.items[0].id, result: 'FAIL', note: 'Blanket in cot 3 secret-note' },
        { itemId: roomTemplate.items[1].id, result: 'NA' },
      ],
    });
    expect(done.failedCount).toBe(1);

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    const alerts = await appPrisma.notificationQueueItem.findMany({ where: { recipientUserId: admin.userId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].priority).toBe('ACTION_REQUIRED');
    expect(alerts[0].payload).toMatchObject({ type: 'checklist_failure', completionId: done.id, roomId: tenant.roomId, failedCount: 1 });
    expect(JSON.stringify(alerts[0].payload)).not.toMatch(/secret-note/);

    const audits = await fixturePrisma.auditLogEntry.findMany({ where: { entityId: done.id } });
    expect(audits.map((a) => a.action)).toContain('checklist.complete');
    expect(JSON.stringify(audits)).not.toMatch(/secret-note/);
  });

  it('educators can only complete checklists for their own rooms, using a template that applies to that room', async () => {
    const { tenant, admin, roomTemplate } = await setup('ChkRooms');
    const otherRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Other ${uniqueSuffix()}` } });
    const otherEducator = await user(tenant, 'EDUCATOR', otherRoom.id);

    await expect(
      checklists.complete(otherEducator, { id: randomUUID(), templateId: roomTemplate.id, roomId: tenant.roomId, results: allPass(roomTemplate) }),
    ).rejects.toThrow();
    // The sleep-room template belongs to the first room, so it can't be filed against another room.
    await expect(
      checklists.complete(otherEducator, { id: randomUUID(), templateId: roomTemplate.id, roomId: otherRoom.id, results: allPass(roomTemplate) }),
    ).rejects.toThrow(/room/i);
    // Admins can complete for any room in their centre.
    await expect(
      checklists.complete(admin, { id: randomUUID(), templateId: roomTemplate.id, roomId: tenant.roomId, results: allPass(roomTemplate) }),
    ).resolves.toMatchObject({ failedCount: 0 });
  });

  it('a resubmitted completion (same client id) is stored and alerted once', async () => {
    const { tenant, admin, educator, roomTemplate } = await setup('ChkIdem');
    const input = {
      id: randomUUID(),
      templateId: roomTemplate.id,
      roomId: tenant.roomId,
      results: [
        { itemId: roomTemplate.items[0].id, result: 'FAIL' as const, note: 'x' },
        { itemId: roomTemplate.items[1].id, result: 'PASS' as const },
      ],
    };
    const first = await checklists.complete(educator, input);
    const second = await checklists.complete(educator, input);
    expect(second.id).toBe(first.id);
    expect(await fixturePrisma.checklistCompletion.count({ where: { id: input.id } })).toBe(1);
    expect(await fixturePrisma.notificationQueueItem.count({ where: { recipientUserId: admin.userId } })).toBe(1);
  });

  it('completions are immutable; archiving a template keeps its history with the original item labels', async () => {
    const { tenant, admin, educator, roomTemplate } = await setup('ChkImmutable');
    const done = await checklists.complete(educator, { id: randomUUID(), templateId: roomTemplate.id, roomId: tenant.roomId, results: allPass(roomTemplate) });

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    await expect(appPrisma.checklistCompletion.update({ where: { id: done.id }, data: { failedCount: 5 } })).rejects.toThrow();
    await expect(appPrisma.checklistCompletion.delete({ where: { id: done.id } })).rejects.toThrow();

    await checklists.archiveTemplate(admin, roomTemplate.id);
    const forRoom = await checklists.roomChecklists(educator, tenant.roomId);
    expect(forRoom.find((c) => c.template.id === roomTemplate.id)).toBeUndefined();

    const history = await checklists.completions(admin, { roomId: tenant.roomId });
    const entry = history.find((h) => h.id === done.id);
    expect(entry?.results.map((r) => r.label)).toEqual(['Cots clear of soft toys', 'Room temperature 16-20°C']);
  });

  it('a checklist completed offline is applied through sync, alerts on failure, and replays idempotently', async () => {
    const { tenant, admin, educator, roomTemplate } = await setup('ChkSync');
    const entityId = randomUUID();
    const op = {
      idempotencyKey: `idem-${uniqueSuffix()}`,
      clientOperationId: `op-${uniqueSuffix()}`,
      entityType: 'ChecklistCompletion',
      entityId,
      operationType: 'CREATE' as const,
      clientTimestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      payload: {
        templateId: roomTemplate.id,
        roomId: tenant.roomId,
        completedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        results: [
          { itemId: roomTemplate.items[0].id, result: 'FAIL', note: 'offline note' },
          { itemId: roomTemplate.items[1].id, result: 'PASS' },
        ],
      },
    };

    const applied = await sync.submit(educator, op);
    expect(applied.status).toBe('APPLIED');
    const row = await fixturePrisma.checklistCompletion.findUniqueOrThrow({ where: { id: entityId } });
    expect(row.failedCount).toBe(1);
    // Offline completions keep the time the educator actually did the check.
    expect(row.completedAt.toISOString()).toBe(op.payload.completedAt);

    await sync.submit(educator, op);
    expect(await fixturePrisma.checklistCompletion.count({ where: { id: entityId } })).toBe(1);
    expect(await fixturePrisma.notificationQueueItem.count({ where: { recipientUserId: admin.userId } })).toBe(1);

    const audits = await fixturePrisma.auditLogEntry.findMany({ where: { entityId, action: 'checklist.complete' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ viaOfflineSync: true, failedCount: 1 });

    const update = await sync.submit(educator, { ...op, idempotencyKey: `idem-${uniqueSuffix()}`, operationType: 'UPDATE' });
    expect(update.status).toBe('CONFLICT');
  });
});
