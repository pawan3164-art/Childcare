import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DirectThread, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_BODY = 4000;

export interface ThreadSummary {
  id: string;
  childId: string;
  childFirstName: string;
  /** Who the viewer is talking to, in words (OWNA review: make recipients obvious). */
  recipients: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: number;
}

export interface ThreadView extends ThreadSummary {
  messages: { id: string; body: string; createdAt: string; fromStaff: boolean; author: { firstName: string } }[];
}

/**
 * U1 direct messages: one thread per child per guardian, answered by the
 * staff who care for that child (the room's educators and centre admins).
 * Message text is never logged or audited; audit entries carry ids only.
 */
@Injectable()
export class DirectMessagesService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  async sendFromGuardian(user: RequestUser, childId: string, body: string): Promise<ThreadView> {
    if (user.role !== 'PARENT' || !user.orgId) throw new ForbiddenException('Only a guardian can start a conversation about their child');
    const text = this.cleanBody(body);
    await this.authorization.assertCanAccessChild(user, childId, 'view');

    const thread = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const child = await tx.child.findUniqueOrThrow({ where: { id: childId }, select: { centreId: true } });
      const now = new Date();
      const t = await tx.directThread.upsert({
        where: { childId_guardianUserId: { childId, guardianUserId: user.userId } },
        create: { orgId: user.orgId as string, centreId: child.centreId, childId, guardianUserId: user.userId, lastMessageAt: now, guardianLastReadAt: now },
        update: { lastMessageAt: now, guardianLastReadAt: now },
      });
      const message = await tx.directMessage.create({ data: { orgId: user.orgId as string, threadId: t.id, authorUserId: user.userId, fromStaff: false, body: text } });
      return { t, messageId: message.id };
    });

    await this.recordSend(user, thread.t, thread.messageId, false);
    return this.view(user, thread.t.id, { markRead: false });
  }

  async reply(user: RequestUser, threadId: string, body: string): Promise<ThreadView> {
    if (!user.orgId || !STAFF_ROLES.includes(user.role)) throw new ForbiddenException('Only centre staff can reply');
    const text = this.cleanBody(body);
    const thread = await this.loadAccessible(user, threadId);

    const messageId = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const now = new Date();
      await tx.directThread.update({ where: { id: thread.id }, data: { lastMessageAt: now, staffLastReadAt: now } });
      const m = await tx.directMessage.create({ data: { orgId: user.orgId as string, threadId: thread.id, authorUserId: user.userId, fromStaff: true, body: text } });
      return m.id;
    });

    await this.notifications.enqueue({
      orgId: user.orgId,
      centreId: thread.centreId,
      recipientUserId: thread.guardianUserId,
      priority: 'CHILD_UPDATE',
      channel: 'PUSH',
      payload: { type: 'direct_message', threadId: thread.id },
    });
    await this.recordSend(user, thread, messageId, true);
    return this.view(user, thread.id, { markRead: false });
  }

  /** Opening a thread marks it read for the viewer's side. */
  async getThread(user: RequestUser, threadId: string): Promise<ThreadView> {
    await this.loadAccessible(user, threadId);
    return this.view(user, threadId, { markRead: true });
  }

  async listThreads(user: RequestUser): Promise<ThreadSummary[]> {
    if (!user.orgId) throw new ForbiddenException();
    const isStaff = STAFF_ROLES.includes(user.role);
    if (!isStaff && user.role !== 'PARENT') return [];

    const threads = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.directThread.findMany({
        where: isStaff ? { centreId: user.centreId ?? undefined } : { guardianUserId: user.userId },
        orderBy: { lastMessageAt: 'desc' },
        take: 200,
      }),
    );
    const allowed = await this.authorization.canAccessChildren(user, [...new Set(threads.map((t) => t.childId))], 'view');
    const visible = threads.filter((t) => allowed.has(t.childId));
    return this.summaries(user, visible);
  }

  private async loadAccessible(user: RequestUser, threadId: string): Promise<DirectThread> {
    if (!user.orgId) throw new ForbiddenException();
    const thread = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) => tx.directThread.findUnique({ where: { id: threadId } }));
    if (!thread) throw new NotFoundException('Conversation not found');
    const isStaff = STAFF_ROLES.includes(user.role);
    const ownThread = user.role === 'PARENT' && thread.guardianUserId === user.userId;
    if (!isStaff && !ownThread) throw new ForbiddenException('Not your conversation');
    // Staff: must care for the child. Guardian: must still have access to them.
    await this.authorization.assertCanAccessChild(user, thread.childId, 'view');
    return thread;
  }

  private async view(user: RequestUser, threadId: string, opts: { markRead: boolean }): Promise<ThreadView> {
    const isStaff = STAFF_ROLES.includes(user.role);
    const { thread, messages } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, async (tx) => {
      let t = await tx.directThread.findUniqueOrThrow({ where: { id: threadId } });
      if (opts.markRead) {
        t = await tx.directThread.update({ where: { id: threadId }, data: isStaff ? { staffLastReadAt: new Date() } : { guardianLastReadAt: new Date() } });
      }
      const ms = await tx.directMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
      return { thread: t, messages: ms };
    });
    const [summary] = await this.summaries(user, [thread]);
    const names = await this.firstNames(user, messages.map((m) => m.authorUserId));
    return {
      ...summary,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        fromStaff: m.fromStaff,
        author: { firstName: names.get(m.authorUserId) ?? (m.fromStaff ? 'Centre staff' : 'Guardian') },
      })),
    };
  }

  private async summaries(user: RequestUser, threads: DirectThread[]): Promise<ThreadSummary[]> {
    if (threads.length === 0) return [];
    const isStaff = STAFF_ROLES.includes(user.role);
    const data = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, async (tx) => {
      const children = await tx.child.findMany({ where: { id: { in: threads.map((t) => t.childId) } }, include: { room: { select: { name: true } } } });
      const unread = await Promise.all(
        threads.map((t) => {
          const since = isStaff ? t.staffLastReadAt : t.guardianLastReadAt;
          const where: Prisma.DirectMessageWhereInput = { threadId: t.id, fromStaff: !isStaff, ...(since ? { createdAt: { gt: since } } : {}) };
          return tx.directMessage.count({ where });
        }),
      );
      const last = await Promise.all(threads.map((t) => tx.directMessage.findFirst({ where: { threadId: t.id }, orderBy: { createdAt: 'desc' }, select: { body: true } })));
      return { children: new Map(children.map((c) => [c.id, c])), unread, last };
    });
    const guardianNames = isStaff ? await this.firstNames(user, threads.map((t) => t.guardianUserId)) : new Map<string, string>();

    return threads.map((t, i) => {
      const child = data.children.get(t.childId);
      const recipients = isStaff
        ? `${guardianNames.get(t.guardianUserId) ?? 'Guardian'} (${child?.firstName ?? 'child'}'s family)`
        : child?.room
          ? `${child.room.name} educators and centre staff`
          : 'Centre staff';
      const preview = data.last[i]?.body ?? '';
      return {
        id: t.id,
        childId: t.childId,
        childFirstName: child?.firstName ?? '',
        recipients,
        lastMessageAt: t.lastMessageAt.toISOString(),
        lastMessagePreview: preview.length > 120 ? `${preview.slice(0, 117)}…` : preview,
        unread: data.unread[i],
      };
    });
  }

  private async firstNames(viewer: RequestUser, userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const users = await this.tenancy.withTenant({ orgId: viewer.orgId as string, centreId: viewer.centreId }, (tx) =>
      tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true } }),
    );
    return new Map(users.map((u) => [u.id, u.firstName]));
  }

  private cleanBody(body: string): string {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('Message is empty');
    if (text.length > MAX_BODY) throw new BadRequestException(`Messages are limited to ${MAX_BODY} characters`);
    return text;
  }

  private recordSend(user: RequestUser, thread: DirectThread, messageId: string, fromStaff: boolean) {
    return this.audit.record({
      orgId: user.orgId as string,
      centreId: thread.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'direct_message.send',
      entityType: 'DirectThread',
      entityId: thread.id,
      outcome: 'SUCCESS',
      metadata: { messageId, childId: thread.childId, fromStaff },
    });
  }
}
