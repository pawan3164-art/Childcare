import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Message, MessageScope, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateMessageDto } from './dto/create-message.dto';

const STAFF_ROLES = ['EDUCATOR', 'CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
const LIST_LIMIT = 100;
const MAX_BODY = 4000;

export interface AnnouncementSummary {
  id: string;
  scope: MessageScope;
  roomId: string | null;
  body: string;
  createdAt: string;
  author: { firstName: string };
  acknowledgedCount: number;
}

/**
 * BRD §16: emergency broadcast is a separate high-priority path from routine
 * messages (Delivery Plan R2: "Emergency broadcast on a separate
 * high-priority path"). Only EMERGENCY scope fans out URGENT notifications
 * to every guardian in the centre; routine messages are stored for the
 * portal/app message list without a notification fan-out yet (tracked as a
 * Stage 2 simplification, not a gap in the emergency path, which is the one
 * BRD calls out as safety-relevant).
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async send(user: RequestUser, dto: CreateMessageDto): Promise<Message> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!STAFF_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only centre staff can send messages');
    }
    const body = (dto.body ?? '').trim();
    if (!body) throw new BadRequestException('An announcement needs a message');
    if (body.length > MAX_BODY) throw new BadRequestException(`Announcements are limited to ${MAX_BODY} characters`);
    // Educators speak for their own rooms only (relationship-based access, BRD §22).
    if (dto.scope === 'ROOM' && user.role === 'EDUCATOR' && dto.roomId && !(await this.authorization.activeRoomIds(user)).includes(dto.roomId)) {
      throw new ForbiddenException('You can only announce to rooms you are assigned to');
    }

    const { message, guardianUserIds } = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        if (dto.scope === 'ROOM') {
          // RLS already hides other centres' rooms; the centre filter makes the rule explicit.
          const room = dto.roomId
            ? await tx.room.findFirst({ where: { id: dto.roomId, centreId: user.centreId as string }, select: { id: true } })
            : null;
          if (!room) throw new BadRequestException('A room announcement must name a room in your centre');
        }
        const created = await tx.message.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            roomId: dto.scope === 'ROOM' ? (dto.roomId ?? null) : null,
            scope: dto.scope,
            authorUserId: user.userId,
            body,
          },
        });

        let guardians: string[] = [];
        if (dto.scope === 'EMERGENCY') {
          const relationships = await tx.guardianChildRelationship.findMany({
            where: { centreId: user.centreId as string },
            select: { guardianUserId: true },
            distinct: ['guardianUserId'],
          });
          guardians = relationships.map((r) => r.guardianUserId);
        }

        return { message: created, guardianUserIds: guardians };
      },
    );

    for (const guardianUserId of guardianUserIds) {
      await this.notifications.enqueue({
        orgId: user.orgId,
        centreId: user.centreId,
        recipientUserId: guardianUserId,
        priority: 'URGENT',
        channel: 'PUSH',
        payload: { type: 'emergency_broadcast', messageId: message.id },
      });
    }

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'message.send',
      entityType: 'Message',
      entityId: message.id,
      outcome: 'SUCCESS',
      metadata: { scope: dto.scope, notified: guardianUserIds.length },
    });

    return message;
  }

  async acknowledge(user: RequestUser, messageId: string): Promise<void> {
    if (!user.orgId) throw new ForbiddenException();

    await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.messageAcknowledgement.upsert({
        where: { messageId_userId: { messageId, userId: user.userId } },
        create: { orgId: user.orgId as string, messageId, userId: user.userId },
        update: {},
      }),
    );
  }

  /** Staff view of the centre's announcements, newest first, with how many people acknowledged each. */
  async list(user: RequestUser): Promise<AnnouncementSummary[]> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!STAFF_ROLES.includes(user.role)) throw new ForbiddenException('Only centre staff can list announcements');

    // Educators see centre-wide announcements and their own rooms', not other rooms'.
    const roomFilter: Prisma.MessageWhereInput =
      user.role === 'EDUCATOR' ? { OR: [{ scope: { not: 'ROOM' } }, { roomId: { in: await this.authorization.activeRoomIds(user) } }] } : {};
    const { messages, authors } = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const messages = await tx.message.findMany({
        where: { centreId: user.centreId as string, ...roomFilter },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
        include: { _count: { select: { acknowledgements: true } } },
      });
      const authors = await tx.user.findMany({
        where: { id: { in: [...new Set(messages.map((m) => m.authorUserId))] } },
        select: { id: true, firstName: true },
      });
      return { messages, authors: new Map(authors.map((a) => [a.id, a.firstName])) };
    });

    return messages.map((m) => ({
      id: m.id,
      scope: m.scope,
      roomId: m.roomId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      author: { firstName: authors.get(m.authorUserId) ?? 'Centre' },
      acknowledgedCount: m._count.acknowledgements,
    }));
  }
}
