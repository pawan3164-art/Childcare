import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { MessagingService } from '../../src/messaging/messaging.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';
import { AuthorizationService } from '../../src/authorization/authorization.service';

describe('MessagingService: announcements', () => {
  let prismaService: PrismaService;
  let messaging: MessagingService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    messaging = new MessagingService(tenancy, new AuditService(tenancy), new NotificationsService(tenancy, new StubPushProvider()), new AuthorizationService(tenancy, new AuditService(tenancy)));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function staff(tenant: { orgId: string; centreId: string }, role: 'CENTRE_ADMIN' | 'PARENT' = 'CENTRE_ADMIN'): Promise<RequestUser> {
    const u = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: 'Alex', lastName: 'D' },
    });
    return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
  }

  it('a ROOM announcement must name a room in the sender\'s centre', async () => {
    const tenant = await seedOrgCentreRoom('AnnRoom');
    const otherCentre = await seedOrgCentreRoom('AnnRoomOther');
    const admin = await staff(tenant);

    await expect(messaging.send(admin, { scope: 'ROOM', body: 'Hats tomorrow' })).rejects.toThrow(/room/i);
    await expect(messaging.send(admin, { scope: 'ROOM', roomId: otherCentre.roomId, body: 'Hats tomorrow' })).rejects.toThrow(/room/i);
    await expect(messaging.send(admin, { scope: 'ROOM', roomId: tenant.roomId, body: 'Hats tomorrow' })).resolves.toMatchObject({ scope: 'ROOM' });
  });

  it('staff can list their centre\'s announcements with acknowledgement counts; parents cannot', async () => {
    const tenant = await seedOrgCentreRoom('AnnList');
    const admin = await staff(tenant);
    const parent = await staff(tenant, 'PARENT');
    const sent = await messaging.send(admin, { scope: 'CENTRE', body: 'Closed Monday' });
    await messaging.acknowledge(parent, sent.id);

    const list = await messaging.list(admin);
    expect(list.find((m) => m.id === sent.id)).toMatchObject({ body: 'Closed Monday', scope: 'CENTRE', acknowledgedCount: 1, author: { firstName: 'Alex' } });
    await expect(messaging.list(parent)).rejects.toThrow();
  });
});
