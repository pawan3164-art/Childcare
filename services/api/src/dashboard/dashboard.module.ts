import { Module } from '@nestjs/common';
import { ChildGlanceService } from './child-glance.service';
import { DashboardController } from './dashboard.controller';

@Module({
  providers: [ChildGlanceService],
  controllers: [DashboardController],
})
export class DashboardModule {}
