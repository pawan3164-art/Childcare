import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { MessagingService } from '../../src/messaging/messaging.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext, uniqueSuffix } from '../test-utils';

describe('MessagingService: emergency broadcast is a separate high-priority path', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let messaging: MessagingService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const notifications = new NotificationsService(tenancy, new StubPushProvider());
    messaging = new MessagingService(tenancy, audit, notifications);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('an EMERGENCY message fans out URGENT notifications to every guardian in the centre', async () => {
    const tenant = await seedOrgCentreRoom('MsgEmergency');
    const admin = await fixturePrisma.user.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        email: `admin-${uniqueSuffix()}@example.test`,
        passwordHash: 'x',
        role: 'CENTRE_ADMIN',
        firstName: 'A',
        lastName: 'D',
      },
    });
    const guardianIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const child = await fixturePrisma.child.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: `C${i}`, lastName: `M-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
      });
      const guardian = await fixturePrisma.user.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `g${i}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'G', lastName: `${i}` },
      });
      await fixturePrisma.guardianChildRelationship.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT' },
      });
      guardianIds.push(guardian.id);
    }

    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN' };
    await messaging.send(adminUser, { scope: 'EMERGENCY', body: 'Centre evacuating due to a fire alarm' });

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    for (const guardianId of guardianIds) {
      const notifs = await appPrisma.notificationQueueItem.findMany({ where: { recipientUserId: guardianId, priority: 'URGENT' } });
      expect(notifs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('a ROOM-scope message does not trigger a notification fan-out (Stage 2 scope)', async () => {
    const tenant = await seedOrgCentreRoom('MsgRoom');
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN' };

    const message = await messaging.send(adminUser, { scope: 'ROOM', roomId: tenant.roomId, body: 'Reminder: excursion forms due Friday' });
    expect(message.scope).toBe('ROOM');

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    const notifs = await appPrisma.notificationQueueItem.findMany({ where: { orgId: tenant.orgId } });
    expect(notifs).toHaveLength(0);
  });

  it('a non-staff user cannot send a message', async () => {
    const tenant = await seedOrgCentreRoom('MsgDenied');
    const parent = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `parent-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'P', lastName: 'P' },
    });
    const parentUser: RequestUser = { userId: parent.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT' };

    await expect(messaging.send(parentUser, { scope: 'ROOM', body: 'hi' })).rejects.toThrow();
  });
});
