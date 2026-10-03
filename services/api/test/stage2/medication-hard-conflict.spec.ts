import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { MedicationService } from '../../src/medication/medication.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * Delivery Plan §6.1: medication administration is a "hard conflict needing
 * human review (double-dose risk)" — the one entity in the whole system
 * where a second write within a window must NOT be auto-applied like an
 * attendance or care-record event would be.
 */
describe('MedicationService: hard-conflict rule on duplicate administration', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let medication: MedicationService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    const authorization = new AuthorizationService(tenancy, audit);
    medication = new MedicationService(tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setupChildWithAuthorization(label: string) {
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
    const child = await fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: 'Medkid',
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
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };
    const authRecord = await medication.authorize(educatorUser, {
      childId: child.id,
      medicationName: 'Antihistamine',
      dosageInstructions: '5ml as needed',
      authorizedByGuardianId: guardian.id,
    });
    return { tenant, educatorUser, authRecord };
  }

  it('the first administration of the day is CONFIRMED immediately', async () => {
    const { educatorUser, authRecord } = await setupChildWithAuthorization('MedFirst');

    const administration = await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T09:00:00Z').toISOString(),
      dosageGiven: '5ml',
    });

    expect(administration.status).toBe('CONFIRMED');
  });

  it('a second administration within the window is PENDING_REVIEW, not auto-applied as CONFIRMED', async () => {
    const { educatorUser, authRecord } = await setupChildWithAuthorization('MedSecondSameWindow');

    await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T09:00:00Z').toISOString(),
      dosageGiven: '5ml',
    });

    const second = await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T10:30:00Z').toISOString(), // 1.5h later, within the 4h window
      dosageGiven: '5ml',
    });

    expect(second.status).toBe('PENDING_REVIEW');
  });

  it('an administration well outside the window is CONFIRMED on its own (e.g. the next scheduled dose)', async () => {
    const { educatorUser, authRecord } = await setupChildWithAuthorization('MedOutsideWindow');

    await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T09:00:00Z').toISOString(),
      dosageGiven: '5ml',
    });

    const second = await medication.recordAdministration(educatorUser, {
      administeredAt: new Date('2026-01-01T20:00:00Z').toISOString(), // 11h later
      authorizationId: authRecord.id,
      dosageGiven: '5ml',
    });

    expect(second.status).toBe('CONFIRMED');
  });

  it('an administrator can resolve a PENDING_REVIEW administration, and a non-admin cannot', async () => {
    const { educatorUser, authRecord, tenant } = await setupChildWithAuthorization('MedReview');

    await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T09:00:00Z').toISOString(),
      dosageGiven: '5ml',
    });
    const pending = await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T10:00:00Z').toISOString(),
      dosageGiven: '5ml',
    });
    expect(pending.status).toBe('PENDING_REVIEW');

    await expect(medication.review(educatorUser, pending.id, 'REJECTED')).rejects.toThrow();

    const adminUser: RequestUser = { userId: educatorUser.userId, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 'test-session' };
    const resolved = await medication.review(adminUser, pending.id, 'REJECTED', 'Duplicate entry, only one dose actually given');
    expect(resolved.status).toBe('REJECTED');
    expect(resolved.reviewedByUserId).toBe(adminUser.userId);
  });

  it('once rejected, a prior administration no longer counts toward the duplicate window for a new one', async () => {
    const { educatorUser, authRecord, tenant } = await setupChildWithAuthorization('MedRejectedExcluded');

    const first = await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T09:00:00Z').toISOString(),
      dosageGiven: '5ml',
    });
    const adminUser: RequestUser = { userId: educatorUser.userId, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 'test-session' };
    await medication.review(adminUser, first.id, 'REJECTED');

    // A fresh administration in the same window as the now-rejected one should
    // be treated as the first valid dose, not flagged against the rejected record.
    const next = await medication.recordAdministration(educatorUser, {
      authorizationId: authRecord.id,
      administeredAt: new Date('2026-01-01T09:30:00Z').toISOString(),
      dosageGiven: '5ml',
    });
    expect(next.status).toBe('CONFIRMED');
  });
});
