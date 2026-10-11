import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { startOfCentreDay } from '../common/time/centre-day';
import { CheckInCodeService } from './checkin-code.service';

const CENTRE_ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const MAX_DENIED = 5;
const DENIED_WINDOW_MS = 10 * 60_000;

/**
 * Parent digital sign-in and sign-out (PAR-015). A guardian with pickup rights proves they are at the centre with
 * the rotating check-in code staff can see. The time is always the server's, never the app's, because attendance
 * feeds CCS claims. Wrong codes are audited (ids only, never the code) and rate limited per user.
 */
@Injectable()
export class SelfSignInService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly codes: CheckInCodeService,
  ) {}

  async currentCode(staff: RequestUser, now: Date = new Date()): Promise<{ code: string; validForSeconds: number }> {
    if (!staff.orgId || !staff.centreId) throw new ForbiddenException('Requires a staff user with centre context');
    await this.authorization.assertRole(staff, STAFF_ROLES, 'attendance.checkin_code');
    return this.codes.codeFor(staff.centreId, now);
  }

  async getParentSelfSignIn(staff: RequestUser): Promise<{ enabled: boolean }> {
    if (!staff.orgId || !staff.centreId) throw new ForbiddenException('Requires a staff user with centre context');
    await this.authorization.assertRole(staff, STAFF_ROLES, 'attendance.checkin_code');
    const centreId = staff.centreId;
    const centre = await this.tenancy.withTenant({ orgId: staff.orgId, centreId }, (tx) =>
      tx.centre.findFirst({ where: { id: centreId }, select: { parentSelfSignIn: true } }),
    );
    return { enabled: centre?.parentSelfSignIn ?? false };
  }

  async setParentSelfSignIn(admin: RequestUser, enabled: boolean): Promise<{ enabled: boolean }> {
    if (!admin.orgId || !admin.centreId) throw new ForbiddenException('Requires an administrator with centre context');
    if (!CENTRE_ADMIN_ROLES.includes(admin.role)) throw new ForbiddenException('Only an administrator can change this setting');
    const centreId = admin.centreId;
    const updated = await this.tenancy.withTenant({ orgId: admin.orgId, centreId }, (tx) =>
      tx.centre.updateMany({ where: { id: centreId, orgId: admin.orgId as string }, data: { parentSelfSignIn: enabled } }),
    );
    if (updated.count !== 1) throw new ForbiddenException('Centre not found');
    await this.audit.record({
      orgId: admin.orgId,
      centreId,
      actorUserId: admin.userId,
      actorRole: admin.role,
      action: 'centre.self_sign_in_set',
      entityType: 'Centre',
      entityId: centreId,
      outcome: 'SUCCESS',
      metadata: { enabled },
    });
    return { enabled };
  }

  async selfSignIn(
    user: RequestUser,
    childId: string,
    input: { eventType: 'SIGN_IN' | 'SIGN_OUT'; code: string },
    now: Date = new Date(),
  ): Promise<{ id: string; childId: string; eventType: string; method: 'PIN'; timestamp: string }> {
    if (user.role !== 'PARENT' || !user.orgId) throw new ForbiddenException('Only a parent or guardian can sign a child in from the app');
    const orgId = user.orgId;

    const child = await this.tenancy.withTenant({ orgId, centreId: user.centreId }, (tx) =>
      tx.child.findFirst({
        where: { id: childId },
        select: { id: true, centreId: true, departedOn: true, centre: { select: { parentSelfSignIn: true, timezone: true } } },
      }),
    );
    if (!child) throw new NotFoundException('Child not found');
    if (!child.centre.parentSelfSignIn) {
      throw new ForbiddenException('Your centre has not turned on sign-in from the app');
    }
    await this.authorization.assertCanAccessChild(user, childId, 'pickup');
    if (child.departedOn) throw new BadRequestException('This child has left the centre');

    const denied = await this.tenancy.withTenant({ orgId, centreId: child.centreId }, (tx) =>
      tx.auditLogEntry.count({
        where: {
          actorUserId: user.userId,
          action: 'attendance.self_sign_in',
          outcome: 'DENIED',
          timestamp: { gte: new Date(now.getTime() - DENIED_WINDOW_MS), lte: now },
        },
      }),
    );
    if (denied >= MAX_DENIED) throw new ForbiddenException('Too many wrong codes. Please wait a few minutes');

    if (!this.codes.isValid(child.centreId, input.code, now)) {
      await this.audit.record({
        orgId,
        centreId: child.centreId,
        actorUserId: user.userId,
        actorRole: user.role,
        action: 'attendance.self_sign_in',
        entityType: 'Child',
        entityId: childId,
        outcome: 'DENIED',
        metadata: { childId },
      });
      throw new ForbiddenException('That code is not right or has expired');
    }

    const startOfDay = startOfCentreDay(child.centre.timezone, now);
    const event = await this.tenancy.withTenant({ orgId, centreId: child.centreId }, async (tx) => {
      // One lock per child so two taps (or two guardians) cannot both pass the state check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('self-sign-in'), hashtext(${childId}))`;
      const latest = await tx.attendanceEvent.findFirst({
        where: { childId, timestamp: { gte: startOfDay } },
        orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
        select: { eventType: true },
      });
      if (input.eventType === 'SIGN_IN' && latest?.eventType === 'SIGN_IN') throw new ConflictException('This child is already signed in');
      if (input.eventType === 'SIGN_OUT' && latest?.eventType !== 'SIGN_IN') throw new ConflictException('This child is not signed in');
      return tx.attendanceEvent.create({
        data: {
          orgId,
          centreId: child.centreId,
          childId,
          eventType: input.eventType,
          method: 'PIN',
          timestamp: now,
          recordedByUserId: user.userId,
        },
      });
    });

    await this.audit.record({
      orgId,
      centreId: child.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'attendance.self_sign_in',
      entityType: 'AttendanceEvent',
      entityId: event.id,
      outcome: 'SUCCESS',
      metadata: { childId, eventType: input.eventType, method: 'PIN' },
    });
    return { id: event.id, childId, eventType: input.eventType, method: 'PIN', timestamp: now.toISOString() };
  }
}
