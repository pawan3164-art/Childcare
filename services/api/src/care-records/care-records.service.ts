import { ForbiddenException, Injectable } from '@nestjs/common';
import { CareRecord, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateGroupCareRecordDto } from './dto/create-group-care-record.dto';
import { validateCareDetails } from './care-details';
import { startOfCentreDay } from '../common/time/centre-day';

/**
 * Working default for safe-sleep checks (open item OI-20): the required
 * interval varies by jurisdiction and service policy.
 */
export const SLEEP_CHECK_INTERVAL_MINUTES = 10;

export interface SleepStatus {
  childId: string;
  sleepingSince: string;
  lastCheckAt: string | null;
  nextCheckDueAt: string;
  overdue: boolean;
}

export interface GroupCareRecordResult {
  groupEventId: string;
  records: CareRecord[];
  skipped: string[];
}

/**
 * BRD §9: one group action produces one append-only CareRecord per child,
 * sharing a groupEventId, instead of an educator re-entering the same event
 * for every child one at a time. Each child still gets an individual
 * authorization check — being in the submitted childIds list doesn't bypass
 * the educator's actual room assignment.
 */
@Injectable()
export class CareRecordsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async createGroupEvent(
    user: RequestUser,
    dto: CreateGroupCareRecordDto,
  ): Promise<GroupCareRecordResult> {
    if (!user.orgId || !user.centreId) {
      throw new ForbiddenException('Care records require an authenticated staff user with centre context');
    }
    await this.authorization.assertRole(user, STAFF_ROLES, 'care_record.group_create');

    const groupEventId = uuidv4();
    const exceptionByChild = new Map((dto.exceptions ?? []).map((e) => [e.childId, e]));
    // Validate every child's details before writing anything, so one bad
    // override can't leave half a group event behind.
    const detailsByChild = new Map<string, Prisma.InputJsonObject | null>();
    for (const childId of dto.childIds) {
      const exception = exceptionByChild.get(childId);
      if (exception?.skip) continue;
      detailsByChild.set(childId, validateCareDetails(dto.type, exception?.details ?? dto.defaultDetails));
    }
    const skipped: string[] = [];
    const timestamp = new Date(dto.timestamp);

    // Resolved up front, outside the write transaction: a nested
    // per-child authorization transaction deadlocks the connection pool
    // under concurrent group logging.
    const allowed = await this.authorization.canAccessChildren(user, dto.childIds, 'view');

    const records = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const created: CareRecord[] = [];
        for (const childId of dto.childIds) {
          const exception = exceptionByChild.get(childId);
          if (exception?.skip) {
            skipped.push(childId);
            continue;
          }

          if (!allowed.has(childId)) {
            skipped.push(childId);
            continue;
          }

          created.push(
            await tx.careRecord.create({
              data: {
                orgId: user.orgId as string,
                centreId: user.centreId as string,
                childId,
                type: dto.type,
                timestamp,
                note: exception?.note ?? dto.defaultNote ?? null,
                details: detailsByChild.get(childId) ?? Prisma.DbNull,
                groupEventId,
                recordedByUserId: user.userId,
              },
            }),
          );
        }
        return created;
      },
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'care_record.group_create',
      entityType: 'CareRecord',
      entityId: groupEventId,
      outcome: 'SUCCESS',
      metadata: { type: dto.type, created: records.length, skipped },
    });

    return { groupEventId, records, skipped };
  }

  /**
   * Children in a room who are asleep right now (today's latest SLEEP is a
   * START with no END after it), with when their next safe-sleep check is
   * due. Drives the educator app's sleep-check reminders.
   */
  async roomSleepStatus(user: RequestUser, roomId: string): Promise<SleepStatus[]> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    await this.authorization.assertRole(user, STAFF_ROLES, 'care_record.sleep_status');

    const { childIds, records } = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const room = await tx.room.findFirst({ where: { id: roomId, centreId: user.centreId as string }, include: { centre: { select: { timezone: true } } } });
      if (!room) return { childIds: [] as string[], records: [] };
      const children = await tx.child.findMany({ where: { roomId }, select: { id: true } });
      const ids = children.map((c) => c.id);
      const recs = await tx.careRecord.findMany({
        where: { childId: { in: ids }, type: { in: ['SLEEP', 'SLEEP_CHECK'] }, timestamp: { gte: startOfCentreDay(room.centre.timezone) } },
        orderBy: { timestamp: 'asc' },
      });
      return { childIds: ids, records: recs };
    });
    const allowed = await this.authorization.canAccessChildren(user, childIds, 'view');

    const now = Date.now();
    const result: SleepStatus[] = [];
    for (const childId of childIds) {
      if (!allowed.has(childId)) continue;
      let sleepingSince: Date | null = null;
      let lastCheck: Date | null = null;
      for (const r of records) {
        if (r.childId !== childId) continue;
        const phase = (r.details as { phase?: string } | null)?.phase;
        if (r.type === 'SLEEP' && phase === 'START') {
          sleepingSince = r.timestamp;
          lastCheck = null;
        } else if (r.type === 'SLEEP' && phase === 'END') {
          sleepingSince = null;
        } else if (r.type === 'SLEEP_CHECK' && sleepingSince) {
          lastCheck = r.timestamp;
        }
      }
      if (!sleepingSince) continue;
      const due = new Date((lastCheck ?? sleepingSince).getTime() + SLEEP_CHECK_INTERVAL_MINUTES * 60 * 1000);
      result.push({
        childId,
        sleepingSince: sleepingSince.toISOString(),
        lastCheckAt: lastCheck?.toISOString() ?? null,
        nextCheckDueAt: due.toISOString(),
        overdue: now > due.getTime(),
      });
    }
    return result;
  }

  async history(user: RequestUser, childId: string): Promise<CareRecord[]> {
    if (!user.orgId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, childId, 'view');

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.careRecord.findMany({ where: { childId }, orderBy: { timestamp: 'desc' } }),
    );
  }
}
