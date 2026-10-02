import { ForbiddenException, Injectable } from '@nestjs/common';
import { AttendanceEvent } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { RecordAttendanceDto } from './dto/record-attendance.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/**
 * Append-only at the DB level (see prisma/migrations/*_stage1_care_loop_entities).
 * Conflict rule (Delivery Plan §6.1): "attendance sign-out is server-wins with
 * an admin flag" — a correction never edits history, it's a new row flagged
 * isCorrection, linked via correctedEventId, and only an admin role may create one.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async recordEvent(user: RequestUser, dto: RecordAttendanceDto): Promise<AttendanceEvent> {
    if (!user.orgId || !user.centreId) {
      throw new ForbiddenException('Attendance requires an authenticated staff user with centre context');
    }
    await this.authorization.assertCanAccessChild(user, dto.childId, 'view');

    const event = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.attendanceEvent.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            eventType: dto.eventType,
            method: dto.method,
            timestamp: new Date(dto.timestamp),
            recordedByUserId: user.userId,
          },
        }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: `attendance.${dto.eventType.toLowerCase()}`,
      entityType: 'AttendanceEvent',
      entityId: event.id,
      outcome: 'SUCCESS',
      metadata: { childId: dto.childId, method: dto.method },
    });

    return event;
  }

  async correctEvent(
    user: RequestUser,
    originalEventId: string,
    dto: RecordAttendanceDto,
  ): Promise<AttendanceEvent> {
    if (!user.orgId || !user.centreId) {
      throw new ForbiddenException('Attendance requires an authenticated staff user with centre context');
    }
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only a centre, org, or platform administrator can correct an attendance record');
    }
    await this.authorization.assertCanAccessChild(user, dto.childId, 'view');

    const corrected = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.attendanceEvent.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            childId: dto.childId,
            eventType: dto.eventType,
            method: dto.method,
            timestamp: new Date(dto.timestamp),
            recordedByUserId: user.userId,
            isCorrection: true,
            correctedEventId: originalEventId,
          },
        }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'attendance.correct',
      entityType: 'AttendanceEvent',
      entityId: corrected.id,
      outcome: 'SUCCESS',
      metadata: { correctedEventId: originalEventId },
    });

    return corrected;
  }

  async history(user: RequestUser, childId: string): Promise<AttendanceEvent[]> {
    if (!user.orgId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, childId, 'view');

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.attendanceEvent.findMany({ where: { childId }, orderBy: { timestamp: 'asc' } }),
    );
  }
}
