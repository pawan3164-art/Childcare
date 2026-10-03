import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { FeeCalculationService } from '../../src/billing/fee-calculation.service';
import { BillingService } from '../../src/billing/billing.service';
import { LedgerService } from '../../src/billing/ledger.service';
import { CcsService } from '../../src/ccs/ccs.service';
import { MockCcsGateway } from '../../src/ccs/gateway/mock-ccs.gateway';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * BIL-004/BIL-005: proves the CCS module's output (an accepted or rejected
 * session report) plugs correctly into Stage 3's ledger — every confirmed
 * amount is tagged with its source and nets against the matching FEE entry's
 * estimated subsidy (ADR 0002), without the ledger needing to know CCS exists.
 */
describe('CcsService: session report submission against the mocked gateway', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let authorization: AuthorizationService;
  let billing: BillingService;
  let ledger: LedgerService;
  let ccs: CcsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    billing = new BillingService(tenancy, audit, authorization, new FeeCalculationService());
    ledger = new LedgerService(tenancy, authorization);
    ccs = new CcsService(tenancy, audit, authorization, new MockCcsGateway());
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setupInvoicedChild(label: string) {
    const tenant = await seedOrgCentreRoom(label);
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'Ccsy', lastName: `Child-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const feeSchedule = await fixturePrisma.feeSchedule.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Fee-${uniqueSuffix()}`, feeType: 'DAILY', amountCents: 10000, effectiveFrom: new Date('2026-01-01') },
    });
    await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: feeSchedule.id, bookingType: 'PERMANENT', daysOfWeek: [1, 2, 3, 4, 5], startDate: new Date('2026-01-01') },
    });
    await fixturePrisma.ccsEntitlement.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, estimatedSubsidyPercent: 50, effectiveFrom: new Date('2026-01-01') },
    });
    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 'test-session' };

    // Monday 2026-01-05 through Friday 2026-01-09.
    await billing.generateInvoice(adminUser, { childId: child.id, cycleStart: '2026-01-05', cycleEnd: '2026-01-09' });

    const enrolment = await ccs.createEnrolment(adminUser, { childId: child.id, ccsEnrolmentRef: `CCS-${uniqueSuffix()}` });

    return { tenant, adminUser, child, enrolment };
  }

  it('an accepted session report creates a SUBSIDY_CONFIRMED entry that supersedes the estimated one for that session', async () => {
    const { adminUser, child, enrolment } = await setupInvoicedChild('CcsAccepted');

    const before = await ledger.getBreakdown(adminUser, child.id);
    expect(before.subsidyCents).toBe(25000); // 5 x $100 x 50% estimated

    // Monday — avoids the mock gateway's Sunday-rejection rule.
    const report = await ccs.submitSessionReport(adminUser, {
      enrolmentId: enrolment.id,
      sessionDate: '2026-01-05',
      hours: 10,
    });

    expect(report.status).toBe('ACCEPTED');
    expect(report.confirmedSubsidyCents).toBe(7000); // 70% of $100 (the mock's fixed rate)

    const after = await ledger.getBreakdown(adminUser, child.id);
    // Monday's $50 estimated is replaced by $70 confirmed; the other 4 days
    // stay at $50 estimated each ($200) — total 200 + 70 = 270, not 250 + 70.
    expect(after.subsidyCents).toBe(20000 + 7000);
  });

  it('a rejected session report records the reason and creates no ledger entry', async () => {
    const { adminUser, child, enrolment } = await setupInvoicedChild('CcsRejected');

    const before = await ledger.getBreakdown(adminUser, child.id);

    // Sunday 2026-01-04 triggers the mock gateway's deterministic rejection.
    // (Not an invoiced session — this also exercises the "reject before even
    // checking for a FEE entry" path, which is the realistic failure mode.)
    const report = await ccs.submitSessionReport(adminUser, {
      enrolmentId: enrolment.id,
      sessionDate: '2026-01-04',
      hours: 8,
    });

    expect(report.status).toBe('REJECTED');
    expect(report.rejectionReason).toContain('mock_gateway');
    expect(report.confirmedSubsidyCents).toBeNull();

    const after = await ledger.getBreakdown(adminUser, child.id);
    expect(after.subsidyCents).toBe(before.subsidyCents); // unchanged
  });

  it('resubmitting a rejected report creates a new attempt, leaving the original untouched', async () => {
    const { adminUser, enrolment } = await setupInvoicedChild('CcsResubmit');

    const rejected = await ccs.submitSessionReport(adminUser, {
      enrolmentId: enrolment.id,
      sessionDate: '2026-01-04', // Sunday — rejected
      hours: 8,
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.attemptNumber).toBe(1);

    // Can't actually flip the mock's Sunday rejection, so resubmitting the
    // same date is expected to be rejected again — what matters here is that
    // it's a NEW row, not a mutation of the first.
    const secondAttempt = await ccs.resubmit(adminUser, rejected.id);

    expect(secondAttempt.id).not.toBe(rejected.id);
    expect(secondAttempt.attemptNumber).toBe(2);

    const originalStillRejected = await fixturePrisma.ccsSessionReport.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(originalStillRejected.status).toBe('REJECTED');
    expect(originalStillRejected.attemptNumber).toBe(1);
  });

  it('cannot resubmit a report that was already accepted', async () => {
    const { adminUser, enrolment } = await setupInvoicedChild('CcsResubmitAccepted');

    const accepted = await ccs.submitSessionReport(adminUser, {
      enrolmentId: enrolment.id,
      sessionDate: '2026-01-05',
      hours: 10,
    });
    expect(accepted.status).toBe('ACCEPTED');

    await expect(ccs.resubmit(adminUser, accepted.id)).rejects.toThrow();
  });

  it('a non-admin cannot submit a session report', async () => {
    const { tenant, enrolment } = await setupInvoicedChild('CcsDeniedRole');
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `educator-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };

    await expect(
      ccs.submitSessionReport(educatorUser, { enrolmentId: enrolment.id, sessionDate: '2026-01-05', hours: 10 }),
    ).rejects.toThrow();
  });
});
