import { Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
import { DirectMessagesService } from './direct-messages.service';
import { DirectMessagesController } from './direct-messages.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [MessagingService, DirectMessagesService],
  controllers: [MessagingController, DirectMessagesController],
  exports: [MessagingService],
})
export class MessagingModule {}
