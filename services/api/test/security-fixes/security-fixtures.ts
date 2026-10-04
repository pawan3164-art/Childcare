import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RelationshipType, UserRole } from '@prisma/client';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { fixturePrisma, seedOrgCentreRoom, SeededTenant, uniqueSuffix } from '../test-utils';

/**
 * Shared seeding helpers for the security-fix red suite. Not a spec file
 * (doesn't match *.spec.ts), so jest never runs it directly. Every test calls
 * these afresh so each one seeds its own org — no cross-test coupling.
 */

export async function makeUser(role: UserRole, orgId: string | null, centreId: string | null, label = role.toLowerCase()) {
  return fixturePrisma.user.create({
    data: {
      orgId,
      centreId,
      email: `${label}-${uniqueSuffix()}@example.test`,
      passwordHash: 'x',
      role,
      firstName: label,
      lastName: 'Sec',
    },
  });
}

export function asRequestUser(u: { id: string; orgId: string | null; centreId: string | null; role: UserRole }): RequestUser {
  return { userId: u.id, orgId: u.orgId, centreId: u.centreId, role: u.role, sessionId: 'test-session' };
}

export async function makeChild(tenant: SeededTenant, roomId: string | null = tenant.roomId, firstName = 'Sec') {
  return fixturePrisma.child.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      roomId,
      firstName,
      lastName: `Child-${uniqueSuffix()}`,
      dateOfBirth: new Date('2023-01-01'),
    },
  });
}

export async function assignToRoom(tenant: SeededTenant, userId: string, roomId: string = tenant.roomId, endDate: Date | null = null) {
  return fixturePrisma.staffRoomAssignment.create({
    data: { orgId: tenant.orgId, centreId: tenant.centreId, userId, roomId, startDate: new Date('2026-01-01'), endDate },
  });
}

export async function linkGuardian(
  tenant: SeededTenant,
  guardianUserId: string,
  childId: string,
  opts: { relationshipType?: RelationshipType; isRestricted?: boolean; expiresAt?: Date | null; canPickup?: boolean; canViewBilling?: boolean } = {},
) {
  return fixturePrisma.guardianChildRelationship.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      guardianUserId,
      childId,
      relationshipType: opts.relationshipType ?? 'PARENT',
      isRestricted: opts.isRestricted ?? false,
      expiresAt: opts.expiresAt ?? null,
      canPickup: opts.canPickup ?? true,
      canViewBilling: opts.canViewBilling ?? true,
      canViewMedia: true,
    },
  });
}

/**
 * The standard "one centre, one room, assigned educator, one child, the
 * child's own non-restricted PARENT guardian, a centre admin" fixture.
 */
export async function seedFamily(label: string) {
  const tenant = await seedOrgCentreRoom(label);
  const educator = await makeUser('EDUCATOR', tenant.orgId, tenant.centreId);
  await assignToRoom(tenant, educator.id);
  const admin = await makeUser('CENTRE_ADMIN', tenant.orgId, tenant.centreId);
  const parent = await makeUser('PARENT', tenant.orgId, tenant.centreId);
  const child = await makeChild(tenant);
  await linkGuardian(tenant, parent.id, child.id, { relationshipType: 'PARENT' });
  return {
    tenant,
    educator,
    admin,
    parent,
    child,
    educatorUser: asRequestUser(educator),
    adminUser: asRequestUser(admin),
    parentUser: asRequestUser(parent),
  };
}

/** Resolves to the thrown error, or fails the assertion if the promise resolved. */
export async function captureRejection(p: Promise<unknown>): Promise<unknown> {
  let resolved = false;
  let value: unknown;
  try {
    value = await p;
    resolved = true;
  } catch (err) {
    return err;
  }
  // Make the "it didn't reject" failure obvious in the jest output.
  expect({ resolvedInsteadOfRejecting: resolved, value }).toBeUndefined();
  return undefined;
}

export async function expectBadRequestOrForbidden(p: Promise<unknown>): Promise<void> {
  const err = await captureRejection(p);
  expect(err instanceof BadRequestException || err instanceof ForbiddenException).toBe(true);
}
