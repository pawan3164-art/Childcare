import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Room } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateRoomDto } from './dto/create-room.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/** BRD §12 Rooms module: "Room configuration, capacity, children and educators." */
@Injectable()
export class RoomsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(user: RequestUser): Promise<Room[]> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (user.role === 'PARENT') throw new ForbiddenException();
    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      if (user.role === 'EDUCATOR') {
        // Only rooms the educator is currently assigned to (matches AuthorizationService).
        const assignments = await tx.staffRoomAssignment.findMany({
          where: { userId: user.userId, endDate: null },
          select: { roomId: true },
        });
        return tx.room.findMany({
          where: { centreId: user.centreId as string, id: { in: assignments.map((a) => a.roomId) } },
          orderBy: { name: 'asc' },
        });
      }
      return tx.room.findMany({ where: { centreId: user.centreId as string }, orderBy: { name: 'asc' } });
    });
  }

  async create(user: RequestUser, dto: CreateRoomDto): Promise<Room> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can create a room');

    const room = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.room.create({
        data: {
          orgId: user.orgId as string,
          centreId: user.centreId as string,
          name: dto.name,
          ageBandMin: dto.ageBandMinMonths ?? null,
          ageBandMax: dto.ageBandMaxMonths ?? null,
        },
      }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'room.create',
      entityType: 'Room',
      entityId: room.id,
      outcome: 'SUCCESS',
    });

    return room;
  }

  /** Staff currently assigned to a room, with who leads it (admin). */
  async staff(user: RequestUser, roomId: string): Promise<{ userId: string; firstName: string; lastName: string; isLead: boolean }[]> {
    this.assertAdmin(user);
    return this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, async (tx) => {
      const room = await tx.room.findFirst({ where: { id: roomId, centreId: user.centreId as string }, select: { id: true } });
      if (!room) throw new NotFoundException('Room not found');
      const rows = await tx.staffRoomAssignment.findMany({
        where: { roomId, endDate: null },
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { startDate: 'asc' },
      });
      return rows.map((r) => ({ userId: r.userId, firstName: r.user.firstName, lastName: r.user.lastName, isLead: r.isLead }));
    });
  }

  /** Marks (or unmarks) an assigned educator as the room's leader, who publishes its learning (OI-23). */
  async setLead(user: RequestUser, roomId: string, staffUserId: string, isLead: boolean): Promise<void> {
    this.assertAdmin(user);
    const updated = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, async (tx) => {
      const room = await tx.room.findFirst({ where: { id: roomId, centreId: user.centreId as string }, select: { id: true } });
      if (!room) throw new NotFoundException('Room not found');
      return tx.staffRoomAssignment.updateMany({ where: { roomId, userId: staffUserId, endDate: null }, data: { isLead } });
    });
    if (updated.count === 0) throw new BadRequestException('That person is not assigned to this room');
    await this.audit.record({
      orgId: user.orgId as string,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'room.lead.set',
      entityType: 'Room',
      entityId: roomId,
      outcome: 'SUCCESS',
      metadata: { staffUserId, isLead },
    });
  }

  private assertAdmin(user: RequestUser) {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only an administrator can manage room staff');
  }
}
