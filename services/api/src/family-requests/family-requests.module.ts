import { Module } from '@nestjs/common';
import { FamilyRequestsService } from './family-requests.service';
import { FamilyRequestsController } from './family-requests.controller';

@Module({
  providers: [FamilyRequestsService],
  controllers: [FamilyRequestsController],
  exports: [FamilyRequestsService],
})
export class FamilyRequestsModule {}
