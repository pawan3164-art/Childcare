import { Module } from '@nestjs/common';
import { MedicationService } from './medication.service';
import { MedicationController } from './medication.controller';

@Module({
  providers: [MedicationService],
  controllers: [MedicationController],
  exports: [MedicationService],
})
export class MedicationModule {}
