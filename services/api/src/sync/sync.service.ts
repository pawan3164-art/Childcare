import { Injectable } from '@nestjs/common';
import { ChecklistCompletion, Prisma, SyncOperation } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { SubmitOperationDto } from './dto/submit-operation.dto';
import { validateCareDetails } from '../care-records/care-details';
import { ChecklistsService, CompleteChecklistInput, PreparedCompletion } from '../checklists/checklists.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Entity types whose domain tables are append-only at the DB level (see the
 * Stage 0/1 RLS migrations) — a sync operation requesting UPDATE or DELETE
 * against one of these is a conflict, not a valid replay. */
const APPEND_ONLY_ENTITY_TYPES = new Set(['AttendanceEvent', 'CareRecord', 'ChecklistCompletion']);

interface AttendanceEventPayload {
  childId: string;
  eventType: 'SIGN_IN' | 'SIGN_OUT';
  method: 'KIOSK' | 'QR' | 'PIN' | 'EDUCATOR';
  timestamp: string;
}

interface CareRecordPayload {
  childId: string;
  type: 'MEAL' | 'SLEEP' | 'TOILETING' | 'BOTTLE' | 'ACTIVITY' | 'NAPPY' | 'SUNSCREEN' | 'SLEEP_CHECK';
  timestamp: string;
  note?: string;
  details?: Record<string, unknown>;
  groupEventId?: string;
}

interface AppliedEffectAudit {
  action: string;
  entityType: string;
  entityId: string;
  childId: string;
}

/**
 * Records each client operation exactly once (idempotencyKey), then applies
 * its effect to the actual domain table per Delivery Plan §6.1's per-entity
 * conflict rules. The client-generated entityId becomes the row's primary
 * key, so the same op replayed via two paths (e.g. direct API call and a
 * delayed offline-sync flush) converges on one row, not two.
 *
 * Audit logging: a write applied via sync is audited exactly like the same
 * write via the direct REST path (AttendanceService, CareRecordsService),
 * using the same action-name convention — a compliance reviewer must not be
 * able to tell, from a gap in the audit log, that a record arrived offline.
 * The audit call happens AFTER the transaction commits (not inside it), so a
 * domain write that rolls back can never leave behind an audit entry for
 * something that didn't actually happen.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly checklists: ChecklistsService,
  ) {}

  async submit(user: RequestUser, dto: SubmitOperationDto): Promise<SyncOperation> {
    const orgId = user.orgId;
    const centreId = user.centreId;
    if (!orgId || !centreId) {
      throw new Error('Sync requires an authenticated user with org and centre context');
    }

    let auditEntry: AppliedEffectAudit | null = null;
    let checklistCreated: ChecklistCompletion | null = null;
    const conflict = this.checkConflict(dto);
    const prepared = conflict ? undefined : await this.authorizeDomainEffect(user, dto);

    let result: SyncOperation;
    try {
      result = await this.tenancy.withTenant({ orgId, centreId }, async (tx) => {

        if (prepared?.checklist) {
          checklistCreated = await this.checklists.insertCompletion(tx, prepared.checklist);
        } else if (!conflict) {
          auditEntry = await this.applyDomainEffect(tx, user, orgId, centreId, dto);
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

    if (auditEntry) {
      const entry: AppliedEffectAudit = auditEntry;
      await this.audit.record({
        orgId,
        centreId,
        actorUserId: user.userId,
        actorRole: user.role,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        outcome: 'SUCCESS',
        metadata: { childId: entry.childId, viaOfflineSync: true },
      });
    }

    if (checklistCreated) {
      // Audit and failure alerts after commit, same as the direct REST path.
      await this.checklists.afterCompletion(user, checklistCreated, { viaOfflineSync: true });
    }

    return result;
  }

  /** Returns a conflict reason string, or null if the operation is valid to apply. */
  private checkConflict(dto: SubmitOperationDto): string | null {
    if (APPEND_ONLY_ENTITY_TYPES.has(dto.entityType) && dto.operationType !== 'CREATE') {
      return 'append_only_entity_disallows_update_delete';
    }
    return null;
  }

  /**
   * Role and child-access checks for an operation's domain effect. Runs
   * before submit() opens its transaction: these checks use their own
   * short transactions (and DENIED audit writes), and nesting them inside
   * the write transaction deadlocks the connection pool under concurrent
   * device flushes (Stage 5 load test, 2026-10-04).
   */
  private async authorizeDomainEffect(user: RequestUser, dto: SubmitOperationDto): Promise<{ checklist?: PreparedCompletion }> {
    if (dto.operationType !== 'CREATE') return {};
    if (dto.entityType === 'ChecklistCompletion') {
      // Validation and room access live in ChecklistsService so both paths enforce the same rules.
      const payload = dto.payload as unknown as Omit<CompleteChecklistInput, 'id'>;
      return { checklist: await this.checklists.prepareCompletion(user, { ...payload, id: dto.entityId }) };
    }
    if (dto.entityType === 'AttendanceEvent') {
      await this.authorization.assertRole(user, STAFF_ROLES, 'attendance.record');
      const payload = dto.payload as unknown as AttendanceEventPayload;
      await this.authorization.assertCanAccessChild(user, payload.childId, 'view');
    } else if (dto.entityType === 'CareRecord') {
      await this.authorization.assertRole(user, STAFF_ROLES, 'care_record.group_create');
      const payload = dto.payload as unknown as CareRecordPayload;
      await this.authorization.assertCanAccessChild(user, payload.childId, 'view');
    }
    return {};
  }

  /** Applies an already-authorized operation (see authorizeDomainEffect) inside submit()'s transaction. */
  private async applyDomainEffect(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    orgId: string,
    centreId: string,
    dto: SubmitOperationDto,
  ): Promise<AppliedEffectAudit | null> {
    if (dto.entityType === 'AttendanceEvent' && dto.operationType === 'CREATE') {
      const payload = dto.payload as unknown as AttendanceEventPayload;
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
      return {
        action: `attendance.${payload.eventType.toLowerCase()}`,
        entityType: 'AttendanceEvent',
        entityId: dto.entityId,
        childId: payload.childId,
      };
    }

    if (dto.entityType === 'CareRecord' && dto.operationType === 'CREATE') {
      const payload = dto.payload as unknown as CareRecordPayload;
      await tx.careRecord.create({
        data: {
          id: dto.entityId,
          orgId,
          centreId,
          childId: payload.childId,
          type: payload.type,
          timestamp: new Date(payload.timestamp),
          note: payload.note ?? null,
          details: validateCareDetails(payload.type, payload.details) ?? Prisma.DbNull,
          groupEventId: payload.groupEventId ?? dto.entityId,
          recordedByUserId: user.userId,
        },
      });
      return {
        action: 'care_record.group_create',
        entityType: 'CareRecord',
        entityId: dto.entityId,
        childId: payload.childId,
      };
    }

    // Entity types without a built domain table yet (later stages) are
    // recorded in the sync ledger only — the ledger is the durable record
    // of intent even before the feature that consumes it exists. Nothing to
    // audit yet since nothing was actually applied.
    return null;
  }
}
