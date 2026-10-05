import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LearningService } from './learning.service';
import { LearningController } from './learning.controller';

@Module({
  imports: [MediaModule, NotificationsModule],
  providers: [LearningService],
  controllers: [LearningController],
  exports: [LearningService],
})
export class LearningModule {}
