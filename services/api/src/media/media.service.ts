import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MediaAsset } from '@prisma/client';
import sharp, { OutputInfo } from 'sharp';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, STAFF_ROLES } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { RegisterMediaDto } from './dto/register-media.dto';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const VIEW_URL_TTL_SECONDS = 300;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Decoded formats accepted, checked on the bytes (the declared type is client-controlled). */
const ALLOWED_FORMATS = ['jpeg', 'png', 'webp'];
/** About 50 megapixels: well above any phone camera, far below a decompression bomb. */
const MAX_INPUT_PIXELS = 50_000_000;
export const MAX_TAGGED_CHILDREN = 30;
/** Longest edge kept after upload; larger photos are scaled down. */
const MAX_EDGE_PX = 2560;

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * BRD §17: "media with several children shows to a family only if every
 * tagged child's permissions allow it." canView() below is the one place
 * that rule is enforced — get this function right and the rest of the
 * media pipeline (whatever stores/serves the actual bytes) can trust it.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * ADR 0004 upload: check the uploader may tag every child, then re-encode
   * the image (applying, then dropping, EXIF orientation; sharp writes no
   * EXIF/GPS/XMP unless asked), store it under the tenant's prefix and
   * record the asset. Nothing is stored if any check or the decode fails.
   */
  async upload(user: RequestUser, file: UploadedFile, dto: { childIds: string[]; roomId?: string }): Promise<MediaAsset> {
    if (!user.orgId || !user.centreId) {
      throw new ForbiddenException('Media upload requires an authenticated staff user with centre context');
    }
    await this.authorization.assertRole(user, STAFF_ROLES, 'media.upload');
    if (!dto.childIds?.length) throw new BadRequestException('Tag at least one child');
    if (dto.childIds.length > MAX_TAGGED_CHILDREN) throw new BadRequestException(`A photo can tag at most ${MAX_TAGGED_CHILDREN} children`);
    await this.assertUploadRoom(user, dto.roomId);
    for (const childId of dto.childIds) {
      await this.authorization.assertCanAccessChild(user, childId, 'view');
    }
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type ${file.mimetype}; upload a JPEG, PNG or WebP photo`);
    }
    if (file.size > MAX_UPLOAD_BYTES || file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Photos must be 15 MB or smaller');
    }

    // Sniff the real format before decoding: sharp would otherwise decode SVG,
    // TIFF, HEIF etc. regardless of the declared type.
    let format: string | undefined;
    try {
      format = (await sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
    } catch {
      throw new BadRequestException('The file could not be read as an image');
    }
    if (!format || !ALLOWED_FORMATS.includes(format)) {
      throw new BadRequestException('Unsupported image; upload a JPEG, PNG or WebP photo');
    }

    let processed: { data: Buffer; info: OutputInfo };
    try {
      processed = await sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException('The file could not be read as an image');
    }

    const storageKey = `org/${user.orgId}/centre/${user.centreId}/media/${randomUUID()}.jpg`;
    await this.storage.put(storageKey, processed.data, 'image/jpeg');

    let asset: MediaAsset;
    try {
      asset = await this.createAsset(user, {
        storageKey,
        roomId: dto.roomId,
        childIds: dto.childIds,
        contentType: 'image/jpeg',
        byteSize: processed.data.length,
        width: processed.info.width,
        height: processed.info.height,
      });
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'media.upload',
      entityType: 'MediaAsset',
      entityId: asset.id,
      outcome: 'SUCCESS',
      metadata: { childIds: dto.childIds, byteSize: processed.data.length },
    });
    return asset;
  }

  /**
   * A short-lived URL for the photo, issued only if canView() allows it.
   * Every view and every refusal is audit-logged, since child media is the
   * most sensitive thing a parent can open.
   */
  async getViewUrl(user: RequestUser, mediaAssetId: string): Promise<{ url: string; expiresInSeconds: number }> {
    if (!user.orgId) throw new ForbiddenException('Not authorized to view this media');
    const allowed = await this.canView(user, mediaAssetId);
    const auditBase = {
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'media.view',
      entityType: 'MediaAsset',
      entityId: mediaAssetId,
    };
    if (!allowed) {
      await this.audit.record({ ...auditBase, outcome: 'DENIED' });
      throw new ForbiddenException('Not authorized to view this media');
    }
    const asset = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaAssetId } }),
    );
    if (!asset.contentType) throw new NotFoundException('This media item has no stored file');

    const url = await this.storage.presignGet(asset.storageKey, VIEW_URL_TTL_SECONDS);
    await this.audit.record({ ...auditBase, outcome: 'SUCCESS' });
    return { url, expiresInSeconds: VIEW_URL_TTL_SECONDS };
  }

  async register(user: RequestUser, dto: RegisterMediaDto): Promise<MediaAsset> {
    if (!user.orgId || !user.centreId) {
      throw new ForbiddenException('Media registration requires an authenticated staff user with centre context');
    }
    await this.authorization.assertRole(user, STAFF_ROLES, 'media.register');

    // Reject the whole tag set if the capturer can't access every named
    // child — unlike group care records, there's no legitimate "skip this
    // one" case for tagging a child you have no relationship with at all.
    for (const childId of dto.childIds) {
      await this.authorization.assertCanAccessChild(user, childId, 'view');
    }

    const asset = await this.createAsset(user, { storageKey: dto.storageKey, roomId: dto.roomId, childIds: dto.childIds });

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'media.register',
      entityType: 'MediaAsset',
      entityId: asset.id,
      outcome: 'SUCCESS',
      metadata: { childIds: dto.childIds },
    });

    return asset;
  }

  private createAsset(
    user: RequestUser,
    data: { storageKey: string; roomId?: string; childIds: string[]; contentType?: string; byteSize?: number; width?: number; height?: number },
  ): Promise<MediaAsset> {
    const { childIds, roomId, ...file } = data;
    return this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, (tx) =>
      tx.mediaAsset.create({
        data: {
          ...file,
          orgId: user.orgId as string,
          centreId: user.centreId as string,
          roomId: roomId ?? null,
          capturedByUserId: user.userId,
          childTags: { create: childIds.map((childId) => ({ orgId: user.orgId as string, childId })) },
        },
        include: { childTags: true },
      }),
    );
  }

  /**
   * BRD §17: "media with several children shows to a family only if every
   * tagged child's permissions allow it."
   *
   * - Staff: must be able to view media for every tagged child (room
   *   educators and centre admins can).
   * - Parents: must have media permission for at least one tagged child of
   *   their own, must not be denied media for any tagged child they have a
   *   relationship with (including restricted ones), and every other tagged
   *   child's family must have given group-photo consent (off by default).
   *
   * Partial visibility ("blur one face") is not implemented; that's a product
   * decision to make explicitly later, not a default to fall into.
   */
  /** An upload's room must be in the user's centre, and an educator's own room. */
  private async assertUploadRoom(user: RequestUser, roomId: string | undefined): Promise<void> {
    if (roomId === undefined) return;
    if (typeof roomId !== 'string' || !roomId) throw new BadRequestException('roomId must be a room id');
    const room = await this.tenancy.withTenant({ orgId: user.orgId as string, centreId: user.centreId }, (tx) =>
      tx.room.findFirst({ where: { id: roomId, centreId: user.centreId as string }, select: { id: true } }),
    );
    if (!room) throw new BadRequestException('That room is not in your centre');
    if (user.role === 'EDUCATOR' && !(await this.authorization.activeRoomIds(user)).includes(roomId)) {
      throw new BadRequestException('You can only upload to a room you are assigned to');
    }
  }

  async canView(user: RequestUser, mediaAssetId: string): Promise<boolean> {
    if (!user.orgId) return false;

    const asset = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) => tx.mediaAsset.findUnique({ where: { id: mediaAssetId }, include: { childTags: true } }),
    );
    if (!asset) return false;
    if (asset.childTags.length === 0) return false; // untagged media has no determinable viewer yet
    const taggedIds = asset.childTags.map((t) => t.childId);

    if (user.role !== 'PARENT') {
      const allowed = await this.authorization.canAccessChildren(user, taggedIds, 'viewMedia');
      return taggedIds.every((id) => allowed.has(id));
    }

    const ownMediaAllowed = await this.authorization.canAccessChildren(user, taggedIds, 'viewMedia');
    if (ownMediaAllowed.size === 0) return false;

    const { related, others } = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      // Any relationship at all, even restricted or expired: such a guardian
      // must never see that child via someone else's consent.
      const rels = await tx.guardianChildRelationship.findMany({
        where: { guardianUserId: user.userId, childId: { in: taggedIds } },
        select: { childId: true },
      });
      const relatedIds = new Set(rels.map((r) => r.childId));
      const otherChildren = await tx.child.findMany({
        where: { id: { in: taggedIds.filter((id) => !relatedIds.has(id)) } },
        select: { id: true, groupPhotoConsent: true },
      });
      return { related: relatedIds, others: otherChildren };
    });

    for (const childId of related) {
      if (!ownMediaAllowed.has(childId)) return false;
    }
    const otherIds = taggedIds.filter((id) => !related.has(id));
    // Every other tagged child must exist in this tenant and have consent.
    if (others.length !== otherIds.length) return false;
    return others.every((c) => c.groupPhotoConsent);
  }
}
