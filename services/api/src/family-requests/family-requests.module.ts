import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FamilyRequestsService } from './family-requests.service';
import { FamilyRequestsController } from './family-requests.controller';

@Module({
  imports: [NotificationsModule],
  providers: [FamilyRequestsService],
  controllers: [FamilyRequestsController],
  exports: [FamilyRequestsService],
})
export class FamilyRequestsModule {}
