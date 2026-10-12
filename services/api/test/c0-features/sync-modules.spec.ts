import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SyncService } from '../../src/sync/sync.service';
import { FeaturesService } from '../../src/features/features.service';
import { ChecklistsService } from '../../src/checklists/checklists.service';
import { CareAlertsService } from '../../src/care-records/care-alerts.service';
import { LearningService } from '../../src/learning/learning.service';
import { MediaService } from '../../src/media/media.service';
import { InMemoryObjectStorage } from '../../src/media/storage/in-memory-object-storage';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { disconnectAll, fixturePrisma, uniqueSuffix } from '../test-utils';
import { buildFeatures, db, setupOrg } from './helpers';

/** OI-37: offline sync must refuse operations for a module the centre has switched off, like the REST path does. */
describe('C0 modules: offline sync respects switched-off modules', () => {
  let h: Awaited<ReturnType<typeof buildFeatures>>;
  let sync: SyncService;

  beforeAll(async () => {
    h = await buildFeatures();
    const { tenancy, audit, authorization } = h;
    const notifications = new NotificationsService(tenancy, new StubPushProvider());
    sync = new SyncService(
      tenancy, authorization, audit,
      new ChecklistsService(tenancy, audit, authorization, notifications),
      new CareAlertsService(tenancy, notifications),
      new LearningService(tenancy, audit, authorization, new MediaService(tenancy, audit, authorization, new InMemoryObjectStorage()), notifications),
      h.features as FeaturesService,
    );
  });
  afterAll(async () => {
    await h.prismaService.onModuleDestroy();
    await disconnectAll();
  });

  const op = (entityType: string, payload: Record<string, unknown>, entityId: string = randomUUID()) => ({
    idempotencyKey: `k-${uniqueSuffix()}`, clientOperationId: `o-${uniqueSuffix()}`, entityType, entityId,
    operationType: 'CREATE' as const, clientTimestamp: new Date().toISOString(), payload,
  });

  async function switchOff(f: Awaited<ReturnType<typeof setupOrg>>, key: string) {
    await h.features.setEnabled(f.admin, key, false);
  }

  it('refuses a learning draft when learning is switched off, and stores nothing', async () => {
    const f = await setupOrg('sync-mod-learning');
    await switchOff(f, 'learning');
    const id = randomUUID();
    const o = op('LearningRecordDraft', { roomId: f.tenant.roomId, kind: 'OBSERVATION', title: 'x', observation: 'y', outcomes: [], childIds: [] }, id);
    await expect(sync.submit(f.educator, o)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.syncOperation.count({ where: { idempotencyKey: o.idempotencyKey } })).toBe(0);
    expect(await db.learningRecord.count({ where: { id } })).toBe(0);
  });

  it('refuses a checklist completion when checklists are switched off, even as a replay of an unsaved op', async () => {
    const f = await setupOrg('sync-mod-checklist');
    await switchOff(f, 'checklists');
    const o = op('ChecklistCompletion', { templateId: randomUUID(), roomId: f.tenant.roomId, completedAt: new Date().toISOString(), results: [] });
    await expect(sync.submit(f.educator, o)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await db.syncOperation.count({ where: { idempotencyKey: o.idempotencyKey } })).toBe(0);
  });

  it('safety records still sync with every optional module off (attendance, care records)', async () => {
    const f = await setupOrg('sync-mod-core');
    for (const key of ['learning', 'checklists', 'billing', 'forms', 'calendar', 'menus', 'family_requests']) await switchOff(f, key);
    const child = await db.child.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, roomId: f.tenant.roomId, firstName: 'K', lastName: `S-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') } });
    await fixturePrisma.staffRoomAssignment.create({ data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, userId: f.educator.userId, roomId: f.tenant.roomId, startDate: new Date('2026-01-01') } });
    const applied = await sync.submit(f.educator, op('AttendanceEvent', { childId: child.id, eventType: 'SIGN_IN', method: 'EDUCATOR', timestamp: new Date().toISOString() }));
    expect(applied.status).toBe('APPLIED');
  });

  it('works again once the module is switched back on', async () => {
    const f = await setupOrg('sync-mod-back');
    await switchOff(f, 'checklists');
    const o = op('ChecklistCompletion', { templateId: randomUUID(), roomId: f.tenant.roomId, completedAt: new Date().toISOString(), results: [] });
    await expect(sync.submit(f.educator, o)).rejects.toBeInstanceOf(ForbiddenException);
    await h.features.setEnabled(f.admin, 'checklists', true);
    // It now fails on the bogus template or room access, but no longer because the module is off.
    await expect(sync.submit(f.educator, o)).rejects.toThrow(/^(?!.*switched off)/);
  });
});
