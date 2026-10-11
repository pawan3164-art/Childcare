import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { LedgerService } from '../../src/billing/ledger.service';
import { PaymentsService } from '../../src/billing/payments.service';
import { fixturePrisma } from '../test-utils';
import { setupFamily } from '../u3-family-requests/helpers';

export const NOW = new Date('2026-10-13T20:00:00Z');
export const IP = '203.0.113.7';

export function makeGateway(over: Partial<{ charge: jest.Mock; verifyWebhook: jest.Mock; provider: string }> = {}) {
  return {
    provider: 'MOCK' as const,
    charge: jest.fn(async (i: { reference: string }) => ({
      status: 'SUCCEEDED' as const,
      providerPaymentId: `gw_${i.reference}`,
      message: 'Approved',
      card: { brand: 'VISA', last4: '4242' },
    })),
    verifyWebhook: jest.fn(() => true),
    ...over,
  };
}
export type GatewayMock = ReturnType<typeof makeGateway>;

export async function buildPayments(gateway: GatewayMock) {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  const payments = new PaymentsService(tenancy, audit, authorization, gateway as any);
  const ledger = new LedgerService(tenancy, authorization);
  return { prismaService, payments, ledger };
}

/** setupFamily plus the parent's relationship granted billing access (the default is false). */
export async function billingFamily(label: string, rel: { canViewBilling?: boolean; isRestricted?: boolean } = {}) {
  const f = await setupFamily(label);
  await fixturePrisma.guardianChildRelationship.updateMany({
    where: { guardianUserId: f.parent.userId, childId: f.child.id },
    data: { canViewBilling: rel.canViewBilling ?? true, isRestricted: rel.isRestricted ?? false },
  });
  return f;
}

export const key = (s = 'k') => `${s}-${Math.random().toString(36).slice(2, 12)}${Date.now()}`.slice(0, 40);
export const TOKEN = 'tok_SECRETCARDTOKEN_123';
