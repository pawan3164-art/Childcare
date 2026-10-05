import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { FeedPost, MessageScope, Prisma } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { MediaService } from '../media/media.service';
import { startOfCentreDay } from '../common/time/centre-day';

const MAX_PHOTOS_PER_POST = 10;
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;

export interface FeedMedia {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export type FeedItem =
  | { kind: 'PHOTO_POST'; id: string; createdAt: string; caption: string | null; author: { firstName: string }; media: FeedMedia[] }
  | { kind: 'ANNOUNCEMENT'; id: string; createdAt: string; scope: MessageScope; body: string; author: { firstName: string }; acknowledged: boolean };

export type TimelineEntry =
  | { kind: 'ATTENDANCE'; id: string; at: string; eventType: 'SIGN_IN' | 'SIGN_OUT' }
  | { kind: 'CARE_RECORD'; id: string; at: string; type: string; note: string | null; details: unknown }
  | { kind: 'PHOTO_POST'; id: string; at: string; caption: string | null; media: FeedMedia[] };

/**
 * U1 family feed (Delivery Plan §13): photo posts and announcements in one
 * place per child, and a single-day timeline that merges attendance, care
 * records and photos. Photo visibility is never decided here: every photo in
 * a post must pass MediaService.canView, so the multi-child consent rule
 * (ADR 0004) applies unchanged.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly media: MediaService,
  ) {}

  async createPhotoPost(user: RequestUser, dto: { caption?: string; mediaAssetIds: string[] }): Promise<FeedPost> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    await this.authorization.assertRole(user, STAFF_ROLES, 'feed.post.create');
    const ids = [...new Set(dto.mediaAssetIds ?? [])];
    if (ids.length === 0 || ids.length > MAX_PHOTOS_PER_POST) {
      throw new BadRequestException(`A post needs between 1 and ${MAX_PHOTOS_PER_POST} photos`);
    }
    for (const id of ids) {
      if (!(await this.media.canView(user, id))) throw new ForbiddenException('You can only post photos you can see');
    }

    const post = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const assets = await tx.mediaAsset.findMany({ where: { id: { in: ids }, centreId: user.centreId as string }, select: { id: true, roomId: true } });
      if (assets.length !== ids.length) throw new BadRequestException('Every photo must belong to your centre');
      const rooms = [...new Set(assets.map((a) => a.roomId).filter((r): r is string => !!r))];
      return tx.feedPost.create({
        data: {
          orgId: user.orgId as string,
          centreId: user.centreId as string,
          roomId: rooms.length === 1 ? rooms[0] : null,
          authorUserId: user.userId,
          caption: dto.caption?.trim() || null,
          media: { create: ids.map((mediaAssetId, position) => ({ orgId: user.orgId as string, mediaAssetId, position })) },
        },
      });
    });

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'feed.post.create',
      entityType: 'FeedPost',
      entityId: post.id,
      outcome: 'SUCCESS',
      metadata: { mediaAssetIds: ids },
    });
    return post;
  }

  /** Newest first. Page with `before` = the previous page's `nextBefore`. */
  async childFeed(user: RequestUser, childId: string, opts: { before?: string; limit?: number }): Promise<{ items: FeedItem[]; nextBefore: string | null }> {
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const before = opts.before ? new Date(opts.before) : new Date();
    if (Number.isNaN(before.getTime())) throw new BadRequestException('before must be an ISO date-time');

    const { posts, messages, acknowledged } = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, async (tx) => {
      const child = await tx.child.findUniqueOrThrow({ where: { id: childId }, select: { id: true, centreId: true, roomId: true } });
      const posts = await this.postsTaggingChild(tx, childId, { lt: before }, limit * 2, 'desc');
      const messages = await tx.message.findMany({
        where: {
          centreId: child.centreId,
          createdAt: { lt: before },
          OR: [{ scope: { in: ['CENTRE', 'EMERGENCY'] } }, ...(child.roomId ? [{ scope: 'ROOM' as const, roomId: child.roomId }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      const acks = await tx.messageAcknowledgement.findMany({
        where: { userId: user.userId, messageId: { in: messages.map((m) => m.id) } },
        select: { messageId: true },
      });
      return { posts, messages, acknowledged: new Set(acks.map((a) => a.messageId)) };
    });

    const authors = await this.authorNames([...posts.map((p) => p.authorUserId), ...messages.map((m) => m.authorUserId)], user);
    const items: FeedItem[] = [];
    for (const post of posts) {
      const media = await this.visibleMedia(user, post.media.map((m) => m.mediaAssetId));
      if (!media) continue;
      items.push({ kind: 'PHOTO_POST', id: post.id, createdAt: post.createdAt.toISOString(), caption: post.caption, author: { firstName: authors.get(post.authorUserId) ?? 'Educator' }, media });
    }
    for (const m of messages) {
      items.push({
        kind: 'ANNOUNCEMENT',
        id: m.id,
        createdAt: m.createdAt.toISOString(),
        scope: m.scope,
        body: m.body,
        author: { firstName: authors.get(m.authorUserId) ?? 'Centre' },
        acknowledged: acknowledged.has(m.id),
      });
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = items.slice(0, limit);
    return { items: page, nextBefore: page.length === limit ? page[page.length - 1].createdAt : null };
  }

  /** One centre-local day for one child, oldest first. `date` is YYYY-MM-DD; defaults to today. */
  async childTimeline(user: RequestUser, childId: string, date?: string): Promise<{ date: string; entries: TimelineEntry[] }> {
    await this.authorization.assertCanAccessChild(user, childId, 'view');
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');

    const data = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, async (tx) => {
      const child = await tx.child.findUniqueOrThrow({ where: { id: childId }, include: { centre: { select: { timezone: true } } } });
      const tz = child.centre.timezone;
      // Midday UTC on the requested date is inside that calendar day in every Australian zone.
      const start = startOfCentreDay(tz, date ? new Date(`${date}T12:00:00Z`) : new Date());
      const end = startOfCentreDay(tz, new Date(start.getTime() + 36 * 3600 * 1000));
      const range = { gte: start, lt: end };
      const [attendance, care, posts] = await Promise.all([
        tx.attendanceEvent.findMany({ where: { childId, timestamp: range }, orderBy: { timestamp: 'asc' } }),
        tx.careRecord.findMany({ where: { childId, timestamp: range }, orderBy: { timestamp: 'asc' } }),
        this.postsTaggingChild(tx, childId, range, 50, 'asc'),
      ]);
      const dayLabel = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(start.getTime() + 12 * 3600 * 1000);
      return { attendance, care, posts, dayLabel };
    });

    const entries: TimelineEntry[] = [
      ...data.attendance.map((e) => ({ kind: 'ATTENDANCE' as const, id: e.id, at: e.timestamp.toISOString(), eventType: e.eventType })),
      ...data.care.map((r) => ({ kind: 'CARE_RECORD' as const, id: r.id, at: r.timestamp.toISOString(), type: r.type, note: r.note, details: (r as { details?: unknown }).details ?? null })),
    ];
    for (const post of data.posts) {
      const media = await this.visibleMedia(user, post.media.map((m) => m.mediaAssetId));
      if (media) entries.push({ kind: 'PHOTO_POST', id: post.id, at: post.createdAt.toISOString(), caption: post.caption, media });
    }
    entries.sort((a, b) => a.at.localeCompare(b.at));
    return { date: data.dayLabel, entries };
  }

  private async postsTaggingChild(
    tx: Prisma.TransactionClient,
    childId: string,
    createdAt: { lt?: Date; gte?: Date },
    take: number,
    order: 'asc' | 'desc',
  ) {
    const tagged = await tx.mediaAssetChildTag.findMany({ where: { childId }, select: { mediaAssetId: true } });
    if (tagged.length === 0) return [];
    return tx.feedPost.findMany({
      where: { createdAt, media: { some: { mediaAssetId: { in: tagged.map((t) => t.mediaAssetId) } } } },
      include: { media: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: order },
      take,
    });
  }

  /** All photos with view URLs, or null if the viewer may not see every one (then the whole post is hidden). */
  private async visibleMedia(user: RequestUser, mediaAssetIds: string[]): Promise<FeedMedia[] | null> {
    for (const id of mediaAssetIds) {
      if (!(await this.media.canView(user, id))) return null;
    }
    const assets = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, (tx) =>
      tx.mediaAsset.findMany({ where: { id: { in: mediaAssetIds } }, select: { id: true, width: true, height: true } }),
    );
    const byId = new Map(assets.map((a) => [a.id, a]));
    const result: FeedMedia[] = [];
    for (const id of mediaAssetIds) {
      const { url } = await this.media.getViewUrl(user, id);
      result.push({ id, url, width: byId.get(id)?.width ?? null, height: byId.get(id)?.height ?? null });
    }
    return result;
  }

  private async authorNames(userIds: string[], viewer: RequestUser): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const users = await this.tenancy.withTenant({ orgId: viewer.orgId as string, centreId: viewer.centreId }, (tx) =>
      tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true } }),
    );
    return new Map(users.map((u) => [u.id, u.firstName]));
  }
}
