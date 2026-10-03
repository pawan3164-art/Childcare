import { ForbiddenException, Injectable } from '@nestjs/common';
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
    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.room.findMany({ where: { centreId: user.centreId as string }, orderBy: { name: 'asc' } }),
    );
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
}
