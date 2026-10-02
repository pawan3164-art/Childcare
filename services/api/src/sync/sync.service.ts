import { Injectable } from '@nestjs/common';
import { Prisma, SyncOperation } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { RequestUser } from '../authorization/request-user.interface';
import { SubmitOperationDto } from './dto/submit-operation.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Stage 0 skeleton: records each client operation exactly once, keyed by
 * idempotencyKey. Applying the operation's effect to actual domain tables
 * (attendance, care records, etc.) and per-entity conflict rules (server-wins,
 * hard-conflict, last-writer-wins — see Delivery Plan §6.1) land in Stage 1
 * alongside those entities. This module's job is the exactly-once guarantee
 * re-submission safety that everything else builds on.
 */
@Injectable()
export class SyncService {
  constructor(private readonly tenancy: TenancyService) {}

  async submit(user: RequestUser, dto: SubmitOperationDto): Promise<SyncOperation> {
    if (!user.orgId || !user.centreId) {
      throw new Error('Sync requires an authenticated user with org and centre context');
    }

    const orgId = user.orgId;
    const centreId = user.centreId;

    try {
      return await this.tenancy.withTenant({ orgId, centreId }, (tx) =>
        tx.syncOperation.create({
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
            status: 'APPLIED',
          },
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        // The create's transaction aborted on the unique violation — Postgres
        // rejects any further command in that same transaction (25P02), so
        // the fallback lookup must run in a fresh transaction, not the one
        // that just failed.
        const existing = await this.tenancy.withTenant({ orgId, centreId }, (tx) =>
          tx.syncOperation.findUnique({ where: { idempotencyKey: dto.idempotencyKey } }),
        );
        // Already applied — re-submission (e.g. after a flaky network retry)
        // is a no-op, not an error. Return the original record so the
        // client can confirm the same outcome either way.
        if (existing) return existing;
      }
      throw err;
    }
  }
}
