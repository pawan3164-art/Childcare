import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenancyService } from '../../src/common/tenancy/tenancy.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthorizationService } from '../../src/authorization/authorization.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { fixturePrisma, SeededTenant, uniqueSuffix } from '../test-utils';

/**
 * Clock: 2026-10-13T20:00:00Z is 07:00 on 2026-10-14 in Australia/Sydney
 * (AEDT, UTC+11), so the centre-local date differs from the UTC date.
 */
export const NOW = new Date('2026-10-13T20:00:00Z');
export const TODAY = '2026-10-14';

/** New columns/models are not in the generated client until the schema change lands, so fixtures go through any. */
export const db: any = fixturePrisma;

export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * Departure dates relative to TODAY (2026-10-14, centre-local):
 *  ELIGIBLE_7Y departed 2019-10-14: 7 years elapse exactly today (included; a UTC-date bug misses it).
 *  NOT_YET_7Y departed 2019-10-15: eligible tomorrow (excluded).
 */
export const ELIGIBLE_7Y = '2019-10-14';
export const NOT_YET_7Y = '2019-10-15';

export async function buildServices() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  const tenancy = new TenancyService(prismaService);
  const audit = new AuditService(tenancy);
  const authorization = new AuthorizationService(tenancy, audit);
  return { prismaService, tenancy, audit, authorization };
}

export async function makeUser(
  tenant: { orgId: string; centreId: string },
  role: RequestUser['role'],
  extra: { email?: string; firstName?: string; lastName?: string; roomId?: string } = {},
): Promise<RequestUser & { email: string }> {
  const email = extra.email ?? `${role.toLowerCase()}-${uniqueSuffix()}@example.test`;
  const u = await fixturePrisma.user.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      email,
      passwordHash: `hash-${uniqueSuffix()}`,
      role,
      firstName: extra.firstName ?? role,
      lastName: extra.lastName ?? 'T',
    },
  });
  if (extra.roomId) {
    await fixturePrisma.staffRoomAssignment.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, userId: u.id, roomId: extra.roomId, startDate: new Date('2026-01-01') },
    });
  }
  return { userId: u.id, orgId: tenant.orgId, centreId: tenant.centreId, role, sessionId: 's', email };
}

export async function makeChild(
  tenant: SeededTenant,
  opts: { departedOn?: string | null; dob?: string; legalHold?: boolean; legalHoldReason?: string; anonymisedAt?: Date } = {},
) {
  return db.child.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      roomId: tenant.roomId,
      firstName: `Kid${uniqueSuffix()}`,
      lastName: `Surname${uniqueSuffix()}`,
      dateOfBirth: new Date(opts.dob ?? '2016-05-20'),
      departedOn: opts.departedOn ? new Date(opts.departedOn) : null,
      legalHold: opts.legalHold ?? false,
      legalHoldReason: opts.legalHoldReason ?? null,
      anonymisedAt: opts.anonymisedAt ?? null,
    },
  });
}

export async function link(
  tenant: SeededTenant,
  parent: { userId: string },
  childId: string,
  rel: { canPickup?: boolean; isRestricted?: boolean; expiresAt?: Date; canViewMedia?: boolean; canViewBilling?: boolean } = {},
) {
  return fixturePrisma.guardianChildRelationship.create({
    data: {
      orgId: tenant.orgId,
      centreId: tenant.centreId,
      guardianUserId: parent.userId,
      childId,
      relationshipType: 'PARENT',
      canPickup: rel.canPickup ?? true,
      canViewMedia: rel.canViewMedia ?? true,
      canViewBilling: rel.canViewBilling ?? false,
      isRestricted: rel.isRestricted ?? false,
      expiresAt: rel.expiresAt ?? null,
    },
  });
}

export interface ChildContent {
  guardianId: string;
  attendanceIds: string[];
  careIds: string[];
  threadId: string;
  mediaAssetId: string;
  mediaKey: string;
  medicationId: string;
  incidentId: string;
  invoiceId: string;
  ledgerId: string;
  absenceId: string;
  bookingId: string;
  casualId: string;
  pickupId: string;
}

/** One of every retained record type for a child, plus a guardian link. Registers the media object in storage. */
export async function seedContent(
  tenant: SeededTenant,
  childId: string,
  storage?: { put(key: string, body: Buffer, ct: string): Promise<void> },
): Promise<ChildContent> {
  const { orgId, centreId } = tenant;
  const guardian = await makeUser(tenant, 'PARENT');
  await link(tenant, guardian, childId);
  const attendance = await Promise.all(
    (['SIGN_IN', 'SIGN_OUT'] as const).map((eventType, i) =>
      fixturePrisma.attendanceEvent.create({
        data: { orgId, centreId, childId, eventType, method: 'EDUCATOR', timestamp: new Date(`2019-03-0${i + 1}T09:00:00Z`) },
      }),
    ),
  );
  const care = await Promise.all(
    [1, 2].map((i) =>
      fixturePrisma.careRecord.create({
        data: {
          orgId, centreId, childId, type: 'MEAL', timestamp: new Date(`2019-03-0${i}T12:00:00Z`),
          note: `Secret meal note ${i}`, groupEventId: `grp-${uniqueSuffix()}`, recordedByUserId: guardian.userId,
        },
      }),
    ),
  );
  const thread = await fixturePrisma.directThread.create({ data: { orgId, centreId, childId, guardianUserId: guardian.userId } });
  await fixturePrisma.directMessage.create({
    data: { orgId, threadId: thread.id, authorUserId: guardian.userId, fromStaff: false, body: 'private message text' },
  });
  const mediaKey = `retention/${orgId}/${uniqueSuffix()}.jpg`;
  const media = await fixturePrisma.mediaAsset.create({
    data: { orgId, centreId, storageKey: mediaKey, contentType: 'image/jpeg', byteSize: 3, capturedByUserId: guardian.userId },
  });
  await fixturePrisma.mediaAssetChildTag.create({ data: { orgId, mediaAssetId: media.id, childId } });
  if (storage) await storage.put(mediaKey, Buffer.from('abc'), 'image/jpeg');
  const medication = await fixturePrisma.medicationAuthorization.create({
    data: { orgId, centreId, childId, medicationName: 'Panadol', dosageInstructions: '5ml', authorizedByGuardianId: guardian.userId },
  });
  const incident = await fixturePrisma.incident.create({
    data: { orgId, centreId, childId, severity: 'MINOR', description: 'Bumped knee', occurredAt: new Date('2019-03-01T10:00:00Z'), reportedByUserId: guardian.userId },
  });
  const invoice = await fixturePrisma.invoice.create({
    data: { orgId, centreId, childId, cycleStart: new Date('2019-03-01'), cycleEnd: new Date('2019-03-31') },
  });
  const ledger = await fixturePrisma.ledgerEntry.create({
    data: { orgId, centreId, childId, invoiceId: invoice.id, entryType: 'FEE', amountCents: 10000, description: 'Fee' },
  });
  const absence = await fixturePrisma.absence.create({
    data: { orgId, centreId, childId, date: new Date('2019-03-05'), isAllowable: true, reason: 'sick' },
  });
  const fee = await fixturePrisma.feeSchedule.create({
    data: {
      orgId, centreId, name: `Daily ${uniqueSuffix()}`, feeType: 'DAILY', amountCents: 10000,
      siblingDiscountPercent: 0, effectiveFrom: new Date('2018-01-01'),
    },
  });
  const booking = await fixturePrisma.booking.create({
    data: {
      orgId, centreId, childId, roomId: tenant.roomId, feeScheduleId: fee.id, bookingType: 'PERMANENT',
      daysOfWeek: [1, 2], startDate: new Date('2018-01-01'),
    },
  });
  const casual = await fixturePrisma.casualDayRequest.create({
    data: { orgId, centreId, childId, date: new Date('2019-03-06'), note: 'extra day', requestedByUserId: guardian.userId },
  });
  const pickup = await fixturePrisma.pickupNomination.create({
    data: { orgId, centreId, childId, date: new Date('2019-03-07'), personName: 'Aunt Pat', personPhone: '0400111222', createdByUserId: guardian.userId },
  });
  return {
    guardianId: guardian.userId,
    attendanceIds: attendance.map((a) => a.id),
    careIds: care.map((c) => c.id),
    threadId: thread.id,
    mediaAssetId: media.id,
    mediaKey,
    medicationId: medication.id,
    incidentId: incident.id,
    invoiceId: invoice.id,
    ledgerId: ledger.id,
    absenceId: absence.id,
    bookingId: booking.id,
    casualId: casual.id,
    pickupId: pickup.id,
  };
}

export async function counts(childId: string) {
  const [attendance, care, threads, messages, tags, relationships, pickups, casuals, medication, incidents, ledger, invoices, absences, bookings] =
    await Promise.all([
      fixturePrisma.attendanceEvent.count({ where: { childId } }),
      fixturePrisma.careRecord.count({ where: { childId } }),
      fixturePrisma.directThread.count({ where: { childId } }),
      fixturePrisma.directMessage.count({ where: { thread: { childId } } }),
      fixturePrisma.mediaAssetChildTag.count({ where: { childId } }),
      fixturePrisma.guardianChildRelationship.count({ where: { childId } }),
      fixturePrisma.pickupNomination.count({ where: { childId } }),
      fixturePrisma.casualDayRequest.count({ where: { childId } }),
      fixturePrisma.medicationAuthorization.count({ where: { childId } }),
      fixturePrisma.incident.count({ where: { childId } }),
      fixturePrisma.ledgerEntry.count({ where: { childId } }),
      fixturePrisma.invoice.count({ where: { childId } }),
      fixturePrisma.absence.count({ where: { childId } }),
      fixturePrisma.booking.count({ where: { childId } }),
    ]);
  return { attendance, care, threads, messages, tags, relationships, pickups, casuals, medication, incidents, ledger, invoices, absences, bookings };
}

export async function auditFor(entityId: string, action?: string) {
  return fixturePrisma.auditLogEntry.findMany({ where: { entityId, ...(action ? { action } : {}) } });
}

export async function childRow(id: string): Promise<any> {
  return db.child.findUnique({ where: { id } });
}
