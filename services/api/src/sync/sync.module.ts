import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { ChecklistsModule } from '../checklists/checklists.module';
import { CareRecordsModule } from '../care-records/care-records.module';

@Module({
  imports: [ChecklistsModule, CareRecordsModule],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService],
})
export class SyncModule {}
