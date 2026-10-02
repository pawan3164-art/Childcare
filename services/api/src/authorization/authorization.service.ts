import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from './request-user.interface';

export type ChildPermission = 'view' | 'viewMedia' | 'viewBilling' | 'pickup';

/**
 * Central, relationship-based authorization layer (Delivery Plan §6.2,
 * BRD §22): access to a specific child depends on an actual relationship
 * (guardian-of-this-child, educator-in-this-room), not just a role flag.
 *
 * Every check runs inside TenancyService.withTenant, so the org-level RLS
 * policy is a second, DB-enforced line of defence underneath this logic —
 * a bug here that queries the wrong child still can't return another org's
 * row, because Postgres filters it out first.
 *
 * Known Stage 0 simplification: CENTRE_ADMIN is scoped to a single
 * user.centreId. Multi-centre Area/Enterprise Manager access (BRD §3) is
 * deferred — see docs/adr for the note — do not assume this method supports
 * it yet.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async assertCanAccessChild(
    user: RequestUser,
    childId: string,
    permission: ChildPermission,
  ): Promise<void> {
    const allowed = await this.canAccessChild(user, childId, permission);
    if (!allowed) {
      await this.audit.record({
        orgId: user.orgId ?? 'unknown',
        centreId: user.centreId,
        actorUserId: user.userId,
        actorRole: user.role,
        action: `child.${permission}`,
        entityType: 'Child',
        entityId: childId,
        outcome: 'DENIED',
      });
      throw new ForbiddenException('Not authorized to access this child record');
    }
  }

  async canAccessChild(
    user: RequestUser,
    childId: string,
    permission: ChildPermission,
  ): Promise<boolean> {
    if (!user.orgId) return false;

    return this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, async (tx) => {
      const child = await tx.child.findUnique({ where: { id: childId } });
      if (!child) return false; // not found, or hidden by RLS (different org)

      switch (user.role) {
        case 'PARENT': {
          const rel = await tx.guardianChildRelationship.findUnique({
            where: { guardianUserId_childId: { guardianUserId: user.userId, childId } },
          });
          if (!rel || rel.isRestricted) return false;
          if (rel.expiresAt && rel.expiresAt.getTime() < Date.now()) return false;
          if (permission === 'view') return true;
          if (permission === 'viewMedia') return rel.canViewMedia;
          if (permission === 'viewBilling') return rel.canViewBilling;
          if (permission === 'pickup') return rel.canPickup;
          return false;
        }

        case 'EDUCATOR': {
          if (!child.roomId) return false;
          const assignment = await tx.staffRoomAssignment.findFirst({
            where: { userId: user.userId, roomId: child.roomId, endDate: null },
          });
          return !!assignment;
        }

        case 'CENTRE_ADMIN':
          return child.centreId === user.centreId;

        case 'ORG_ADMIN':
        case 'PLATFORM_ADMIN':
          // Already org-scoped by the RLS transaction above.
          return true;

        default:
          return false;
      }
    });
  }
}
