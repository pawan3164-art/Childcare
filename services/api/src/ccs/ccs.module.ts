import { Module } from '@nestjs/common';
import { CcsService } from './ccs.service';
import { CcsController } from './ccs.controller';
import { CCS_GATEWAY } from './gateway/ccs-gateway.interface';
import { MockCcsGateway } from './gateway/mock-ccs.gateway';

@Module({
  providers: [CcsService, { provide: CCS_GATEWAY, useClass: MockCcsGateway }],
  controllers: [CcsController],
  exports: [CcsService],
})
export class CcsModule {}
