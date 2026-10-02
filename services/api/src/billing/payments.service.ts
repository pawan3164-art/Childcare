import { ForbiddenException, Injectable } from '@nestjs/common';
import { LedgerEntry, PaymentRecord } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export interface MockWebhookPayload {
  orgId: string;
  centreId: string;
  childId: string;
  providerPaymentId: string;
  amountCents: number;
  status: 'SUCCEEDED' | 'FAILED';
}

/**
 * BIL-006/BIL-007/BIL-009: "payment webhooks are idempotent; a failed or
 * duplicate webhook can never double-credit an account" (Delivery Plan §6.3).
 * The gateway itself is mocked (OI-06 — real gateway TBD) but the idempotency
 * guarantee is real and tested the same way as sync-operation idempotency.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Simulates receiving a webhook from the (mocked) payment gateway. */
  async processWebhook(payload: MockWebhookPayload): Promise<PaymentRecord> {
    return this.tenancy.withTenant({ orgId: payload.orgId, centreId: payload.centreId }, async (tx) => {
      const existing = await tx.paymentRecord.findUnique({
        where: { providerPaymentId: payload.providerPaymentId },
      });
      if (existing) return existing; // duplicate/replayed webhook — no-op, not an error

      let ledgerEntry: LedgerEntry | null = null;
      if (payload.status === 'SUCCEEDED') {
        ledgerEntry = await tx.ledgerEntry.create({
          data: {
            orgId: payload.orgId,
            centreId: payload.centreId,
            childId: payload.childId,
            entryType: 'PAYMENT',
            amountCents: -payload.amountCents,
            description: `Payment via gateway (ref ${payload.providerPaymentId})`,
          },
        });
      }

      return tx.paymentRecord.create({
        data: {
          orgId: payload.orgId,
          centreId: payload.centreId,
          childId: payload.childId,
          provider: 'MOCK',
          providerPaymentId: payload.providerPaymentId,
          amountCents: payload.amountCents,
          status: payload.status,
          ledgerEntryId: ledgerEntry?.id,
        },
      });
    });
  }

  async recordManualPayment(user: RequestUser, dto: RecordManualPaymentDto): Promise<LedgerEntry> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an administrator can record a manual payment');
    }
    await this.authorization.assertCanAccessChild(user, dto.childId, 'viewBilling');

    const entry = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.ledgerEntry.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            entryType: 'PAYMENT',
            amountCents: -dto.amountCents,
            description: `Manual payment (${dto.method})`,
            createdByUserId: user.userId,
          },
        }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'billing.payment.manual',
      entityType: 'LedgerEntry',
      entityId: entry.id,
      outcome: 'SUCCESS',
      metadata: { amountCents: dto.amountCents, method: dto.method },
    });

    return entry;
  }

  async createAdjustment(user: RequestUser, dto: CreateAdjustmentDto): Promise<LedgerEntry> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an administrator can create a credit or adjustment');
    }
    await this.authorization.assertCanAccessChild(user, dto.childId, 'viewBilling');

    const amountCents = dto.entryType === 'CREDIT' ? -Math.abs(dto.amountCents) : dto.amountCents;

    const entry = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.ledgerEntry.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            entryType: dto.entryType,
            amountCents,
            description: dto.description,
            reasonCode: dto.reasonCode,
            createdByUserId: user.userId,
          },
        }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: `billing.${dto.entryType.toLowerCase()}.create`,
      entityType: 'LedgerEntry',
      entityId: entry.id,
      outcome: 'SUCCESS',
      metadata: { amountCents, reasonCode: dto.reasonCode },
    });

    return entry;
  }
}
