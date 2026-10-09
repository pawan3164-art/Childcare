import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { FamilyRequestsService } from '../../src/family-requests/family-requests.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { fixturePrisma, seedOrgCentreRoom, SeededTenant, uniqueSuffix } from '../test-utils';

/**
 * Clock for all U3 family-request tests. 2026-10-13T20:00:00Z is 07:00 on
 * Wednesday 2026-10-14 in Australia/Sydney (AEDT, UTC+11), so the centre-local
 * date differs from the UTC date: code that uses the UTC date fails.
 */
export const NOW = new Date('2026-10-13T20:00:00Z');
export const TODAY = '2026-10-14'; // Wednesday

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export async function buildService() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  const service = new FamilyRequestsService(tenancy, audit, authorization);
  return { prismaService, service };
}

export async function makeUser(
  tenant: { orgId: string; centreId: string },
  role: RequestUser['role'],
  roomId?: string,
): Promise<RequestUser> {
  const u = await fixturePrisma.user.create({
    data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: role, lastName: 'T' },
  });
  if (roomId) {
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: u.id, roomId, startDate: new Date('2026-01-01') },
    });
  }
  return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
}

export async function makeChild(tenant: SeededTenant, opts: { roomId?: string | null; firstName?: string } = {}) {
  return fixturePrisma.child.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      roomId: opts.roomId === undefined ? tenant.roomId : opts.roomId,
      firstName: opts.firstName ?? 'Kid',
      lastName: `Fam-${uniqueSuffix()}`,
      dateOfBirth: new Date('2023-01-01'),
    },
  });
}

export async function link(
  tenant: SeededTenant,
  parent: RequestUser,
  childId: string,
  rel: { canPickup?: boolean; isRestricted?: boolean; expiresAt?: Date } = {},
) {
  return fixturePrisma.guardianChildRelationship.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      guardianUserId: parent.userId,
      childId,
      relationshipType: 'PARENT',
      canPickup: rel.canPickup ?? true,
      isRestricted: rel.isRestricted ?? false,
      expiresAt: rel.expiresAt ?? null,
    },
  });
}

/** Org + centre + room, an admin, a room educator, one parent (pickup rights) and their child in the room. */
export async function setupFamily(label: string) {
  const tenant = await seedOrgCentreRoom(label);
  const admin = await makeUser(tenant, 'CENTRE_ADMIN');
  const educator = await makeUser(tenant, 'EDUCATOR', tenant.roomId);
  const parent = await makeUser(tenant, 'PARENT');
  const child = await makeChild(tenant);
  await link(tenant, parent, child.id, { canPickup: true });
  return { tenant, admin, educator, parent, child };
}

export async function makeFeeSchedule(
  tenant: { orgId: string; centreId: string },
  opts: { amountCents?: number; roomId?: string | null; effectiveFrom?: string; effectiveTo?: string | null; siblingDiscountPercent?: number } = {},
) {
  return fixturePrisma.feeSchedule.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      roomId: opts.roomId ?? null,
      name: `Daily ${uniqueSuffix()}`,
      feeType: 'DAILY',
      amountCents: opts.amountCents ?? 10000,
      siblingDiscountPercent: opts.siblingDiscountPercent ?? 0,
      effectiveFrom: new Date(opts.effectiveFrom ?? '2026-01-01'),
      effectiveTo: opts.effectiveTo ? new Date(opts.effectiveTo) : null,
    },
  });
}

export async function auditFor(entityId: string) {
  return fixturePrisma.auditLogEntry.findMany({ where: { entityId } });
}
