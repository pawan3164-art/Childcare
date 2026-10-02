import { ForbiddenException, Injectable } from '@nestjs/common';
import { MediaAsset } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { RegisterMediaDto } from './dto/register-media.dto';

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
  ) {}

  async register(user: RequestUser, dto: RegisterMediaDto): Promise<MediaAsset> {
    if (!user.orgId || !user.centreId) {
      throw new ForbiddenException('Media registration requires an authenticated staff user with centre context');
    }

    // Reject the whole tag set if the capturer can't access every named
    // child — unlike group care records, there's no legitimate "skip this
    // one" case for tagging a child you have no relationship with at all.
    for (const childId of dto.childIds) {
      await this.authorization.assertCanAccessChild(user, childId, 'view');
    }

    const asset = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.mediaAsset.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            roomId: dto.roomId ?? null,
            storageKey: dto.storageKey,
            capturedByUserId: user.userId,
            childTags: {
              create: dto.childIds.map((childId) => ({
                orgId: user.orgId as string,
                childId,
              })),
            },
          },
          include: { childTags: true },
        }),
    );

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

  /**
   * True only if the viewer can view media for EVERY child tagged in the
   * asset. A single denied tag denies the whole asset — partial visibility
   * ("blur one face") is not implemented; that's a product decision to make
   * explicitly later, not a default to fall into.
   */
  async canView(user: RequestUser, mediaAssetId: string): Promise<boolean> {
    if (!user.orgId) return false;

    const asset = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) => tx.mediaAsset.findUnique({ where: { id: mediaAssetId }, include: { childTags: true } }),
    );
    if (!asset) return false;
    if (asset.childTags.length === 0) return false; // untagged media has no determinable viewer yet

    for (const tag of asset.childTags) {
      const allowed = await this.authorization.canAccessChild(user, tag.childId, 'viewMedia');
      if (!allowed) return false;
    }
    return true;
  }
}
