import { Module } from '@nestjs/common';
import { FeeCalculationService } from './fee-calculation.service';
import { BillingService } from './billing.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { BillingController } from './billing.controller';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.interface';
import { createPaymentGateway } from './gateway/payment-gateway.factory';

@Module({
  providers: [
    FeeCalculationService,
    BillingService,
    LedgerService,
    PaymentsService,
    // The mock is the default; PAYMENT_GATEWAY=fatzebra switches to the real adapter (ADR 0006).
    { provide: PAYMENT_GATEWAY, useFactory: () => createPaymentGateway(process.env) },
  ],
  controllers: [BillingController],
  exports: [FeeCalculationService, BillingService, LedgerService, PaymentsService, PAYMENT_GATEWAY],
})
export class BillingModule {}
