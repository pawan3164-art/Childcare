import { Module } from '@nestjs/common';
import { LoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { SyncModule } from './sync/sync.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    LoggingModule,
    PrismaModule,
    TenancyModule,
    AuditModule,
    AuthorizationModule,
    AuthModule,
    SyncModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
