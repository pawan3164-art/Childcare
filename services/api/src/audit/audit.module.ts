import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditReadService } from './audit-read';

@Global()
@Module({
  providers: [AuditService, AuditReadService],
  exports: [AuditService, AuditReadService],
})
export class AuditModule {}
