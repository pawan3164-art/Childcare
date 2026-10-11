import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { fixturePrisma } from '../test-utils';

export { NOW, TODAY, makeUser, makeChild, link, setupFamily } from '../u3-family-requests/helpers';
export { fixturePrisma };

/** NOW is 07:00 local (AEDT); the centre-local day started at 2026-10-13T13:00:00Z. */
export const DAY_START = new Date('2026-10-13T13:00:00Z');
export const EARLIER_TODAY = new Date('2026-10-13T14:00:00Z'); // 01:00 local today
export const YESTERDAY = new Date('2026-10-13T12:00:00Z'); // 23:00 local yesterday

export const TEST_SECRET = 'u3b-test-checkin-secret';

export function useSecret(): void {
  process.env.CHECKIN_CODE_SECRET = TEST_SECRET;
}

export async function buildSelfSignIn() {
  useSecret();
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  // Required lazily so suites that do not need the service (children-list) fail only for their own reasons.
  const { CheckInCodeService } = require('../../src/attendance/checkin-code.service');
  const { SelfSignInService } = require('../../src/attendance/self-sign-in.service');
  const codes = new CheckInCodeService();
  const service = new SelfSignInService(tenancy, audit, authorization, codes);
  return { prismaService, tenancy, audit, authorization, codes, service };
}

export async function enableSelfSignIn(centreId: string, enabled = true) {
  await fixturePrisma.centre.update({ where: { id: centreId }, data: { parentSelfSignIn: enabled } });
}

export async function seedEvent(
  tenant: { orgId: string; centreId: string },
  childId: string,
  eventType: 'SIGN_IN' | 'SIGN_OUT',
  timestamp: Date,
  opts: { isCorrection?: boolean } = {},
) {
  return fixturePrisma.attendanceEvent.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      childId,
      eventType,
      method: 'EDUCATOR',
      timestamp,
      isCorrection: opts.isCorrection ?? false,
    },
  });
}

export async function eventsFor(childId: string) {
  return fixturePrisma.attendanceEvent.findMany({ where: { childId }, orderBy: { timestamp: 'asc' } });
}

export async function selfSignInAudit(where: Record<string, unknown>) {
  return fixturePrisma.auditLogEntry.findMany({ where: { action: 'attendance.self_sign_in', ...where } });
}

/** Seed n DENIED self-sign-in audit rows for a user at `at` (explicit timestamp, so tests control the window). */
export async function seedDenied(
  user: { userId: string; orgId: string | null; centreId: string | null },
  childId: string,
  n: number,
  at: Date,
) {
  for (let i = 0; i < n; i++) {
    await fixturePrisma.auditLogEntry.create({
      data: {
        orgId: user.orgId,
        centreId: user.centreId,
        actorUserId: user.userId,
        actorRole: 'PARENT',
        action: 'attendance.self_sign_in',
        entityType: 'Child',
        entityId: childId,
        outcome: 'DENIED',
        metadata: { childId },
        timestamp: at,
      },
    });
  }
}
