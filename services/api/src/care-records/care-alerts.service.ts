import { Injectable } from '@nestjs/common';
import { CareRecord } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Safe-sleep follow-up: a SLEEP_CHECK flagged by care-details.ts (child on
 * their front, or breathing not normal) alerts the centre admins straight
 * away, whether it was logged online or arrived through offline sync. The
 * payload carries ids only. Recipients are the centre admins until the
 * responsible-person log exists (OI-21).
 */
@Injectable()
export class CareAlertsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  static isFlagged(record: Pick<CareRecord, 'type' | 'details'>): boolean {
    return record.type === 'SLEEP_CHECK' && (record.details as { flagged?: boolean } | null)?.flagged === true;
  }

  /** Call after the records are committed. Returns the ids of flagged children. */
  async alertFlaggedSleepChecks(records: CareRecord[]): Promise<string[]> {
    const flagged = records.filter((r) => CareAlertsService.isFlagged(r));
    if (flagged.length === 0) return [];
    const { orgId, centreId } = flagged[0];

    const { admins, rooms } = await this.tenancy.withTenant({ orgId, centreId }, async (tx) => {
      const admins = await tx.user.findMany({ where: { centreId, role: 'CENTRE_ADMIN' }, select: { id: true } });
      const children = await tx.child.findMany({ where: { id: { in: flagged.map((r) => r.childId) } }, select: { id: true, roomId: true } });
      return { admins, rooms: new Map(children.map((c) => [c.id, c.roomId])) };
    });

    for (const record of flagged) {
      for (const admin of admins) {
        await this.notifications.enqueue({
          orgId,
          centreId,
          recipientUserId: admin.id,
          priority: 'ACTION_REQUIRED',
          channel: 'PUSH',
          payload: { type: 'sleep_check_flagged', careRecordId: record.id, childId: record.childId, roomId: rooms.get(record.childId) ?? null },
        });
      }
    }
    return flagged.map((r) => r.childId);
  }
}
