import { ForbiddenException, Injectable } from '@nestjs/common';
import { Message } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestUser } from '../authorization/request-user.interface';
import { CreateMessageDto } from './dto/create-message.dto';

const STAFF_ROLES = ['EDUCATOR', 'CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

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
  ) {}

  async send(user: RequestUser, dto: CreateMessageDto): Promise<Message> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!STAFF_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only centre staff can send messages');
    }

    const { message, guardianUserIds } = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const created = await tx.message.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            roomId: dto.roomId ?? null,
            scope: dto.scope,
            authorUserId: user.userId,
            body: dto.body,
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
}
