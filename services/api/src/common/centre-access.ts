import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../authorization/request-user.interface';

export const ADMIN_ROLES = ['CENTRE_ADMIN', 'ORG_ADMIN', 'PLATFORM_ADMIN'];
export const CENTRE_READ_ROLES = [...ADMIN_ROLES, 'EDUCATOR', 'PARENT'];

export interface CentreScope {
  orgId: string;
  centreId: string;
}

/** Everyone acts within one centre. A user without centre context cannot use centre-wide features. */
export function centreScope(user: RequestUser): CentreScope {
  if (!user.orgId || !user.centreId) throw new ForbiddenException('Requires a centre context');
  if (!CENTRE_READ_ROLES.includes(user.role)) throw new ForbiddenException('Not allowed');
  return { orgId: user.orgId, centreId: user.centreId };
}

export function assertAdmin(user: RequestUser, what: string): CentreScope {
  const scope = centreScope(user);
  if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException(`Only an administrator can ${what}`);
  return scope;
}

/**
 * The rooms of this parent's linked children at the centre (null means a child with no room yet).
 * An empty list means the parent has no current link to the centre.
 */
export async function parentChildRooms(tx: Prisma.TransactionClient, user: RequestUser, scope: CentreScope, now: Date): Promise<(string | null)[]> {
  const links = await tx.guardianChildRelationship.findMany({
    where: {
      guardianUserId: user.userId,
      child: { centreId: scope.centreId, orgId: scope.orgId },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { child: { select: { roomId: true } } },
  });
  return links.map((l) => l.child.roomId);
}
