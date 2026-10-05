import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChecklistsService } from './checklists.service';
import { ChecklistsController } from './checklists.controller';

@Module({
  imports: [NotificationsModule],
  providers: [ChecklistsService],
  controllers: [ChecklistsController],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
