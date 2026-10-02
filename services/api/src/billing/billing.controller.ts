import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../authorization/guards/jwt-auth.guard';
import { RequestUser } from '../authorization/request-user.interface';
import { BillingService } from './billing.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('invoices')
  generateInvoice(@Req() req: { user: RequestUser }, @Body() dto: GenerateInvoiceDto) {
    return this.billing.generateInvoice(req.user, dto);
  }

  @Get('children/:childId/ledger')
  getLedger(@Req() req: { user: RequestUser }, @Param('childId') childId: string) {
    return this.ledger.getBreakdown(req.user, childId);
  }

  @Post('payments/manual')
  recordManualPayment(@Req() req: { user: RequestUser }, @Body() dto: RecordManualPaymentDto) {
    return this.payments.recordManualPayment(req.user, dto);
  }

  @Post('billing/adjustments')
  createAdjustment(@Req() req: { user: RequestUser }, @Body() dto: CreateAdjustmentDto) {
    return this.payments.createAdjustment(req.user, dto);
  }
}
