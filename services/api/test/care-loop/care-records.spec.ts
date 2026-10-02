import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { AttendanceService } from '../../src/attendance/attendance.service';
import { CareRecordsService } from '../../src/care-records/care-records.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

describe('CareRecordsService: group-first logging (BRD §9)', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let careRecords: CareRecordsService;
  let attendance: AttendanceService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    careRecords = new CareRecordsService(tenancy, audit, authorization);
    attendance = new AttendanceService(tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setupRoomWithChildren(label: string, count: number) {
    const tenant = await seedOrgCentreRoom(label);
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
    const children = [];
    for (let i = 0; i < count; i++) {
      children.push(
        await fixturePrisma.child.create({
          data: {
            orgId: tenant.orgId,
            centreId: tenant.centreId,
            roomId: tenant.roomId,
            firstName: `Child${i}`,
            lastName: `Group-${uniqueSuffix()}`,
            dateOfBirth: new Date('2023-01-01'),
          },
        }),
      );
    }
    return { tenant, educator, children };
  }

  it('one group action creates one care record per child, sharing a groupEventId', async () => {
    const { tenant, educator, children } = await setupRoomWithChildren('GroupBasic', 3);
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };

    const result = await careRecords.createGroupEvent(user, {
      type: 'MEAL',
      timestamp: new Date().toISOString(),
      defaultNote: 'Morning tea',
      childIds: children.map((c) => c.id),
    });

    expect(result.records).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    const groupIds = new Set(result.records.map((r) => r.groupEventId));
    expect(groupIds.size).toBe(1);
    expect(result.records.every((r) => r.note === 'Morning tea')).toBe(true);
  });

  it('a per-child exception overrides the note without affecting the rest of the group', async () => {
    const { tenant, educator, children } = await setupRoomWithChildren('GroupException', 3);
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };

    const result = await careRecords.createGroupEvent(user, {
      type: 'MEAL',
      timestamp: new Date().toISOString(),
      defaultNote: 'Morning tea',
      childIds: children.map((c) => c.id),
      exceptions: [{ childId: children[1].id, note: 'Only ate half' }],
    });

    const exceptionRecord = result.records.find((r) => r.childId === children[1].id);
    expect(exceptionRecord?.note).toBe('Only ate half');
    expect(result.records.filter((r) => r.note === 'Morning tea')).toHaveLength(2);
  });

  it('a per-child skip excludes that child entirely from the group action', async () => {
    const { tenant, educator, children } = await setupRoomWithChildren('GroupSkip', 3);
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };

    const result = await careRecords.createGroupEvent(user, {
      type: 'SLEEP',
      timestamp: new Date().toISOString(),
      childIds: children.map((c) => c.id),
      exceptions: [{ childId: children[0].id, skip: true }],
    });

    expect(result.records).toHaveLength(2);
    expect(result.skipped).toContain(children[0].id);
    expect(result.records.some((r) => r.childId === children[0].id)).toBe(false);
  });

  it('a child outside the room/educator assignment is silently skipped, not force-included', async () => {
    const { tenant, educator, children } = await setupRoomWithChildren('GroupOutsider', 2);
    const outsiderRoom = await fixturePrisma.room.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Outsider Room ${uniqueSuffix()}` },
    });
    const outsiderChild = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: outsiderRoom.id,
        firstName: 'Outsider',
        lastName: `Child-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR' };

    const result = await careRecords.createGroupEvent(user, {
      type: 'ACTIVITY',
      timestamp: new Date().toISOString(),
      childIds: [...children.map((c) => c.id), outsiderChild.id],
    });

    expect(result.records).toHaveLength(2);
    expect(result.skipped).toContain(outsiderChild.id);
  });

  it('attendance corrections are append-only: a correction creates a new linked row, never edits the original', async () => {
    const { tenant, educator, children } = await setupRoomWithChildren('AttendanceCorrection', 1);
    const adminUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN' };
    const original = await attendance.recordEvent(adminUser, {
      childId: children[0].id,
      eventType: 'SIGN_IN',
      method: 'KIOSK',
      timestamp: new Date('2026-01-01T08:00:00Z').toISOString(),
    });

    const corrected = await attendance.correctEvent(adminUser, original.id, {
      childId: children[0].id,
      eventType: 'SIGN_IN',
      method: 'EDUCATOR',
      timestamp: new Date('2026-01-01T08:05:00Z').toISOString(),
    });

    expect(corrected.isCorrection).toBe(true);
    expect(corrected.correctedEventId).toBe(original.id);

    const originalStillIntact = await fixturePrisma.attendanceEvent.findUniqueOrThrow({ where: { id: original.id } });
    expect(originalStillIntact.method).toBe('KIOSK'); // untouched
  });
});
