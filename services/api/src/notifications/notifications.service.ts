import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationPriority } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { PUSH_PROVIDER, PushProvider } from './providers/push-provider.interface';

export interface EnqueueNotificationInput {
  orgId: string;
  centreId?: string | null;
  recipientUserId: string;
  priority: NotificationPriority;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
}

/**
 * Every notification tracks sent/delivered/opened/acknowledged — this is how
 * the BRD §25 "99%+ critical notification delivery" KPI gets measured later.
 * Digest/fallback/preferences logic lands in Stage 2; this is the skeleton.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
  ) {}

  async enqueue(input: EnqueueNotificationInput) {
    return this.tenancy.withTenant({ orgId: input.orgId, centreId: input.centreId }, (tx) =>
      tx.notificationQueueItem.create({
        data: {
          orgId: input.orgId,
          centreId: input.centreId ?? null,
          recipientUserId: input.recipientUserId,
          priority: input.priority,
          channel: input.channel,
          payload: input.payload as never,
          status: 'QUEUED',
        },
      }),
    );
  }

  async sendQueued(orgId: string, centreId: string | null, notificationId: string) {
    return this.tenancy.withTenant({ orgId, centreId }, async (tx) => {
      const item = await tx.notificationQueueItem.findUniqueOrThrow({ where: { id: notificationId } });
      const result = await this.pushProvider.send(item.recipientUserId, item.payload as Record<string, unknown>);
      return tx.notificationQueueItem.update({
        where: { id: notificationId },
        data: { status: result.sent ? 'SENT' : 'FAILED', sentAt: result.sent ? new Date() : null },
      });
    });
  }
}
