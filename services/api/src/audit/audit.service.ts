import { Injectable } from '@nestjs/common';
import { Prisma, UserRole, AuditOutcome } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';

export interface RecordAuditEntryInput {
  orgId: string;
  centreId?: string | null;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
}

/**
 * Append-only by design: no update/delete method exists here, and the DB
 * grants for the childcare_app role REVOKE UPDATE/DELETE on audit_log_entries
 * (see prisma/migrations/*_enable_rls), so this isn't just an API convention.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenancy: TenancyService) {}

  async record(entry: RecordAuditEntryInput): Promise<void> {
    await this.tenancy.withTenant(
      { orgId: entry.orgId, centreId: entry.centreId },
      (tx) =>
        tx.auditLogEntry.create({
          data: {
            orgId: entry.orgId,
            centreId: entry.centreId ?? null,
            actorUserId: entry.actorUserId ?? null,
            actorRole: entry.actorRole ?? null,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId ?? null,
            outcome: entry.outcome,
            metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
            correlationId: entry.correlationId ?? null,
          },
        }),
    );
  }
}
