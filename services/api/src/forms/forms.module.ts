import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';

@Module({
  imports: [NotificationsModule],
  providers: [FormsService],
  controllers: [FormsController],
  exports: [FormsService],
})
export class FormsModule {}
