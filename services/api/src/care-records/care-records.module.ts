import { Module } from '@nestjs/common';
import { CareRecordsService } from './care-records.service';
import { CareRecordsController } from './care-records.controller';

@Module({
  providers: [CareRecordsService],
  controllers: [CareRecordsController],
  exports: [CareRecordsService],
})
export class CareRecordsModule {}
