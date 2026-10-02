import { Module } from '@nestjs/common';
import { LoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { SyncModule } from './sync/sync.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AttendanceModule } from './attendance/attendance.module';
import { CareRecordsModule } from './care-records/care-records.module';
import { MediaModule } from './media/media.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MedicationModule } from './medication/medication.module';
import { IncidentsModule } from './incidents/incidents.module';
import { MessagingModule } from './messaging/messaging.module';
import { GuardianRelationshipsModule } from './guardian-relationships/guardian-relationships.module';
import { BillingModule } from './billing/billing.module';
import { CcsModule } from './ccs/ccs.module';
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
    AttendanceModule,
    CareRecordsModule,
    MediaModule,
    DashboardModule,
    MedicationModule,
    IncidentsModule,
    MessagingModule,
    GuardianRelationshipsModule,
    BillingModule,
    CcsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
