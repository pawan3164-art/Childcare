import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Child } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../authorization/request-user.interface';
import { startOfCentreDay } from '../common/time/centre-day';
import { CreateChildDto } from './dto/create-child.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export interface ChildListItem {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  roomId: string | null;
  roomName: string | null;
  /** From today's events only (centre-local day). */
  attendanceStatus: 'SIGNED_IN' | 'SIGNED_OUT' | 'NO_EVENTS_TODAY';
  /** The child's last event before today was a sign-in that was never closed. */
  previousDayNotSignedOut: boolean;
}

/**
 * BRD §12 Child & Family module. Admin roles see the centre roster
 * (optionally filtered to one room); an EDUCATOR sees only children in rooms
 * they are currently assigned to (the educator app's room view filters
 * further by roomId); a PARENT sees only children they have a relationship
 * with, never the full centre list.
 */
@Injectable()
export class ChildrenService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(user: RequestUser, roomId?: string): Promise<ChildListItem[]> {
    if (!user.orgId) throw new ForbiddenException();

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      let children: (Child & { room: { name: string } | null })[];

      if (user.role === 'PARENT') {
        const relationships = await tx.guardianChildRelationship.findMany({
          // Same rule as AuthorizationService.canAccessChild: unrestricted and not expired.
          where: {
            guardianUserId: user.userId,
            isRestricted: false,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { childId: true },
        });
        children = await tx.child.findMany({
          where: { id: { in: relationships.map((r) => r.childId) } },
          include: { room: { select: { name: true } } },
          orderBy: { firstName: 'asc' },
        });
      } else if (user.role === 'EDUCATOR') {
        // Same rule as AuthorizationService.canAccessChild: only rooms the
        // educator is currently assigned to, so every listed child is openable.
        if (!user.centreId) throw new ForbiddenException();
        const assignments = await tx.staffRoomAssignment.findMany({
          where: { userId: user.userId, endDate: null },
          select: { roomId: true },
        });
        const assignedRoomIds = assignments.map((a) => a.roomId);
        const roomIds = roomId ? assignedRoomIds.filter((id) => id === roomId) : assignedRoomIds;
        children = await tx.child.findMany({
          where: { centreId: user.centreId, roomId: { in: roomIds } },
          include: { room: { select: { name: true } } },
          orderBy: { firstName: 'asc' },
        });
      } else {
        if (!user.centreId) throw new ForbiddenException();
        children = await tx.child.findMany({
          where: { centreId: user.centreId, ...(roomId ? { roomId } : {}) },
          include: { room: { select: { name: true } } },
          orderBy: { firstName: 'asc' },
        });
      }

      // Latest event today and latest event before today, per child: two
      // queries per centre (usually one centre) rather than one per child.
      const lastToday = new Map<string, string>();
      const lastBefore = new Map<string, string>();
      const centreIds = [...new Set(children.map((c) => c.centreId))];
      const centres = await tx.centre.findMany({ where: { id: { in: centreIds } }, select: { id: true, timezone: true } });
      for (const centre of centres) {
        const childIds = children.filter((c) => c.centreId === centre.id).map((c) => c.id);
        const startOfDay = startOfCentreDay(centre.timezone);
        const [today, before] = await Promise.all([
          tx.attendanceEvent.findMany({
            where: { childId: { in: childIds }, timestamp: { gte: startOfDay } },
            orderBy: [{ childId: 'asc' }, { timestamp: 'desc' }],
            distinct: ['childId'],
            select: { childId: true, eventType: true },
          }),
          tx.attendanceEvent.findMany({
            where: { childId: { in: childIds }, timestamp: { lt: startOfDay } },
            orderBy: [{ childId: 'asc' }, { timestamp: 'desc' }],
            distinct: ['childId'],
            select: { childId: true, eventType: true },
          }),
        ]);
        today.forEach((e) => lastToday.set(e.childId, e.eventType));
        before.forEach((e) => lastBefore.set(e.childId, e.eventType));
      }

      return children.map((child) => {
        const todayType = lastToday.get(child.id);
        return {
          id: child.id,
          firstName: child.firstName,
          lastName: child.lastName,
          dateOfBirth: child.dateOfBirth.toISOString().slice(0, 10),
          roomId: child.roomId,
          roomName: child.room?.name ?? null,
          attendanceStatus: !todayType ? 'NO_EVENTS_TODAY' : todayType === 'SIGN_IN' ? 'SIGNED_IN' : 'SIGNED_OUT',
          previousDayNotSignedOut: lastBefore.get(child.id) === 'SIGN_IN',
        };
      });
    });
  }

  async create(user: RequestUser, dto: CreateChildDto): Promise<Child> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can enrol a child');

    const child = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      // A room in another centre would grant that centre's educators access to this child.
      if (dto.roomId) {
        const room = await tx.room.findFirst({ where: { id: dto.roomId, centreId: user.centreId as string }, select: { id: true } });
        if (!room) throw new BadRequestException('roomId must be a room in your centre');
      }
      return tx.child.create({
        data: {
          orgId: user.orgId as string,
          centreId: user.centreId as string,
          roomId: dto.roomId ?? null,
          firstName: dto.firstName,
          lastName: dto.lastName,
          dateOfBirth: new Date(dto.dateOfBirth),
        },
      });
    });

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'child.create',
      entityType: 'Child',
      entityId: child.id,
      outcome: 'SUCCESS',
    });

    return child;
  }

  /**
   * Group-photo consent (BRD §17, see MediaService.canView). Set by one of
   * the child's own unrestricted guardians, or recorded by a centre admin on
   * the family's behalf. Educators cannot change it.
   */
  async setGroupPhotoConsent(user: RequestUser, childId: string, consent: boolean): Promise<Child> {
    if (!user.orgId) throw new ForbiddenException();

    const updated = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const child = await tx.child.findUnique({ where: { id: childId }, select: { id: true, centreId: true } });
      let allowed = false;
      if (child && user.role === 'PARENT') {
        const rel = await tx.guardianChildRelationship.findFirst({
          where: { guardianUserId: user.userId, childId, isRestricted: false, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: { id: true },
        });
        allowed = !!rel;
      } else if (child && ADMIN_ROLES.includes(user.role)) {
        allowed = user.role !== 'CENTRE_ADMIN' || child.centreId === user.centreId;
      }
      if (!allowed) return null;
      return tx.child.update({
        where: { id: childId },
        data: { groupPhotoConsent: consent, groupPhotoConsentUpdatedAt: new Date(), groupPhotoConsentUpdatedBy: user.userId },
      });
    });

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'child.groupPhotoConsent.update',
      entityType: 'Child',
      entityId: childId,
      outcome: updated ? 'SUCCESS' : 'DENIED',
      metadata: { consent },
    });
    if (!updated) throw new ForbiddenException("Only the child's guardian or a centre administrator can change photo consent");
    return updated;
  }
}
