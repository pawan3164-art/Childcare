import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { ChecklistsModule } from '../checklists/checklists.module';
import { CareRecordsModule } from '../care-records/care-records.module';
import { LearningModule } from '../learning/learning.module';

@Module({
  imports: [ChecklistsModule, CareRecordsModule, LearningModule],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService],
})
export class SyncModule {}
