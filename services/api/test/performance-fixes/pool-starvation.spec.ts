import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { CareRecordsService } from '../../src/care-records/care-records.service';
import { SyncService } from '../../src/sync/sync.service';
import { ChecklistsService } from '../../src/checklists/checklists.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { assignToRoom, asRequestUser, makeChild, makeUser, seedFamily } from '../security-fixes/security-fixtures';

/**
 * Stage 5 load test (tests/performance, 2026-10-04): group care logging at
 * 20 concurrent requests failed 97.6% and 20-device sync flushes failed 82.5%
 * with "Unable to start a transaction in the given time". Each request held
 * one pooled connection for its tenant transaction, then asked the pool for a
 * second one (a nested canAccessChild transaction per child). Once concurrent
 * requests >= pool size, every request waits on a connection another one
 * holds until Prisma's maxWait expires.
 *
 * Reproduced deterministically here with a 2-connection pool: with no nested
 * transactions, concurrent requests just queue and all succeed.
 */
describe('Connection pool: request paths never hold one connection while waiting for another', () => {
  let smallPool: PrismaClient;
  let careRecords: CareRecordsService;
  let sync: SyncService;

  beforeAll(async () => {
    const base = process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL ?? '';
    smallPool = new PrismaClient({
      datasourceUrl: `${base}${base.includes('?') ? '&' : '?'}connection_limit=2&pool_timeout=20`,
    });
    await smallPool.$connect();
    const tenancy = new TenancyService(smallPool as unknown as PrismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    careRecords = new CareRecordsService(tenancy, audit, authorization);
    sync = new SyncService(tenancy, authorization, audit, new ChecklistsService(tenancy, audit, authorization, new NotificationsService(tenancy, new StubPushProvider())));
  });

  afterAll(async () => {
    await smallPool.$disconnect();
    await disconnectAll();
  });

  async function roomOfChildren(label: string, count: number) {
    const fam = await seedFamily(label);
    const kids = [fam.child];
    for (let i = 1; i < count; i++) kids.push(await makeChild(fam.tenant));
    return { ...fam, childIds: kids.map((k) => k.id) };
  }

  it('serves 6 concurrent group care logs on a 2-connection pool', async () => {
    const fam = await roomOfChildren('pool-group', 4);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        careRecords.createGroupEvent(fam.educatorUser, {
          type: 'MEAL',
          timestamp: new Date().toISOString(),
          childIds: fam.childIds,
        }),
      ),
    );

    const failures = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
    expect(failures).toEqual([]);
    for (const r of results) {
      if (r.status === 'fulfilled') expect(r.value.records).toHaveLength(4);
    }
  }, 30000);

  it('still skips children the educator cannot access when checked in a batch', async () => {
    const fam = await roomOfChildren('pool-group-skip', 2);
    const otherRoom = await fixturePrisma.room.create({
      data: { orgId: fam.tenant.orgId, centreId: fam.tenant.centreId, name: 'Other room' },
    });
    const outsider = await makeChild(fam.tenant, otherRoom.id);
    const missingId = uuidv4();

    const result = await careRecords.createGroupEvent(fam.educatorUser, {
      type: 'SLEEP',
      timestamp: new Date().toISOString(),
      childIds: [...fam.childIds, outsider.id, missingId],
    });

    expect(result.records.map((r) => r.childId).sort()).toEqual([...fam.childIds].sort());
    expect(result.skipped.sort()).toEqual([outsider.id, missingId].sort());
  }, 30000);

  it('serves 6 concurrent offline sync submissions on a 2-connection pool', async () => {
    const fam = await roomOfChildren('pool-sync', 2);
    const second = await makeUser('EDUCATOR', fam.tenant.orgId, fam.tenant.centreId);
    await assignToRoom(fam.tenant, second.id);
    const users = [fam.educatorUser, asRequestUser(second)];

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => {
        const ts = new Date(Date.now() - i * 1000).toISOString();
        const isAttendance = i % 2 === 0;
        return sync.submit(users[i % 2], {
          idempotencyKey: uuidv4(),
          clientOperationId: uuidv4(),
          entityType: isAttendance ? 'AttendanceEvent' : 'CareRecord',
          entityId: uuidv4(),
          operationType: 'CREATE',
          clientTimestamp: ts,
          payload: isAttendance
            ? { childId: fam.childIds[i % 2], eventType: 'SIGN_IN', method: 'EDUCATOR', timestamp: ts }
            : { childId: fam.childIds[i % 2], type: 'MEAL', timestamp: ts, note: 'offline' },
        });
      }),
    );

    const failures = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
    expect(failures).toEqual([]);
    for (const r of results) {
      if (r.status === 'fulfilled') expect(r.value.status).toBe('APPLIED');
    }
  }, 30000);
});
