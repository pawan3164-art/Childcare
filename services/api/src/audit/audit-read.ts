import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RequestUser } from '../authorization/request-user.interface';
import { AuditService } from './audit.service';

export const AUDIT_READ_KEY = 'audit:read';

export interface AuditReadMeta {
  resource: string;
  entityType: string | null;
  idParam: string | null;
}

/**
 * Marks a GET route whose successful reads must be audited (BRD §18, OI-18):
 * who looked at which child's care, medical, billing or family records.
 * Only ids and counts are recorded, never the data that was read.
 */
export const AuditRead = (resource: string, opts?: { entityType?: string; idParam?: string }) =>
  SetMetadata(AUDIT_READ_KEY, { resource, entityType: opts?.entityType ?? null, idParam: opts?.idParam ?? null } satisfies AuditReadMeta);

export interface AuditReadSpec {
  resource: string;
  entityType: string | null;
  entityId: string | null;
  count?: number;
}

const PRUNE_ABOVE = 10_000;

/**
 * Writes one audit entry per person, record and window. Apps poll (timelines,
 * lists), so identical reads inside the window collapse to one entry; otherwise
 * the log would fill with refreshes. A failing audit write never breaks a read.
 */
@Injectable()
export class AuditReadService {
  /** key -> time (ms) of the entry that covers it. Kept in memory: one entry per window per process is enough. */
  private readonly written = new Map<string, number>();

  constructor(private readonly audit: AuditService) {}

  async record(user: RequestUser | undefined, spec: AuditReadSpec, now: Date = new Date()): Promise<void> {
    if (!user?.orgId) return;

    const windowMs = Number(process.env.AUDIT_READ_DEDUP_SECONDS ?? 300) * 1000;
    const key = `${user.userId}|${spec.resource}|${spec.entityId ?? '-'}`;
    const last = this.written.get(key);
    if (last !== undefined && now.getTime() - last < windowMs) return;

    // Claim the key before the first await so concurrent identical reads write one entry.
    this.written.set(key, now.getTime());
    if (this.written.size > PRUNE_ABOVE) this.prune(now.getTime(), windowMs);

    try {
      await this.audit.record({
        orgId: user.orgId,
        centreId: user.centreId,
        actorUserId: user.userId,
        actorRole: user.role,
        action: `read.${spec.resource}`,
        entityType: spec.entityType ?? 'Resource',
        entityId: spec.entityId,
        outcome: 'SUCCESS',
        ...(spec.count !== undefined ? { metadata: { count: spec.count } } : {}),
      });
    } catch {
      // Not written, so let the next read try again.
      this.written.delete(key);
    }
  }

  private prune(nowMs: number, windowMs: number): void {
    for (const [key, at] of this.written) if (nowMs - at >= windowMs) this.written.delete(key);
  }
}

@Injectable()
export class AuditReadInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly reads: AuditReadService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditReadMeta | undefined>(AUDIT_READ_KEY, context.getHandler());
    if (!meta) return next.handle();

    return next.handle().pipe(
      tap((result: unknown) => {
        // After success only (a refused read is already audited as DENIED), and never able to fail the response.
        try {
          const req = context.switchToHttp().getRequest<{ user?: RequestUser; params?: Record<string, string> }>();
          const items = (result as { items?: unknown } | null | undefined)?.items;
          const count = Array.isArray(result) ? result.length : Array.isArray(items) ? items.length : undefined;
          const entityId = meta.idParam ? (req.params?.[meta.idParam] ?? null) : null;
          this.reads.record(req.user, { resource: meta.resource, entityType: meta.entityType, entityId, count }).catch(() => {});
        } catch {
          /* ignore */
        }
      }),
    );
  }
}
