import { ForbiddenException, Injectable } from '@nestjs/common';
import { Child } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateChildDto } from './dto/create-child.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

export interface ChildListItem {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  roomId: string | null;
  roomName: string | null;
  attendanceStatus: 'SIGNED_IN' | 'SIGNED_OUT' | 'NO_EVENTS_TODAY';
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

      const results: ChildListItem[] = [];
      for (const child of children) {
        const lastEvent = await tx.attendanceEvent.findFirst({
          where: { childId: child.id },
          orderBy: { timestamp: 'desc' },
        });
        results.push({
          id: child.id,
          firstName: child.firstName,
          lastName: child.lastName,
          dateOfBirth: child.dateOfBirth.toISOString().slice(0, 10),
          roomId: child.roomId,
          roomName: child.room?.name ?? null,
          attendanceStatus: !lastEvent
            ? 'NO_EVENTS_TODAY'
            : lastEvent.eventType === 'SIGN_IN'
              ? 'SIGNED_IN'
              : 'SIGNED_OUT',
        });
      }
      return results;
    });
  }

  async create(user: RequestUser, dto: CreateChildDto): Promise<Child> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can enrol a child');

    const child = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.child.create({
        data: {
          orgId: user.orgId as string,
          centreId: user.centreId as string,
          roomId: dto.roomId ?? null,
          firstName: dto.firstName,
          lastName: dto.lastName,
          dateOfBirth: new Date(dto.dateOfBirth),
        },
      }),
    );

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
}
