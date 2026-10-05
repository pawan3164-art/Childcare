import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { CareRecordsService, SLEEP_CHECK_INTERVAL_MINUTES } from '../../src/care-records/care-records.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * U1 routines (OWNA gap: sleep checks, sunscreen, nappies). Routine types
 * carry validated structured details; sleeping children have a check due
 * every SLEEP_CHECK_INTERVAL_MINUTES (working default, see open items).
 */
describe('CareRecordsService: U1 routines', () => {
  let prismaService: PrismaService;
  let care: CareRecordsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    care = new CareRecordsService(tenancy, audit, new AuthorizationService(tenancy, audit));
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setup(label: string, childCount = 2) {
    const tenant = await seedOrgCentreRoom(label);
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `e-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: educator.id, roomId: tenant.roomId, startDate: new Date('2026-01-01') },
    });
    const children = [];
    for (let i = 0; i < childCount; i++) {
      children.push(
        await fixturePrisma.child.create({
          data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: `C${i}`, lastName: `Routine-${uniqueSuffix()}`, dateOfBirth: new Date('2024-01-01') },
        }),
      );
    }
    const user: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 's' };
    return { tenant, user, children };
  }

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();

  it('logs a group nappy change with per-child condition overrides', async () => {
    const { user, children } = await setup('Nappy');
    const result = await care.createGroupEvent(user, {
      type: 'NAPPY',
      timestamp: minutesAgo(1),
      childIds: children.map((c) => c.id),
      defaultDetails: { condition: 'WET' },
      exceptions: [{ childId: children[1].id, details: { condition: 'SOILED' } }],
    });
    const byChild = new Map(result.records.map((r) => [r.childId, r.details]));
    expect(byChild.get(children[0].id)).toEqual({ condition: 'WET' });
    expect(byChild.get(children[1].id)).toEqual({ condition: 'SOILED' });
  });

  it('rejects routine details that are missing or invalid', async () => {
    const { user, children } = await setup('BadDetails', 1);
    const ids = [children[0].id];
    await expect(care.createGroupEvent(user, { type: 'NAPPY', timestamp: minutesAgo(1), childIds: ids })).rejects.toThrow(/condition/);
    await expect(
      care.createGroupEvent(user, { type: 'NAPPY', timestamp: minutesAgo(1), childIds: ids, defaultDetails: { condition: 'DAMP' } }),
    ).rejects.toThrow(/condition/);
    await expect(
      care.createGroupEvent(user, { type: 'SLEEP_CHECK', timestamp: minutesAgo(1), childIds: ids, defaultDetails: { position: 'BACK' } }),
    ).rejects.toThrow(/breathing/);
    await expect(
      care.createGroupEvent(user, { type: 'SLEEP', timestamp: minutesAgo(1), childIds: ids, defaultDetails: { phase: 'NAP' } }),
    ).rejects.toThrow(/phase/);
  });

  it('flags a sleep check where the child is on their front or breathing is not normal', async () => {
    const { user, children } = await setup('SleepFlag', 2);
    const result = await care.createGroupEvent(user, {
      type: 'SLEEP_CHECK',
      timestamp: minutesAgo(1),
      childIds: children.map((c) => c.id),
      defaultDetails: { position: 'BACK', breathingOk: true },
      exceptions: [{ childId: children[1].id, details: { position: 'FRONT', breathingOk: true } }],
    });
    const byChild = new Map(result.records.map((r) => [r.childId, r.details as { flagged: boolean }]));
    expect(byChild.get(children[0].id)?.flagged).toBe(false);
    expect(byChild.get(children[1].id)?.flagged).toBe(true);
  });

  it('sunscreen needs no details', async () => {
    const { user, children } = await setup('Sunscreen', 1);
    const result = await care.createGroupEvent(user, { type: 'SUNSCREEN', timestamp: minutesAgo(1), childIds: [children[0].id] });
    expect(result.records).toHaveLength(1);
  });

  it('room sleep status lists sleeping children with their next check, and flags overdue checks', async () => {
    const { tenant, user, children } = await setup('SleepStatus', 3);
    const [overdue, fresh, woke] = children;
    const log = (type: 'SLEEP' | 'SLEEP_CHECK', childId: string, at: string, details: Record<string, unknown>) =>
      care.createGroupEvent(user, { type, timestamp: at, childIds: [childId], defaultDetails: details });
    await log('SLEEP', overdue.id, minutesAgo(30), { phase: 'START' });
    await log('SLEEP_CHECK', overdue.id, minutesAgo(SLEEP_CHECK_INTERVAL_MINUTES + 3), { position: 'BACK', breathingOk: true });
    await log('SLEEP', fresh.id, minutesAgo(4), { phase: 'START' });
    await log('SLEEP', woke.id, minutesAgo(40), { phase: 'START' });
    await log('SLEEP', woke.id, minutesAgo(5), { phase: 'END' });

    const status = await care.roomSleepStatus(user, tenant.roomId);
    const byChild = new Map(status.map((s) => [s.childId, s]));

    expect(byChild.has(woke.id)).toBe(false);
    expect(byChild.get(overdue.id)).toMatchObject({ overdue: true });
    expect(byChild.get(fresh.id)).toMatchObject({ overdue: false, lastCheckAt: null });
    const freshDue = new Date(byChild.get(fresh.id)!.nextCheckDueAt).getTime();
    expect(Math.abs(freshDue - (Date.now() - 4 * 60000 + SLEEP_CHECK_INTERVAL_MINUTES * 60000))).toBeLessThan(5000);
  });
});
