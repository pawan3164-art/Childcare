import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { SyncService } from '../../src/sync/sync.service';
import { ChecklistsService } from '../../src/checklists/checklists.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';
import { CareAlertsService } from '../../src/care-records/care-alerts.service';

/**
 * Delivery Plan §6.1: "Explicit conflict rule per entity." For
 * append-only entities (attendance, care records), the rule under test is
 * that a sync operation claiming to UPDATE or DELETE one is rejected as a
 * conflict rather than silently mutating history, while a CREATE replay is
 * applied idempotently via the client-generated entityId.
 */
describe('SyncService: per-entity conflict rules', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let authorization: AuthorizationService;
  let sync: SyncService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    sync = new SyncService(tenancy, authorization, audit, new ChecklistsService(tenancy, audit, authorization, new NotificationsService(tenancy, new StubPushProvider())), new CareAlertsService(tenancy, new NotificationsService(tenancy, new StubPushProvider())));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function makeEducatorInRoom(tenant: { orgId: string; centreId: string; roomId: string }) {
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
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        userId: educator.id,
        roomId: tenant.roomId,
        startDate: new Date('2026-01-01'),
      },
    });
    return educator;
  }

  it('applies a CREATE AttendanceEvent sync operation to the real attendance table, using the client-generated id', async () => {
    const tenant = await seedOrgCentreRoom('SyncAttendCreate');
    const educator = await makeEducatorInRoom(tenant);
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'Syncy',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });

    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    const clientEntityId = `client-generated-${uniqueSuffix()}`;

    const op = await sync.submit(user, {
      idempotencyKey: `idem-${uniqueSuffix()}`,
      clientOperationId: 'c1',
      entityType: 'AttendanceEvent',
      entityId: clientEntityId,
      operationType: 'CREATE',
      payload: { childId: child.id, eventType: 'SIGN_IN', method: 'EDUCATOR', timestamp: new Date().toISOString() },
      clientTimestamp: new Date().toISOString(),
    });

    expect(op.status).toBe('APPLIED');
    const row = await fixturePrisma.attendanceEvent.findUnique({ where: { id: clientEntityId } });
    expect(row).not.toBeNull();
    expect(row?.childId).toBe(child.id);
  });

  it('rejects an UPDATE sync operation against an append-only AttendanceEvent as a conflict, and does not touch the domain table', async () => {
    const tenant = await seedOrgCentreRoom('SyncAttendUpdate');
    const educator = await makeEducatorInRoom(tenant);
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'Syncy2',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    const entityId = `entity-${uniqueSuffix()}`;

    const op = await sync.submit(user, {
      idempotencyKey: `idem-${uniqueSuffix()}`,
      clientOperationId: 'c2',
      entityType: 'AttendanceEvent',
      entityId,
      operationType: 'UPDATE',
      payload: { childId: child.id, eventType: 'SIGN_OUT', method: 'EDUCATOR', timestamp: new Date().toISOString() },
      clientTimestamp: new Date().toISOString(),
    });

    expect(op.status).toBe('CONFLICT');
    expect(op.conflictReason).toBe('append_only_entity_disallows_update_delete');

    const row = await fixturePrisma.attendanceEvent.findUnique({ where: { id: entityId } });
    expect(row).toBeNull();
  });

  it('rejects a CREATE CareRecord sync operation for a child the educator cannot access', async () => {
    const tenant = await seedOrgCentreRoom('SyncCareDenied');
    const educator = await makeEducatorInRoom(tenant); // assigned to tenant.roomId only

    // Same org/centre, but a different room the educator is NOT assigned to —
    // this is a room-assignment authorization case, not an RLS/cross-org case.
    const otherRoom = await fixturePrisma.room.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Other Room ${uniqueSuffix()}` },
    });
    const childInOtherRoom = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: otherRoom.id,
        firstName: 'Unassigned',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });

    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };

    await expect(
      sync.submit(user, {
        idempotencyKey: `idem-${uniqueSuffix()}`,
        clientOperationId: 'c3',
        entityType: 'CareRecord',
        entityId: `entity-${uniqueSuffix()}`,
        operationType: 'CREATE',
        payload: { childId: childInOtherRoom.id, type: 'MEAL', timestamp: new Date().toISOString() },
        clientTimestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });
});
