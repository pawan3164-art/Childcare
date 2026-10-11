import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { fixturePrisma, seedOrgCentreRoom, SeededTenant, uniqueSuffix } from '../test-utils';

export { NOW, TODAY, addDays } from '../u3-family-requests/helpers';
export { fixturePrisma };

/** The new Prisma delegates/columns (areaManagerCentre, licensedCapacity, AREA_MANAGER) do not exist until the schema lands; reach them untyped. */
export const db: any = fixturePrisma;

export async function buildHq() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  // Lazy require so every suite fails for the same reason (missing module) until src/hq exists.
  const mod = require('../../src/hq/hq.service');
  const service = new mod.HqService(tenancy, audit);
  return { prismaService, tenancy, audit, authorization, service, mod };
}

export interface HqCentre {
  id: string;
  name: string;
  timezone: string;
  licensedCapacity: number | null;
  roomId: string;
}

export interface HqOrg {
  orgId: string;
  centres: HqCentre[];
  orgAdmin: RequestUser;
  platformAdmin: RequestUser;
  areaManager: RequestUser;
  centreAdmin: RequestUser;
  educator: RequestUser;
  parent: RequestUser;
}

export async function makeOrgUser(orgId: string, role: string, centreId: string | null = null): Promise<RequestUser> {
  const u = await db.user.create({
    data: { orgId, centreId, email: `${role}-${uniqueSuffix()}@example.test`, passwordHash: 'x', role, firstName: role, lastName: 'T' },
  });
  return { userId: u.id, orgId, centreId, role: role as RequestUser['role'], sessionId: 's' };
}

export interface CentreSpec {
  name?: string;
  timezone?: string;
  licensedCapacity?: number | null;
}

/**
 * Seeds an org (via seedOrgCentreRoom, which creates centre #1 and a room) then adds further centres.
 * Defaults to three centres: Sydney, Perth and Brisbane. Users are org-level (centreId null) except
 * centreAdmin/educator/parent, which belong to centre 0.
 */
export async function seedHqOrg(
  label: string,
  specs: CentreSpec[] = [{ timezone: 'Australia/Sydney' }, { timezone: 'Australia/Perth' }, { timezone: 'Australia/Brisbane' }],
): Promise<HqOrg> {
  const first: SeededTenant = await seedOrgCentreRoom(label);
  const centres: HqCentre[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const name = spec.name ?? `HQ ${label} Centre ${i} ${uniqueSuffix()}`;
    const data = { name, timezone: spec.timezone ?? 'Australia/Sydney', licensedCapacity: spec.licensedCapacity ?? null };
    let id: string;
    let roomId: string;
    if (i === 0) {
      await db.centre.update({ where: { id: first.centreId }, data });
      id = first.centreId;
      roomId = first.roomId;
    } else {
      const c = await db.centre.create({ data: { orgId: first.orgId, ...data } });
      const r = await fixturePrisma.room.create({ data: { orgId: first.orgId, centreId: c.id, name: `Room ${uniqueSuffix()}` } });
      id = c.id;
      roomId = r.id;
    }
    centres.push({ id, name, timezone: data.timezone, licensedCapacity: data.licensedCapacity, roomId });
  }
  return {
    orgId: first.orgId,
    centres,
    orgAdmin: await makeOrgUser(first.orgId, 'ORG_ADMIN'),
    platformAdmin: await makeOrgUser(first.orgId, 'PLATFORM_ADMIN'),
    areaManager: await makeOrgUser(first.orgId, 'AREA_MANAGER'),
    centreAdmin: await makeOrgUser(first.orgId, 'CENTRE_ADMIN', centres[0].id),
    educator: await makeOrgUser(first.orgId, 'EDUCATOR', centres[0].id),
    parent: await makeOrgUser(first.orgId, 'PARENT', centres[0].id),
  };
}

export async function assignAreaManager(org: HqOrg, centreIndexes: number[], manager: RequestUser = org.areaManager) {
  for (const i of centreIndexes) {
    await db.areaManagerCentre.create({ data: { orgId: org.orgId, userId: manager.userId, centreId: org.centres[i].id } });
  }
}

/** Distinctive surname so a leak of child-level data into HQ output is detectable. */
export const CHILD_SURNAME_PREFIX = 'HqLeakCheck';

export async function makeHqChild(org: HqOrg, centreIndex: number, firstName = 'Kid') {
  const c = org.centres[centreIndex];
  return fixturePrisma.child.create({
    data: { orgId: org.orgId, centreId: c.id, roomId: c.roomId, firstName, lastName: `${CHILD_SURNAME_PREFIX}-${uniqueSuffix()}`, dateOfBirth: new Date('2023-01-01') },
  });
}

export async function attend(
  org: HqOrg,
  centreIndex: number,
  childId: string,
  eventType: 'SIGN_IN' | 'SIGN_OUT',
  iso: string,
  opts: { isCorrection?: boolean; correctedEventId?: string } = {},
) {
  return fixturePrisma.attendanceEvent.create({
    data: {
      orgId: org.orgId,
      centreId: org.centres[centreIndex].id,
      childId,
      eventType,
      method: 'EDUCATOR',
      timestamp: new Date(iso),
      isCorrection: opts.isCorrection ?? false,
      correctedEventId: opts.correctedEventId ?? null,
    },
  });
}

export type LedgerType = 'FEE' | 'SUBSIDY_ESTIMATED' | 'SUBSIDY_CONFIRMED' | 'PAYMENT' | 'ADJUSTMENT' | 'CREDIT';

/**
 * Writes a ledger row with the platform's sign convention (FEE and ADJUSTMENT positive,
 * SUBSIDY_*, PAYMENT and CREDIT negative) and pins createdAt to noon UTC on `date`; FEE rows also
 * get that sessionDate, so range membership and ageing use `sessionDate ?? createdAt`.
 */
export async function ledger(org: HqOrg, centreIndex: number, childId: string, entryType: LedgerType, amountCents: number, date: string) {
  return fixturePrisma.ledgerEntry.create({
    data: {
      orgId: org.orgId,
      centreId: org.centres[centreIndex].id,
      childId,
      entryType,
      amountCents,
      description: `${entryType} ${date}`,
      sessionDate: entryType === 'FEE' ? new Date(`${date}T00:00:00Z`) : null,
      createdAt: new Date(`${date}T12:00:00Z`),
    } as any,
  });
}

export async function expectHttp(p: Promise<unknown>, statuses: number[]): Promise<void> {
  let err: any;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  const status = err instanceof BadRequestException || err instanceof ForbiddenException || err instanceof NotFoundException ? err.getStatus() : (err?.status ?? err?.getStatus?.());
  expect(statuses).toContain(status);
}

export async function hqAudit(orgId: string, action: string, actorUserId?: string) {
  return fixturePrisma.auditLogEntry.findMany({
    where: { orgId, action, ...(actorUserId ? { actorUserId } : {}) },
    orderBy: { timestamp: 'asc' },
  });
}
