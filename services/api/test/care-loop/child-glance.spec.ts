import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { AttendanceService } from '../../src/attendance/attendance.service';
import { CareRecordsService } from '../../src/care-records/care-records.service';
import { ChildGlanceService } from '../../src/dashboard/child-glance.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

describe('ChildGlanceService: parent "Child at a Glance" aggregation (BRD §6.1)', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let attendance: AttendanceService;
  let careRecords: CareRecordsService;
  let glance: ChildGlanceService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    attendance = new AttendanceService(tenancy, audit, authorization);
    careRecords = new CareRecordsService(tenancy, audit, authorization);
    glance = new ChildGlanceService(tenancy, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  it('shows SIGNED_IN status and today\'s care records once an educator has logged them', async () => {
    const tenant = await seedOrgCentreRoom('Glance');
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
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'Glancy',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
    const guardian = await fixturePrisma.user.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        email: `guardian-${uniqueSuffix()}@example.test`,
        passwordHash: 'x',
        role: 'PARENT',
        firstName: 'G',
        lastName: 'P',
      },
    });
    await fixturePrisma.guardianChildRelationship.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT' },
    });

    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    await attendance.recordEvent(educatorUser, {
      childId: child.id,
      eventType: 'SIGN_IN',
      method: 'KIOSK',
      timestamp: new Date().toISOString(),
    });
    await careRecords.createGroupEvent(educatorUser, {
      type: 'MEAL',
      timestamp: new Date().toISOString(),
      defaultNote: 'Breakfast eaten well',
      childIds: [child.id],
    });

    const guardianUser: RequestUser = { userId: guardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 'test-session' };
    const view = await glance.get(guardianUser, child.id);

    expect(view.attendance.status).toBe('SIGNED_IN');
    expect(view.todaysCareRecords).toHaveLength(1);
    expect(view.todaysCareRecords[0].note).toBe('Breakfast eaten well');
    expect(view.child.roomName).not.toBeNull();
  });

  it('a guardian with no relationship to the child cannot view the glance screen', async () => {
    const tenant = await seedOrgCentreRoom('GlanceDenied');
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'Private',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
    const unrelatedGuardian = await fixturePrisma.user.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        email: `guardian-${uniqueSuffix()}@example.test`,
        passwordHash: 'x',
        role: 'PARENT',
        firstName: 'G',
        lastName: 'P',
      },
    });

    const user: RequestUser = { userId: unrelatedGuardian.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'PARENT', sessionId: 'test-session' };
    await expect(glance.get(user, child.id)).rejects.toThrow();
  });
});
