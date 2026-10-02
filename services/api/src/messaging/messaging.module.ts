import { Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [MessagingService],
  controllers: [MessagingController],
  exports: [MessagingService],
})
export class MessagingModule {}
