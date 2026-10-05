import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { ADMIN_ROLES, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';

export const SLEEP_CHECK_INTERVAL_RANGE = { min: 5, max: 30 } as const;

export interface CentreSettings {
  sleepCheckIntervalMinutes: number;
}

/**
 * Per-centre operational settings. First setting: the safe-sleep check
 * interval (OI-20, decided 2026-10-05), because the required interval varies
 * by state regulator and centre policy. Bounds are also enforced by a DB check.
 */
@Injectable()
export class CentreSettingsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async get(user: RequestUser): Promise<CentreSettings> {
    const centreId = this.requireCentre(user);
    if (!STAFF_ROLES.includes(user.role)) throw new ForbiddenException('Centre settings are for staff');
    const centre = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.centre.findUniqueOrThrow({ where: { id: centreId }, select: { sleepCheckIntervalMinutes: true } }),
    );
    return { sleepCheckIntervalMinutes: centre.sleepCheckIntervalMinutes };
  }

  async update(user: RequestUser, patch: Partial<CentreSettings>): Promise<CentreSettings> {
    const centreId = this.requireCentre(user);
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only a centre admin can change centre settings');
    const minutes = patch.sleepCheckIntervalMinutes;
    if (minutes !== undefined) {
      const { min, max } = SLEEP_CHECK_INTERVAL_RANGE;
      if (!Number.isInteger(minutes) || minutes < min || minutes > max) {
        throw new BadRequestException(`The sleep-check interval must be a whole number of minutes between ${min} and ${max}`);
      }
    }
    const before = await this.get(user);
    const centre = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId }, (tx) =>
      tx.centre.update({ where: { id: centreId }, data: { ...(minutes !== undefined ? { sleepCheckIntervalMinutes: minutes } : {}) }, select: { sleepCheckIntervalMinutes: true } }),
    );
    await this.audit.record({
      orgId: user.orgId as string,
      centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'centre.settings.update',
      entityType: 'Centre',
      entityId: centreId,
      outcome: 'SUCCESS',
      metadata: { sleepCheckIntervalMinutes: { from: before.sleepCheckIntervalMinutes, to: centre.sleepCheckIntervalMinutes } },
    });
    return { sleepCheckIntervalMinutes: centre.sleepCheckIntervalMinutes };
  }

  private requireCentre(user: RequestUser): string {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    return user.centreId;
  }
}
