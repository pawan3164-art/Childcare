import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CareRecordsService } from './care-records.service';
import { CareAlertsService } from './care-alerts.service';
import { CareRecordsController } from './care-records.controller';

@Module({
  imports: [NotificationsModule],
  providers: [CareRecordsService, CareAlertsService],
  controllers: [CareRecordsController],
  exports: [CareRecordsService, CareAlertsService],
})
export class CareRecordsModule {}
