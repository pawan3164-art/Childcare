import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { FeeCalculationService } from '../../src/billing/fee-calculation.service';
import { BillingService } from '../../src/billing/billing.service';
import { LedgerService } from '../../src/billing/ledger.service';
import { PaymentsService } from '../../src/billing/payments.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { appPrisma, disconnectAll, fixturePrisma, seedOrgCentreRoom, setTenantContext, uniqueSuffix } from '../test-utils';

describe('BillingService + LedgerService: invoice generation and explainable balance', () => {
  let prismaService: PrismaService;
  let tenancy: TenancyService;
  let authorization: AuthorizationService;
  let billing: BillingService;
  let ledger: LedgerService;
  let payments: PaymentsService;

  beforeAll(async () => {
    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    tenancy = new TenancyService(prismaService);
    const audit = new AuditService(tenancy);
    authorization = new AuthorizationService(tenancy, audit);
    const feeCalculation = new FeeCalculationService();
    billing = new BillingService(tenancy, audit, authorization, feeCalculation);
    ledger = new LedgerService(tenancy, authorization);
    payments = new PaymentsService(tenancy, audit, authorization);
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function setupBilledChild(label: string, dailyFeeCents: number, subsidyPercent?: number) {
    const tenant = await seedOrgCentreRoom(label);
    const admin = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `admin-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'CENTRE_ADMIN', firstName: 'A', lastName: 'D' },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'Billy', lastName: `Bill-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const feeSchedule = await fixturePrisma.feeSchedule.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, name: `Fee-${uniqueSuffix()}`, feeType: 'DAILY', amountCents: dailyFeeCents, effectiveFrom: new Date('2026-01-01') },
    });
    await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: feeSchedule.id, bookingType: 'PERMANENT', daysOfWeek: [1, 2, 3, 4, 5], startDate: new Date('2026-01-01') },
    });
    if (subsidyPercent !== undefined) {
      await fixturePrisma.ccsEntitlement.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, estimatedSubsidyPercent: subsidyPercent, effectiveFrom: new Date('2026-01-01') },
      });
    }
    const adminUser: RequestUser = { userId: admin.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'CENTRE_ADMIN', sessionId: 'test-session' };
    return { tenant, adminUser, child };
  }

  const WEEK_START = '2026-01-05';
  const WEEK_END = '2026-01-09';

  it('full flow: invoice generation -> explainable ledger breakdown -> payment reduces balance', async () => {
    const { adminUser, child } = await setupBilledChild('InvFullFlow', 10000, 65);

    const summary = await billing.generateInvoice(adminUser, {
      childId: child.id,
      cycleStart: WEEK_START,
      cycleEnd: WEEK_END,
    });

    expect(summary.sessionCount).toBe(5);
    expect(summary.grossCents).toBe(50000); // 5 x $100
    expect(summary.estimatedSubsidyCents).toBe(32500); // 65% of $500
    expect(summary.gapCents).toBe(17500); // $500 - $325

    const breakdownBeforePayment = await ledger.getBreakdown(adminUser, child.id);
    expect(breakdownBeforePayment.grossCents).toBe(50000);
    expect(breakdownBeforePayment.subsidyCents).toBe(32500);
    expect(breakdownBeforePayment.balanceCents).toBe(17500); // gap owed, no payments yet

    await payments.recordManualPayment(adminUser, { childId: child.id, amountCents: 17500, method: 'bank_transfer' });

    const breakdownAfterPayment = await ledger.getBreakdown(adminUser, child.id);
    expect(breakdownAfterPayment.paymentsCents).toBe(17500);
    expect(breakdownAfterPayment.balanceCents).toBe(0);
  });

  it('a SUBSIDY_CONFIRMED entry supersedes its ESTIMATED counterpart in the balance, not double-counted', async () => {
    const { adminUser, child } = await setupBilledChild('InvConfirmedSupersedes', 10000, 50);

    const summary = await billing.generateInvoice(adminUser, { childId: child.id, cycleStart: WEEK_START, cycleEnd: WEEK_END });
    expect(summary.estimatedSubsidyCents).toBe(25000); // 50% of $500

    // Simulate Stage 4's CCS module confirming a different (higher) amount for one session's fee.
    const feeEntries = await fixturePrisma.ledgerEntry.findMany({ where: { childId: child.id, entryType: 'FEE' } });
    const firstFee = feeEntries[0];
    await fixturePrisma.ledgerEntry.create({
      data: {
        orgId: adminUser.orgId as string,
        centreId: adminUser.centreId as string,
        childId: child.id,
        entryType: 'SUBSIDY_CONFIRMED',
        amountCents: -8000, // confirmed: $80 for this session, vs $50 estimated (10000*50%)
        description: 'Government-confirmed CCS amount for this session',
        sourceFeeEntryId: firstFee.id,
        sessionDate: firstFee.sessionDate,
      },
    });

    const breakdown = await ledger.getBreakdown(adminUser, child.id);
    // 4 remaining sessions still estimated at 50% ($5000 each = $20000), plus
    // the confirmed $8000 for the first session, NOT $5000 (estimated) + $8000 (confirmed).
    expect(breakdown.subsidyCents).toBe(20000 + 8000);
  });

  it('a duplicate payment webhook does not double-credit the account', async () => {
    const { adminUser, child, tenant } = await setupBilledChild('InvWebhookDup', 10000);
    const providerPaymentId = `pp-${uniqueSuffix()}`;

    const first = await payments.processWebhook({
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      childId: child.id,
      providerPaymentId,
      amountCents: 5000,
      status: 'SUCCEEDED',
    });
    const second = await payments.processWebhook({
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      childId: child.id,
      providerPaymentId, // same id — simulates a retried/duplicate webhook delivery
      amountCents: 5000,
      status: 'SUCCEEDED',
    });

    expect(second.id).toBe(first.id);

    const breakdown = await ledger.getBreakdown(adminUser, child.id);
    expect(breakdown.paymentsCents).toBe(5000); // not 10000
  });

  it('a credit always reduces the balance regardless of the sign passed in', async () => {
    const { adminUser, child } = await setupBilledChild('InvCredit', 10000);

    await payments.createAdjustment(adminUser, {
      childId: child.id,
      entryType: 'CREDIT',
      amountCents: 2000, // positive input
      reasonCode: 'goodwill',
      description: 'Goodwill credit for late pickup fee waiver',
    });

    const breakdown = await ledger.getBreakdown(adminUser, child.id);
    expect(breakdown.creditsCents).toBe(2000);
    expect(breakdown.balanceCents).toBe(-2000); // credit in family's favour, no fees yet
  });

  it('issued invoices and ledger entries cannot be updated at the DB level, even by an admin', async () => {
    const { adminUser, child, tenant } = await setupBilledChild('InvImmutable', 10000);
    const summary = await billing.generateInvoice(adminUser, { childId: child.id, cycleStart: WEEK_START, cycleEnd: WEEK_END });

    await setTenantContext(appPrisma, tenant.orgId, tenant.centreId);
    await expect(
      appPrisma.invoice.update({ where: { id: summary.invoice.id }, data: { cycleEnd: new Date('2099-01-01') } }),
    ).rejects.toThrow();

    const feeEntry = await fixturePrisma.ledgerEntry.findFirstOrThrow({ where: { invoiceId: summary.invoice.id } });
    await expect(
      appPrisma.ledgerEntry.update({ where: { id: feeEntry.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow();
  });

  it('a non-admin cannot generate an invoice', async () => {
    const tenant = await seedOrgCentreRoom('InvDeniedRole');
    const educator = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `educator-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'EDUCATOR', firstName: 'E', lastName: 'D' },
    });
    const child = await fixturePrisma.child.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, roomId: tenant.roomId, firstName: 'C', lastName: `Deny-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
    });
    const educatorUser: RequestUser = { userId: educator.id, orgId: tenant.orgId, centreId: tenant.centreId, role: 'EDUCATOR', sessionId: 'test-session' };

    await expect(
      billing.generateInvoice(educatorUser, { childId: child.id, cycleStart: WEEK_START, cycleEnd: WEEK_END }),
    ).rejects.toThrow();
  });
});
