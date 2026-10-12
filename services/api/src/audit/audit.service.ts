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

  /** Pass `tx` to write the entry inside the caller's transaction, so a change and its audit entry commit or fail together. */
  async record(entry: RecordAuditEntryInput, tx?: Prisma.TransactionClient): Promise<void> {
    const write = (client: Prisma.TransactionClient) =>
      client.auditLogEntry.create({
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
      });
    if (tx) {
      await write(tx);
      return;
    }
    await this.tenancy.withTenant({ orgId: entry.orgId, centreId: entry.centreId }, write);
  }

  /** Many entries for one tenant in a single statement. Always joins the caller's transaction so the audit rows commit with the change. */
  async recordMany(entries: RecordAuditEntryInput[], tx: Prisma.TransactionClient): Promise<void> {
    if (entries.length === 0) return;
    await tx.auditLogEntry.createMany({
      data: entries.map((entry) => ({
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
      })),
    });
  }
}
