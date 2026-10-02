import { Module } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [IncidentsService],
  controllers: [IncidentsController],
  exports: [IncidentsService],
})
export class IncidentsModule {}
