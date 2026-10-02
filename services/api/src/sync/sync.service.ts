import { Injectable } from '@nestjs/common';
import { Prisma, SyncOperation } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { SubmitOperationDto } from './dto/submit-operation.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Entity types whose domain tables are append-only at the DB level (see the
 * Stage 0/1 RLS migrations) — a sync operation requesting UPDATE or DELETE
 * against one of these is a conflict, not a valid replay. */
const APPEND_ONLY_ENTITY_TYPES = new Set(['AttendanceEvent', 'CareRecord']);

interface AttendanceEventPayload {
  childId: string;
  eventType: 'SIGN_IN' | 'SIGN_OUT';
  method: 'KIOSK' | 'QR' | 'PIN' | 'EDUCATOR';
  timestamp: string;
}

interface CareRecordPayload {
  childId: string;
  type: 'MEAL' | 'SLEEP' | 'TOILETING' | 'BOTTLE' | 'ACTIVITY';
  timestamp: string;
  note?: string;
  groupEventId?: string;
}

/**
 * Records each client operation exactly once (idempotencyKey), then applies
 * its effect to the actual domain table per Delivery Plan §6.1's per-entity
 * conflict rules. The client-generated entityId becomes the row's primary
 * key, so the same op replayed via two paths (e.g. direct API call and a
 * delayed offline-sync flush) converges on one row, not two.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly authorization: AuthorizationService,
  ) {}

  async submit(user: RequestUser, dto: SubmitOperationDto): Promise<SyncOperation> {
    const orgId = user.orgId;
    const centreId = user.centreId;
    if (!orgId || !centreId) {
      throw new Error('Sync requires an authenticated user with org and centre context');
    }

    try {
      return await this.tenancy.withTenant({ orgId, centreId }, async (tx) => {
        const conflict = this.checkConflict(dto);

        if (!conflict) {
          await this.applyDomainEffect(tx, user, orgId, centreId, dto);
        }

        return tx.syncOperation.create({
          data: {
            orgId,
            centreId,
            idempotencyKey: dto.idempotencyKey,
            clientOperationId: dto.clientOperationId,
            entityType: dto.entityType,
            entityId: dto.entityId,
            operationType: dto.operationType,
            payload: dto.payload as Prisma.InputJsonValue,
            authorUserId: user.userId,
            clientTimestamp: new Date(dto.clientTimestamp),
            status: conflict ? 'CONFLICT' : 'APPLIED',
            conflictReason: conflict,
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        // The transaction aborted on the unique violation — Postgres rejects
        // any further command in that same transaction (25P02), so the
        // fallback lookup must run in a fresh transaction, not the one that
        // just failed.
        const existing = await this.tenancy.withTenant({ orgId, centreId }, (tx) =>
          tx.syncOperation.findUnique({ where: { idempotencyKey: dto.idempotencyKey } }),
        );
        // Already applied — re-submission (e.g. after a flaky network retry)
        // is a no-op, not an error. Return the original record either way.
        if (existing) return existing;
      }
      throw err;
    }
  }

  /** Returns a conflict reason string, or null if the operation is valid to apply. */
  private checkConflict(dto: SubmitOperationDto): string | null {
    if (APPEND_ONLY_ENTITY_TYPES.has(dto.entityType) && dto.operationType !== 'CREATE') {
      return 'append_only_entity_disallows_update_delete';
    }
    return null;
  }

  private async applyDomainEffect(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    orgId: string,
    centreId: string,
    dto: SubmitOperationDto,
  ): Promise<void> {
    if (dto.entityType === 'AttendanceEvent' && dto.operationType === 'CREATE') {
      const payload = dto.payload as unknown as AttendanceEventPayload;
      await this.authorization.assertCanAccessChild(user, payload.childId, 'view');
      await tx.attendanceEvent.create({
        data: {
          id: dto.entityId,
          orgId,
          centreId,
          childId: payload.childId,
          eventType: payload.eventType,
          method: payload.method,
          timestamp: new Date(payload.timestamp),
          recordedByUserId: user.userId,
        },
      });
      return;
    }

    if (dto.entityType === 'CareRecord' && dto.operationType === 'CREATE') {
      const payload = dto.payload as unknown as CareRecordPayload;
      await this.authorization.assertCanAccessChild(user, payload.childId, 'view');
      await tx.careRecord.create({
        data: {
          id: dto.entityId,
          orgId,
          centreId,
          childId: payload.childId,
          type: payload.type,
          timestamp: new Date(payload.timestamp),
          note: payload.note ?? null,
          groupEventId: payload.groupEventId ?? dto.entityId,
          recordedByUserId: user.userId,
        },
      });
      return;
    }

    // Entity types without a built domain table yet (later stages) are
    // recorded in the sync ledger only — the ledger is the durable record
    // of intent even before the feature that consumes it exists.
  }
}
