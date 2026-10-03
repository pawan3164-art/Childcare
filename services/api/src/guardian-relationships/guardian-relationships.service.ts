import { ForbiddenException, Injectable } from '@nestjs/common';
import { GuardianChildRelationship } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { UpdatePickupAuthorizationDto } from './dto/update-pickup-authorization.dto';
import { CreateRelationshipDto } from './dto/create-relationship.dto';

const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

/**
 * BRD §13: "Maintain authorised pickup list with permissions and expiry."
 * The relationship model itself was built in Stage 0 (GuardianChildRelationship);
 * this is the management endpoint for centre staff to grant/revoke/expire
 * pickup authorization on an existing relationship.
 */
@Injectable()
export class GuardianRelationshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async updatePickupAuthorization(
    user: RequestUser,
    relationshipId: string,
    dto: UpdatePickupAuthorizationDto,
  ): Promise<GuardianChildRelationship> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only centre staff can manage pickup authorization, per centre policy (BRD §13)');
    }

    const updated = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      async (tx) => {
        const relationship = await tx.guardianChildRelationship.findUniqueOrThrow({
          where: { id: relationshipId },
        });
        await this.authorization.assertCanAccessChild(user, relationship.childId, 'view');

        return tx.guardianChildRelationship.update({
          where: { id: relationshipId },
          data: {
            canPickup: dto.canPickup,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          },
        });
      },
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'guardian_relationship.update_pickup_authorization',
      entityType: 'GuardianChildRelationship',
      entityId: relationshipId,
      outcome: 'SUCCESS',
      metadata: { canPickup: dto.canPickup, expiresAt: dto.expiresAt },
    });

    return updated;
  }

  /** Links an existing guardian (PARENT-role user) account to a child — BRD §12 Child & Family module. */
  async create(user: RequestUser, dto: CreateRelationshipDto): Promise<GuardianChildRelationship> {
    if (!user.orgId || !user.centreId) throw new ForbiddenException();
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only an administrator can link a guardian to a child');
    }
    await this.authorization.assertCanAccessChild(user, dto.childId, 'view');

    // Defensive backfill: a guardian with no orgId yet (e.g. created via a
    // path that didn't set one) can't make ANY tenant-scoped query once
    // linked — including looking up their own children — because
    // TenancyService.withTenant needs an orgId to set RLS context at all.
    // `users` is outside RLS (ADR 0001), so this plain update is safe.
    await this.prisma.user.updateMany({
      where: { id: dto.guardianUserId, orgId: null },
      data: { orgId: user.orgId, centreId: user.centreId },
    });

    const relationship = await this.tenancy.withTenant(
      { orgId: user.orgId, centreId: user.centreId },
      (tx) =>
        tx.guardianChildRelationship.create({
          data: {
            orgId: user.orgId as string,
            centreId: user.centreId as string,
            guardianUserId: dto.guardianUserId,
            childId: dto.childId,
            relationshipType: dto.relationshipType,
            canViewMedia: dto.canViewMedia ?? true,
            canViewBilling: dto.canViewBilling ?? false,
            canPickup: dto.canPickup ?? false,
          },
        }),
    );

    await this.audit.record({
      orgId: user.orgId,
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'guardian_relationship.create',
      entityType: 'GuardianChildRelationship',
      entityId: relationship.id,
      outcome: 'SUCCESS',
    });

    return relationship;
  }

  async listForChild(user: RequestUser, childId: string): Promise<GuardianChildRelationship[]> {
    if (!user.orgId) throw new ForbiddenException();
    await this.authorization.assertCanAccessChild(user, childId, 'view');

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.guardianChildRelationship.findMany({ where: { childId } }),
    );
  }
}
