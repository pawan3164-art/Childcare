import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { ChildrenService } from '../../src/centre-admin/children.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * Found in the U0 visual review: a child signed in yesterday and never signed
 * out showed as "Signed in" today on the roster, dashboard count and
 * attendance page. Status must come from today's events (centre-local day);
 * an unclosed sign-in from a previous day is flagged separately.
 */
describe('ChildrenService.list: attendance status is scoped to the centre\'s today', () => {
  let prismaService: PrismaService;
  let children: ChildrenService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    children = new ChildrenService(tenancy, new AuditService(tenancy));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('reports today\'s status per child and flags yesterday\'s unclosed sign-in', async () => {
    const tenant = await seedOrgCentreRoom('ListToday');
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const mk = (firstName: string) =>
      fixturePrisma.child.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName, lastName: `Today-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
      });
    const stale = await mk('Stale');
    const present = await mk('Present');
    const gone = await mk('Gone');
    const event = (childId: string, eventType: 'SIGN_IN' | 'SIGN_OUT', msAgo: number) =>
      fixturePrisma.attendanceEvent.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, childId, eventType, method: 'KIOSK', timestamp: new Date(Date.now() - msAgo) },
      });
    const HOUR = 60 * 60 * 1000;
    await event(stale.id, 'SIGN_IN', 30 * HOUR);
    await event(present.id, 'SIGN_IN', 30 * HOUR);
    await event(present.id, 'SIGN_IN', 1000);
    await event(gone.id, 'SIGN_IN', 2000);
    await event(gone.id, 'SIGN_OUT', 1000);

    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 's' };
    const list = await children.list(adminUser, tenant.roomId);
    const byId = new Map(list.map((c) => [c.id, c]));

    expect(byId.get(stale.id)).toMatchObject({ attendanceStatus: 'NO_EVENTS_TODAY', previousDayNotSignedOut: true });
    expect(byId.get(present.id)).toMatchObject({ attendanceStatus: 'SIGNED_IN', previousDayNotSignedOut: true });
    expect(byId.get(gone.id)).toMatchObject({ attendanceStatus: 'SIGNED_OUT', previousDayNotSignedOut: false });
  });
});
