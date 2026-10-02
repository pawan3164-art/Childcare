import { Module } from '@nestjs/common';
import { GuardianRelationshipsService } from './guardian-relationships.service';
import { GuardianRelationshipsController } from './guardian-relationships.controller';

@Module({
  providers: [GuardianRelationshipsService],
  controllers: [GuardianRelationshipsController],
  exports: [GuardianRelationshipsService],
})
export class GuardianRelationshipsModule {}
