import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { LedgerEntry, PaymentRecord, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { GatewayChargeResult, PAYMENT_GATEWAY, PaymentGateway } from './gateway/payment-gateway.interface';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export interface MockWebhookPayload {
  orgId: string;
  centreId: string;
  childId: string;
  providerPaymentId: string;
  amountCents: number;
  status: 'SUCCEEDED' | 'FAILED';
  /** Defaults to MOCK. */
  provider?: string;
}

export interface ChargeCardInput {
  childId: string;
  amountCents: number;
  cardToken: string;
  idempotencyKey: string;
}

export interface ChargeCardResult {
  status: 'SUCCEEDED' | 'FAILED';
  paymentId: string | null;
  amountCents: number;
  card?: { brand: string; last4: string };
  message?: string;
}

const MAX_CARD_PAYMENT_CENTS = 1_000_000;
const IN_FLIGHT_WAIT_MS = 6000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * BIL-006/BIL-007/BIL-009: "payment webhooks are idempotent; a failed or
 * duplicate webhook can never double-credit an account" (Delivery Plan §6.3).
 * The gateway itself is mocked (OI-06 — real gateway TBD) but the idempotency
 * guarantee is real and tested the same way as sync-operation idempotency.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
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
          provider: payload.provider ?? 'MOCK',
          providerPaymentId: payload.providerPaymentId,
          amountCents: payload.amountCents,
          status: payload.status,
          ledgerEntryId: ledgerEntry?.id,
        },
      });
    });
  }

  /**
   * Pays a child's account by card. The client's hosted fields supply a token (the card number never reaches us). The
   * idempotency key makes a retry safe: the same key never charges twice, and returns the first outcome. Neither the
   * token nor the customer IP is stored, logged or audited.
   */
  async chargeCard(user: RequestUser, dto: ChargeCardInput, meta: { ip?: string } = {}, now: Date = new Date()): Promise<ChargeCardResult> {
    void now;
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (user.role !== 'PARENT' && !ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only a parent or an administrator can pay by card');
    if (!Number.isInteger(dto?.amountCents) || dto.amountCents < 1 || dto.amountCents > MAX_CARD_PAYMENT_CENTS) throw new BadRequestException('The amount is not valid');
    if (typeof dto.idempotencyKey !== 'string' || dto.idempotencyKey.length < 8 || dto.idempotencyKey.length > 100) throw new BadRequestException('The request key is not valid');
    if (typeof dto.cardToken !== 'string' || dto.cardToken.length < 1 || dto.cardToken.length > 100 || !/^[A-Za-z0-9_-]+$/.test(dto.cardToken)) throw new BadRequestException('The card token is not valid');
    if (typeof dto.childId !== 'string') throw new BadRequestException('A child is required');
    await this.authorization.assertCanAccessChild(user, dto.childId, 'viewBilling');

    const orgId = user.orgId;
    const scope = { orgId, centreId: user.centreId };
    // Money is recorded against the child's own centre, whichever centre the signed-in user is working in.
    const child = await this.tenancy.withTenant(scope, (tx) => tx.child.findFirst({ where: { id: dto.childId, orgId }, select: { centreId: true } }));
    if (!child) throw new ForbiddenException();
    const centreId = child.centreId;

    // Claim the key. The unique (org, key) index lets exactly one caller proceed to charge.
    let attemptId: string;
    try {
      // The claim and its audit entry commit together, so a charge can never happen without a trace of it starting.
      attemptId = await this.tenancy.withTenant(scope, async (tx) => {
        const a = await tx.paymentAttempt.create({
          data: { orgId, centreId, childId: dto.childId, actorUserId: user.userId, idempotencyKey: dto.idempotencyKey, status: 'PENDING', provider: this.gateway.provider, amountCents: dto.amountCents },
          select: { id: true },
        });
        await this.audit.record(
          { orgId, centreId, actorUserId: user.userId, actorRole: user.role, action: 'billing.payment.card_initiated', entityType: 'PaymentAttempt', entityId: a.id, outcome: 'SUCCESS', metadata: { amountCents: dto.amountCents, provider: this.gateway.provider } },
          tx,
        );
        return a.id;
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      return this.existingAttempt(scope, user, dto);
    }

    let result: GatewayChargeResult;
    try {
      result = await this.gateway.charge({
        amountCents: dto.amountCents,
        reference: `${orgId.slice(0, 8)}-${dto.idempotencyKey}`,
        customerIp: meta.ip || '0.0.0.0',
        cardToken: dto.cardToken,
      });
    } catch (err) {
      // A timeout or error does not tell us whether the card was charged, so this is UNKNOWN, never FAILED.
      this.logger.warn({ msg: 'card charge outcome unknown', attemptId, provider: this.gateway.provider, error: err instanceof Error ? err.name : 'unknown' });
      await this.tenancy.withTenant(scope, (tx) => tx.paymentAttempt.update({ where: { id: attemptId }, data: { status: 'UNKNOWN' } }));
      throw new ServiceUnavailableException('We could not confirm this payment. Please check your balance before trying again; the centre can confirm it.');
    }

    try {
      return await this.recordOutcome(scope, centreId, user, dto, attemptId, result);
    } catch (err) {
      // The gateway answered but we could not record it: money may have moved, so mark it for reconciliation.
      this.logger.warn({ msg: 'card charge could not be recorded', attemptId, provider: this.gateway.provider, error: err instanceof Error ? err.name : 'unknown' });
      await this.tenancy
        .withTenant(scope, (tx) => tx.paymentAttempt.update({ where: { id: attemptId }, data: { status: 'UNKNOWN', providerPaymentId: result.providerPaymentId } }))
        .catch(() => undefined);
      throw new ServiceUnavailableException('We could not confirm this payment. Please check your balance before trying again; the centre can confirm it.');
    }
  }

  private async recordOutcome(scope: { orgId: string; centreId: string }, centreId: string, user: RequestUser, dto: ChargeCardInput, attemptId: string, result: GatewayChargeResult): Promise<ChargeCardResult> {
    const orgId = scope.orgId;
    return this.tenancy.withTenant(scope, async (tx) => {
      if (result.status === 'SUCCEEDED' && result.providerPaymentId) {
        // The same idempotent path a gateway webhook uses: a later webhook for this payment is a no-op.
        let record = await tx.paymentRecord.findUnique({ where: { providerPaymentId: result.providerPaymentId } });
        if (!record) {
          const entry = await tx.ledgerEntry.create({
            data: { orgId, centreId, childId: dto.childId, entryType: 'PAYMENT', amountCents: -dto.amountCents, description: `Card payment (ref ${result.providerPaymentId})`, createdByUserId: user.userId },
          });
          record = await tx.paymentRecord.create({
            data: { orgId, centreId, childId: dto.childId, provider: this.gateway.provider, providerPaymentId: result.providerPaymentId, amountCents: dto.amountCents, status: 'SUCCEEDED', ledgerEntryId: entry.id },
          });
        }
        await tx.paymentAttempt.update({
          where: { id: attemptId },
          data: { status: 'SUCCEEDED', providerPaymentId: result.providerPaymentId, paymentRecordId: record.id, message: result.message, cardBrand: result.card?.brand ?? null, cardLast4: result.card?.last4 ?? null },
        });
        await this.audit.record(
          { orgId, centreId, actorUserId: user.userId, actorRole: user.role, action: 'billing.payment.card', entityType: 'PaymentRecord', entityId: record.id, outcome: 'SUCCESS', metadata: { amountCents: dto.amountCents, status: 'SUCCEEDED', paymentId: record.id, provider: this.gateway.provider } },
          tx,
        );
        return { status: 'SUCCEEDED' as const, paymentId: record.id, amountCents: dto.amountCents, ...(result.card ? { card: result.card } : {}) };
      }
      await tx.paymentAttempt.update({ where: { id: attemptId }, data: { status: 'FAILED', message: result.message } });
      await this.audit.record(
        { orgId, centreId, actorUserId: user.userId, actorRole: user.role, action: 'billing.payment.card', entityType: 'PaymentAttempt', entityId: attemptId, outcome: 'FAILURE', metadata: { amountCents: dto.amountCents, status: 'FAILED', provider: this.gateway.provider } },
        tx,
      );
      return { status: 'FAILED' as const, paymentId: null, amountCents: dto.amountCents, message: result.message };
    });
  }

  /** A repeat of an earlier request: wait briefly if the first is still charging, then return its stored outcome. */
  private async existingAttempt(scope: { orgId: string; centreId: string }, user: RequestUser, dto: ChargeCardInput): Promise<ChargeCardResult> {
    const deadline = Date.now() + IN_FLIGHT_WAIT_MS;
    for (;;) {
      const a = await this.tenancy.withTenant(scope, (tx) => tx.paymentAttempt.findUnique({ where: { orgId_idempotencyKey: { orgId: scope.orgId, idempotencyKey: dto.idempotencyKey } } }));
      if (!a || a.childId !== dto.childId || a.actorUserId !== user.userId || a.amountCents !== dto.amountCents) {
        throw new ConflictException('That request key was already used for a different payment');
      }
      if (a.status === 'SUCCEEDED') {
        return { status: 'SUCCEEDED', paymentId: a.paymentRecordId, amountCents: a.amountCents, ...(a.cardBrand && a.cardLast4 ? { card: { brand: a.cardBrand, last4: a.cardLast4 } } : {}) };
      }
      if (a.status === 'FAILED') return { status: 'FAILED', paymentId: null, amountCents: a.amountCents, message: a.message ?? 'Declined' };
      // Never retried against the gateway: it may already have charged the card.
      if (a.status === 'UNKNOWN') throw new ConflictException('This payment could not be confirmed yet. Please check your balance, or ask the centre to confirm it.');
      if (Date.now() >= deadline) throw new ConflictException('This payment is still being processed. Check your balance before trying again.');
      await sleep(150);
    }
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
