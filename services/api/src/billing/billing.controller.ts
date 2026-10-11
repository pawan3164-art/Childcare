import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { BillingService } from './billing.service';
import { LedgerService } from './ledger.service';
import { ChargeCardInput, PaymentsService } from './payments.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway/payment-gateway.interface';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { AuditRead } from '../audit/audit-read';
import { ModuleGuard, RequiresModule } from '../features/module.guard';

@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Post('invoices')
  generateInvoice(@Req() req: { user: RequestUser }, @Body() dto: GenerateInvoiceDto) {
    return this.billing.generateInvoice(req.user, dto);
  }

  @Get('children/:childId/ledger')
  @AuditRead('child_ledger', { entityType: 'Child', idParam: 'childId' })
  getLedger(@Req() req: { user: RequestUser }, @Param('childId') childId: string) {
    return this.ledger.getBreakdown(req.user, childId);
  }

  @Post('payments/manual')
  recordManualPayment(@Req() req: { user: RequestUser }, @Body() dto: RecordManualPaymentDto) {
    return this.payments.recordManualPayment(req.user, dto);
  }

  /** Tells the app which gateway is active, so it knows whether to show the hosted card fields. Nothing secret. */
  @Get('billing/payments/config')
  paymentConfig() {
    return { provider: this.gateway.provider, mode: this.gateway.provider === 'MOCK' ? ('mock' as const) : ('live' as const) };
  }

  /** Pay by card with a token from the hosted fields. The customer IP is what the server saw, never a body field. */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('billing/payments/card')
  payByCard(@Req() req: { user: RequestUser; ip?: string }, @Body() dto: ChargeCardInput) {
    return this.payments.chargeCard(req.user, dto, { ip: req.ip });
  }

  @Post('billing/adjustments')
  createAdjustment(@Req() req: { user: RequestUser }, @Body() dto: CreateAdjustmentDto) {
    return this.payments.createAdjustment(req.user, dto);
  }
}
