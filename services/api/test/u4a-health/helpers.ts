import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { fixturePrisma } from '../test-utils';

export { NOW, TODAY, addDays, makeUser, makeChild, link, setupFamily, auditFor } from '../u3-family-requests/helpers';
export { fixturePrisma };

/** Internals that must never be returned to any caller. */
export const FORBIDDEN_KEYS = ['recordedByUserId', 'endedByUserId', 'voidedByUserId', 'updatedByUserId', 'orgId', 'centreId'];

export async function buildHealth() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  // Lazy require so every suite fails for the same reason (missing module) until src/health exists.
  const mod = require('../../src/health/health.service');
  const service = new mod.HealthService(tenancy, audit, authorization);
  return { prismaService, tenancy, audit, authorization, service, mod };
}

export function expectNoInternals(value: unknown): void {
  const walk = (v: any) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      for (const k of FORBIDDEN_KEYS) expect(Object.keys(v)).not.toContain(k);
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
}

export async function seedAllergy(
  tenant: { orgId: string; centreId: string },
  childId: string,
  adminUserId: string,
  allergen: string,
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'ANAPHYLAXIS' = 'MILD',
  opts: { ended?: boolean } = {},
) {
  return fixturePrisma.childAllergy.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      childId,
      allergen,
      severity,
      recordedByUserId: adminUserId,
      endedAt: opts.ended ? new Date('2026-09-01T00:00:00Z') : null,
      endReason: opts.ended ? 'Outgrown' : null,
      endedByUserId: opts.ended ? adminUserId : null,
    },
  });
}

export async function seedImmunisation(
  tenant: { orgId: string; centreId: string },
  childId: string,
  adminUserId: string,
  vaccine: string,
  doseDate: string,
  opts: { voided?: boolean } = {},
) {
  return fixturePrisma.childImmunisation.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      childId,
      vaccine,
      doseDate: new Date(doseDate),
      source: 'CERTIFICATE',
      recordedByUserId: adminUserId,
      voidedAt: opts.voided ? new Date('2026-09-01T00:00:00Z') : null,
      voidedByUserId: opts.voided ? adminUserId : null,
      voidReason: opts.voided ? 'Entered in error' : null,
    },
  });
}
