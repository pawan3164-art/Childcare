import { Module } from '@nestjs/common';
import { FeeCalculationService } from './fee-calculation.service';
import { BillingService } from './billing.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { BillingController } from './billing.controller';

@Module({
  providers: [FeeCalculationService, BillingService, LedgerService, PaymentsService],
  controllers: [BillingController],
  exports: [FeeCalculationService, BillingService, LedgerService, PaymentsService],
})
export class BillingModule {}
