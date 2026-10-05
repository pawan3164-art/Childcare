import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StubPushProvider } from '../../src/notifications/providers/stub-push.provider';
import { RoomsService } from '../../src/centre-admin/rooms.service';
import { CentreSettingsService } from '../../src/centre-admin/centre-settings.service';
import { CareRecordsService } from '../../src/care-records/care-records.service';
import { CareAlertsService } from '../../src/care-records/care-alerts.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * Decisions of 2026-10-05: learning is published by the room leader (OI-23),
 * so admins need to say who leads each room; and the sleep-check interval is
 * a per-centre setting (OI-20), default 10 minutes.
 */
describe('Room leaders and centre settings', () => {
  let prismaService: PrismaService;
  let rooms: RoomsService;
  let settings: CentreSettingsService;
  let care: CareRecordsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    rooms = new RoomsService(tenancy, audit);
    settings = new CentreSettingsService(tenancy, audit);
    care = new CareRecordsService(tenancy, audit, authorization, new CareAlertsService(tenancy, new NotificationsService(tenancy, new StubPushProvider())));
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

  it('admins see a room\'s staff and choose its leader; educators cannot', async () => {
    const tenant = await seedOrgCentreRoom('Leads');
    const admin = await user(tenant, 'CENTRE_ADMIN');
    const e1 = await user(tenant, 'EDUCATOR', tenant.roomId);
    const e2 = await user(tenant, 'EDUCATOR', tenant.roomId);

    const staff = await rooms.staff(admin, tenant.roomId);
    expect(staff.map((s) => s.userId).sort()).toEqual([e1.userId, e2.userId].sort());
    expect(staff.every((s) => s.isLead === false)).toBe(true);

    await rooms.setLead(admin, tenant.roomId, e1.userId, true);
    expect((await rooms.staff(admin, tenant.roomId)).find((s) => s.userId === e1.userId)?.isLead).toBe(true);
    expect(await fixturePrisma.auditLogEntry.count({ where: { action: 'room.lead.set', entityId: tenant.roomId } })).toBe(1);

    await expect(rooms.setLead(e2, tenant.roomId, e2.userId, true)).rejects.toThrow();
    // Only someone assigned to the room can lead it.
    const outsider = await user(tenant, 'EDUCATOR');
    await expect(rooms.setLead(admin, tenant.roomId, outsider.userId, true)).rejects.toThrow(/assigned/i);
  });

  it('the sleep-check interval is a per-centre setting that drives sleep status', async () => {
    const tenant = await seedOrgCentreRoom('SleepSetting');
    const admin = await user(tenant, 'CENTRE_ADMIN');
    const educator = await user(tenant, 'EDUCATOR', tenant.roomId);

    expect(await settings.get(educator)).toMatchObject({ sleepCheckIntervalMinutes: 10 });
    await expect(settings.update(educator, { sleepCheckIntervalMinutes: 15 })).rejects.toThrow();
    await expect(settings.update(admin, { sleepCheckIntervalMinutes: 2 })).rejects.toThrow(/between/i);
    await expect(settings.update(admin, { sleepCheckIntervalMinutes: 45 })).rejects.toThrow(/between/i);
    await expect(settings.update(admin, { sleepCheckIntervalMinutes: 15 })).resolves.toMatchObject({ sleepCheckIntervalMinutes: 15 });

    const kid = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'S', lastName: `S-${uniqueSuffix()}`, dateOfBirth: new Date('2025-01-01') },
    });
    const asleep = new Date(Date.now() - 12 * 60_000);
    await care.createGroupEvent(educator, { type: 'SLEEP', timestamp: asleep.toISOString(), childIds: [kid.id], defaultDetails: { phase: 'START' } });
    const [status] = await care.roomSleepStatus(educator, tenant.roomId);
    // 12 minutes asleep with a 15-minute interval: not overdue yet.
    expect(status).toMatchObject({ overdue: false, intervalMinutes: 15 });
    expect(Math.abs(new Date(status.nextCheckDueAt).getTime() - (asleep.getTime() + 15 * 60_000))).toBeLessThan(2000);
  });
});
