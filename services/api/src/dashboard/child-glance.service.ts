import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';

export interface ChildAtAGlance {
  child: { id: string; firstName: string; lastName: string; roomName: string | null };
  attendance: { status: 'SIGNED_IN' | 'SIGNED_OUT' | 'NO_EVENTS_TODAY'; lastEventAt: string | null };
  todaysCareRecords: { type: string; timestamp: string; note: string | null }[];
}

/**
 * Backs the "Parent — Child at a Glance" screen (BRD §6.1): one consolidated
 * view instead of the parent navigating multiple modules. Pure read-side
 * aggregation over Stage 1 data (attendance + care records); photos,
 * messages, learning and billing join this view in later stages.
 */
@Injectable()
export class ChildGlanceService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly authorization: AuthorizationService,
  ) {}

  async get(user: RequestUser, childId: string): Promise<ChildAtAGlance> {
    if (!user.orgId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, childId, 'view');

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const child = await tx.child.findUniqueOrThrow({ where: { id: childId }, include: { room: true } });

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [lastAttendanceEvent, todaysCareRecords] = await Promise.all([
        tx.attendanceEvent.findFirst({
          where: { childId },
          orderBy: { timestamp: 'desc' },
        }),
        tx.careRecord.findMany({
          where: { childId, timestamp: { gte: startOfDay } },
          orderBy: { timestamp: 'asc' },
        }),
      ]);

      const status = !lastAttendanceEvent
        ? 'NO_EVENTS_TODAY'
        : lastAttendanceEvent.eventType === 'SIGN_IN'
          ? 'SIGNED_IN'
          : 'SIGNED_OUT';

      return {
        child: {
          id: child.id,
          firstName: child.firstName,
          lastName: child.lastName,
          roomName: child.room?.name ?? null,
        },
        attendance: {
          status,
          lastEventAt: lastAttendanceEvent?.timestamp.toISOString() ?? null,
        },
        todaysCareRecords: todaysCareRecords.map((r) => ({
          type: r.type,
          timestamp: r.timestamp.toISOString(),
          note: r.note,
        })),
      };
    });
  }
}
