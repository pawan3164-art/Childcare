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

describe('SyncService: exactly-once idempotency', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let sync: SyncService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    sync = new SyncService(tenancy, authorization, audit, new ChecklistsService(tenancy, audit, authorization, new NotificationsService(tenancy, new StubPushProvider())), new CareAlertsService(tenancy, new NotificationsService(tenancy, new StubPushProvider())));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('submitting the same idempotencyKey twice results in exactly one stored operation', async () => {
    const tenant = await seedOrgCentreRoom('SyncIdem');
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

    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    const idempotencyKey = `key-${uniqueSuffix()}`;
    const dto = {
      idempotencyKey,
      clientOperationId: 'client-op-1',
      entityType: 'TestEntity', // not a built domain table — isolates idempotency mechanics from conflict-rule logic, which has its own test file
      entityId: 'some-test-entity-id',
      operationType: 'CREATE' as const,
      payload: { note: 'morning tea' },
      clientTimestamp: new Date().toISOString(),
    };

    const first = await sync.submit(user, dto);
    const second = await sync.submit(user, dto); // simulates a flaky-network retry resubmission

    expect(second.id).toBe(first.id);

    const stored = await fixturePrisma.syncOperation.findMany({ where: { idempotencyKey } });
    expect(stored).toHaveLength(1);
  });

  it('two different idempotency keys for the same entity both get stored', async () => {
    const tenant = await seedOrgCentreRoom('SyncDistinct');
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
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    const entityId = `entity-${uniqueSuffix()}`;

    const base = {
      clientOperationId: 'client-op',
      entityType: 'TestEntity',
      entityId,
      operationType: 'CREATE' as const,
      payload: {},
      clientTimestamp: new Date().toISOString(),
    };

    await sync.submit(user, { ...base, idempotencyKey: `a-${uniqueSuffix()}` });
    await sync.submit(user, { ...base, idempotencyKey: `b-${uniqueSuffix()}` });

    const stored = await fixturePrisma.syncOperation.findMany({ where: { entityId } });
    expect(stored).toHaveLength(2);
  });
});
