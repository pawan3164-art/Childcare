import { ForbiddenException, Injectable } from '@nestjs/common';
import { GuardianChildRelationship } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { RequestUser } from '../authorization/request-user.interface';
import { UpdatePickupAuthorizationDto } from './dto/update-pickup-authorization.dto';

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
}
