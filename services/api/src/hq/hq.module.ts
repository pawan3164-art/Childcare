import { Module } from '@nestjs/common';
import { HqService } from './hq.service';
import { HqController } from './hq.controller';

@Module({
  providers: [HqService],
  controllers: [HqController],
  exports: [HqService],
})
export class HqModule {}
