import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { FeaturesService } from '../../src/features/features.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { fixturePrisma, seedOrgCentreRoom, SeededTenant, uniqueSuffix } from '../test-utils';

/** New models may not be in the generated client typings yet, so fixtures go through any. */
export const db: any = fixturePrisma;

export const NOW = new Date('2026-10-13T20:00:00Z');
export const YESTERDAY = new Date('2026-10-12T20:00:00Z');
export const NEXT_YEAR = new Date('2027-10-13T20:00:00Z');

export async function buildFeatures() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  const features = new FeaturesService(tenancy, prismaService, audit, authorization);
  return { prismaService, tenancy, audit, authorization, features };
}

export async function makeUser(
  tenant: { orgId: string | null; centreId: string | null },
  role: RequestUser['role'],
): Promise<RequestUser> {
  const u = await fixturePrisma.user.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      email: `${role.toLowerCase()}-${uniqueSuffix()}@example.test`,
      passwordHash: 'x',
      role,
      firstName: role,
      lastName: 'T',
    },
  });
  return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's' };
}

/** A fresh org with one centre and the people who matter. No OrganisationPlan row (so effective plan is full). */
export async function setupOrg(label: string) {
  const tenant: SeededTenant = await seedOrgCentreRoom(label);
  const admin = await makeUser(tenant, 'CENTRE_ADMIN');
  const orgAdmin = await makeUser({ orgId: tenant.orgId, centreId: null }, 'ORG_ADMIN');
  const educator = await makeUser(tenant, 'EDUCATOR');
  const parent = await makeUser(tenant, 'PARENT');
  return { tenant, admin, orgAdmin, educator, parent };
}

export async function secondCentre(orgId: string) {
  const centre = await fixturePrisma.centre.create({ data: { orgId, name: `Second Centre ${uniqueSuffix()}` } });
  return centre.id;
}

export async function makePlatformAdmin(): Promise<RequestUser> {
  return makeUser({ orgId: null, centreId: null }, 'PLATFORM_ADMIN');
}

export async function setPlanRow(orgId: string, plan: string, validUntil: Date | null = null) {
  return db.organisationPlan.upsert({
    where: { orgId },
    create: { orgId, plan, validUntil },
    update: { plan, validUntil },
  });
}

export async function auditFor(entityId: string, action?: string) {
  return fixturePrisma.auditLogEntry.findMany({ where: { entityId, ...(action ? { action } : {}) } });
}

export const CRITICAL = ['attendance', 'care_records', 'medication', 'incidents', 'messaging', 'privacy', 'health_records'];
export const OPTIONAL_FULL_ONLY = ['learning', 'billing', 'checklists'];
