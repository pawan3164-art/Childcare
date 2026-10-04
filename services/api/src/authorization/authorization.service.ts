import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TenancyService } from '../common/tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from './request-user.interface';

export type ChildPermission = 'view' | 'viewMedia' | 'viewBilling' | 'pickup';

const EDUCATOR_PERMISSIONS: ChildPermission[] = ['view', 'viewMedia'];

/** Roles that work in the centre (vs. families). Staff-only writes check this. */
export const STAFF_ROLES: UserRole[] = ['EDUCATOR', 'CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
export const ADMIN_ROLES: UserRole[] = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];

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

  /**
   * Role gate for staff-only actions (attendance, care records, incidents,
   * medication administration, media capture). A parent passes the 'view'
   * relationship check for their own child, so relationship checks alone are
   * not enough for writes of regulatory records (BRD §9/§14/§22).
   */
  async assertRole(user: RequestUser, allowed: UserRole[], action: string): Promise<void> {
    if (allowed.includes(user.role)) return;
    await this.audit.record({
      orgId: user.orgId ?? 'unknown',
      centreId: user.centreId,
      actorUserId: user.userId,
      actorRole: user.role,
      action,
      entityType: 'Role',
      outcome: 'DENIED',
    });
    throw new ForbiddenException('This action is restricted to centre staff');
  }

  /** Room ids the user is currently assigned to (open-ended StaffRoomAssignment). */
  async activeRoomIds(user: RequestUser): Promise<string[]> {
    if (!user.orgId) return [];
    const assignments = await this.tenancy.withTenant({ orgId: user.orgId, centreId: user.centreId }, (tx) =>
      tx.staffRoomAssignment.findMany({ where: { userId: user.userId, endDate: null }, select: { roomId: true } }),
    );
    return assignments.map((a) => a.roomId);
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
          // Least privilege (BRD §15/§18): room educators need the child's care
          // record and photos, never the family's billing data or pickup rights.
          if (!EDUCATOR_PERMISSIONS.includes(permission)) return false;
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
