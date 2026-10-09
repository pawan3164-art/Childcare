import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { FamilyRequestsService } from '../../src/family-requests/family-requests.service';
import { FeeCalculationService } from '../../src/billing/fee-calculation.service';
import { appPrisma, disconnectAll, fixturePrisma, setTenantContext } from '../test-utils';
import { NOW, TODAY, addDays, auditFor, buildService, dayOfWeek, link, makeChild, makeFeeSchedule, makeUser, setupFamily } from './helpers';

/** The next-week Wednesday: a normal future day used as the requested casual date. */
const DAY = addDays(TODAY, 7);
const LATER = new Date('2026-10-14T20:00:00Z'); // 07:00 on 2026-10-15 in Sydney

/**
 * U3 slice 2: parents ask for an extra (casual) day; the centre approves, which
 * books and bills it, or declines it with an optional reason.
 */
describe('FamilyRequestsService: U3 casual day requests', () => {
  let prismaService: PrismaService;
  let service: FamilyRequestsService;
  const feeCalculation = new FeeCalculationService();

  beforeAll(async () => {
    ({ prismaService, service } = await buildService());
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function family(label: string) {
    const f = await setupFamily(label);
    const fee = await makeFeeSchedule(f.tenant, { amountCents: 12000, siblingDiscountPercent: 10 });
    return { ...f, fee };
  }

  it('a parent requests a casual day: PENDING, audited without the note text', async () => {
    const { tenant, parent, child } = await family('CasReq');
    const view = await service.requestCasualDay(parent, child.id, { date: DAY, note: 'Grandma ill secret-note' }, NOW);
    expect(view).toMatchObject({ childId: child.id, date: DAY, status: 'PENDING', note: 'Grandma ill secret-note', declineReason: null, decidedAt: null });
    expect(typeof view.createdAt).toBe('string');

    const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: view.id } });
    expect(row).toMatchObject({ orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, requestedByUserId: parent.userId, status: 'PENDING', bookingId: null });
    expect(row.date.toISOString().slice(0, 10)).toBe(DAY);

    const audits = (await auditFor(view.id)).filter((a) => a.action === 'casual_day.requested');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].metadata)).not.toContain('secret-note');
  });

  it('only a parent with view access may request; educators, admins, strangers, restricted and expired guardians are Forbidden', async () => {
    const { tenant, admin, educator, child } = await family('CasDeny');
    const stranger = await makeUser(tenant, 'PARENT');
    const restricted = await makeUser(tenant, 'PARENT');
    await link(tenant, restricted, child.id, { isRestricted: true });
    const expired = await makeUser(tenant, 'PARENT');
    await link(tenant, expired, child.id, { expiresAt: new Date('2026-01-01T00:00:00Z') });

    for (const actor of [admin, educator, stranger, restricted, expired]) {
      await expect(service.requestCasualDay(actor, child.id, { date: DAY }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    }
    for (const actor of [educator, stranger, restricted, expired]) {
      await expect(service.listCasualDayRequests(actor, child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(await fixturePrisma.casualDayRequest.count({ where: { childId: child.id } })).toBe(0);
  });

  it('validates the date window (centre today to +90), the room, and the note length', async () => {
    const { tenant, parent, child } = await family('CasValidate');
    await expect(service.requestCasualDay(parent, child.id, { date: addDays(TODAY, -1) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.requestCasualDay(parent, child.id, { date: addDays(TODAY, 91) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.requestCasualDay(parent, child.id, { date: DAY, note: 'x'.repeat(501) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.requestCasualDay(parent, child.id, { date: TODAY }, NOW)).resolves.toMatchObject({ date: TODAY });
    await expect(service.requestCasualDay(parent, child.id, { date: addDays(TODAY, 90), note: 'x'.repeat(500) }, NOW)).resolves.toMatchObject({ status: 'PENDING' });

    const unroomed = await makeChild(tenant, { roomId: null });
    await link(tenant, parent, unroomed.id);
    await expect(service.requestCasualDay(parent, unroomed.id, { date: DAY }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(await fixturePrisma.casualDayRequest.count({ where: { childId: { in: [child.id, unroomed.id] } } })).toBe(2);
  });

  it('conflicts with an existing booking that covers the date, or a PENDING/APPROVED request; declined and cancelled requests do not block', async () => {
    const { tenant, admin, parent, child, fee } = await family('CasConflict');

    // Permanent booking on this weekday, within its date range -> conflict.
    const perm = await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: fee.id, bookingType: 'PERMANENT', daysOfWeek: [dayOfWeek(DAY)], startDate: new Date('2026-01-01') },
    });
    await expect(service.requestCasualDay(parent, child.id, { date: DAY }, NOW)).rejects.toBeInstanceOf(ConflictException);
    // A different weekday is fine, and a booking that has ended before the date does not conflict.
    await expect(service.requestCasualDay(parent, child.id, { date: addDays(DAY, 1) }, NOW)).resolves.toMatchObject({ status: 'PENDING' });
    await fixturePrisma.booking.update({ where: { id: perm.id }, data: { endDate: new Date(addDays(DAY, -1)) } });
    const afterEnd = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    expect(afterEnd.status).toBe('PENDING');

    // PENDING duplicate -> conflict; after decline a new one is allowed.
    await expect(service.requestCasualDay(parent, child.id, { date: DAY }, NOW)).rejects.toBeInstanceOf(ConflictException);
    await service.declineCasualDay(admin, afterEnd.id, {}, NOW);
    const second = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    // Cancelled also does not block.
    await service.cancelCasualDayRequest(parent, second.id);
    const third = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    // APPROVED blocks.
    await service.approveCasualDay(admin, third.id, {}, NOW);
    await expect(service.requestCasualDay(parent, child.id, { date: DAY }, NOW)).rejects.toBeInstanceOf(ConflictException);

    // A CASUAL booking on the date also conflicts.
    const otherDate = addDays(DAY, 14);
    await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: fee.id, bookingType: 'CASUAL', daysOfWeek: [], specificDate: new Date(otherDate), startDate: new Date(otherDate), endDate: new Date(otherDate) },
    });
    await expect(service.requestCasualDay(parent, child.id, { date: otherDate }, NOW)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists a child\'s requests from 30 days back, newest date first, for parents and admins only', async () => {
    const { tenant, admin, parent, educator, child } = await family('CasList');
    for (const [d, status] of [[addDays(TODAY, -31), 'DECLINED'], [addDays(TODAY, -30), 'DECLINED'], [addDays(TODAY, 3), 'PENDING'], [addDays(TODAY, 20), 'PENDING']] as const) {
      await fixturePrisma.casualDayRequest.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, date: new Date(d), status, requestedByUserId: parent.userId },
      });
    }
    const expected = [addDays(TODAY, 20), addDays(TODAY, 3), addDays(TODAY, -30)];
    expect((await service.listCasualDayRequests(parent, child.id, NOW)).map((r) => r.date)).toEqual(expected);
    expect((await service.listCasualDayRequests(admin, child.id, NOW)).map((r) => r.date)).toEqual(expected);
    await expect(service.listCasualDayRequests(educator, child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the pending queue shows only PENDING requests in the admin\'s centre, by date ascending, with child and room names; admin-only', async () => {
    const { tenant, admin, parent, educator, child } = await family('CasQueue');
    const later = await service.requestCasualDay(parent, child.id, { date: addDays(TODAY, 10) }, NOW);
    const sooner = await service.requestCasualDay(parent, child.id, { date: addDays(TODAY, 4) }, NOW);
    const declined = await service.requestCasualDay(parent, child.id, { date: addDays(TODAY, 6) }, NOW);
    await service.declineCasualDay(admin, declined.id, {}, NOW);

    // Another centre in the same org, and another org, must not leak in.
    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Second centre' } });
    const otherRoom = await fixturePrisma.room.create({ data: { orgId: tenant.orgId, centreId: otherCentre.id, name: 'R2' } });
    const otherChild = await makeChild({ orgId: tenant.orgId, centreId: otherCentre.id, roomId: otherRoom.id });
    await fixturePrisma.casualDayRequest.create({ data: { orgId: tenant.orgId, centreId: otherCentre.id, childId: otherChild.id, date: new Date(DAY), status: 'PENDING', requestedByUserId: parent.userId } });
    const foreign = await family('CasQueueForeign');
    await service.requestCasualDay(foreign.parent, foreign.child.id, { date: DAY }, NOW);

    const queue = await service.listPendingCasualDayRequests(admin, NOW);
    expect(queue.map((r) => r.id)).toEqual([sooner.id, later.id]);
    const room = await fixturePrisma.room.findUniqueOrThrow({ where: { id: tenant.roomId } });
    expect(queue[0]).toMatchObject({ child: { id: child.id, firstName: child.firstName, lastName: child.lastName }, roomName: room.name, status: 'PENDING' });

    await expect(service.listPendingCasualDayRequests(parent, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listPendingCasualDayRequests(educator, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approving creates exactly one CASUAL booking at the room fee schedule and marks the request APPROVED, audited', async () => {
    const { tenant, admin, parent, child } = await family('CasApprove');
    // Prefer the room-specific schedule over the centre-wide one.
    const roomFee = await makeFeeSchedule(tenant, { amountCents: 15000, roomId: tenant.roomId });
    const req = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);

    const approved = await service.approveCasualDay(admin, req.id, {}, NOW);
    expect(approved).toMatchObject({ id: req.id, status: 'APPROVED' });
    expect(approved.decidedAt).not.toBeNull();

    const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row).toMatchObject({ status: 'APPROVED', decidedByUserId: admin.userId });
    expect(row.decidedAt).toBeInstanceOf(Date);
    const bookings = await fixturePrisma.booking.findMany({ where: { childId: child.id } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ id: row.bookingId, bookingType: 'CASUAL', roomId: tenant.roomId, feeScheduleId: roomFee.id, daysOfWeek: [], orgId: tenant.orgId, centreId: tenant.centreId });
    for (const d of [bookings[0].specificDate, bookings[0].startDate, bookings[0].endDate]) {
      expect(d?.toISOString().slice(0, 10)).toBe(DAY);
    }

    const audits = (await auditFor(req.id)).filter((a) => a.action === 'casual_day.approved');
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ requestId: req.id, bookingId: bookings[0].id });
  });

  it('falls back to the centre-wide schedule effective on the date; an explicit schedule must be same-centre and effective', async () => {
    const { tenant, admin, parent, child, fee } = await family('CasFee');
    const req = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);

    const expiredFee = await makeFeeSchedule(tenant, { roomId: tenant.roomId, effectiveFrom: '2025-01-01', effectiveTo: addDays(DAY, -1) });
    const futureFee = await makeFeeSchedule(tenant, { effectiveFrom: addDays(DAY, 1) });
    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Fee other centre' } });
    const foreignCentreFee = await makeFeeSchedule({ orgId: tenant.orgId, centreId: otherCentre.id });
    for (const bad of [expiredFee.id, futureFee.id, foreignCentreFee.id, randomUUID()]) {
      await expect(service.approveCasualDay(admin, req.id, { feeScheduleId: bad }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect((await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
    expect(await fixturePrisma.booking.count({ where: { childId: child.id } })).toBe(0);

    // No explicit id: the room schedule is expired, so the centre-wide `fee` (and not the future one) is chosen.
    const approved = await service.approveCasualDay(admin, req.id, {}, NOW);
    expect(approved.status).toBe('APPROVED');
    expect((await fixturePrisma.booking.findFirstOrThrow({ where: { childId: child.id } })).feeScheduleId).toBe(fee.id);
  });

  it('an explicit effective same-centre schedule is used; with no schedule at all approval is a BadRequest', async () => {
    const { tenant, admin, parent, child, fee } = await family('CasFeeExplicit');
    const special = await makeFeeSchedule(tenant, { amountCents: 9000, roomId: tenant.roomId });
    const req = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    await service.approveCasualDay(admin, req.id, { feeScheduleId: fee.id }, NOW);
    expect((await fixturePrisma.booking.findFirstOrThrow({ where: { childId: child.id } })).feeScheduleId).toBe(fee.id);
    expect(special.id).not.toBe(fee.id);

    const bare = await setupFamily('CasNoFee');
    const bareReq = await service.requestCasualDay(bare.parent, bare.child.id, { date: DAY }, NOW);
    await expect(service.approveCasualDay(bare.admin, bareReq.id, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(await fixturePrisma.booking.count({ where: { childId: bare.child.id } })).toBe(0);
    expect((await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: bareReq.id } })).status).toBe('PENDING');
  });

  it('approve rules: admin of that centre only, only PENDING, not in the past, and atomic against a booking made meanwhile', async () => {
    const { tenant, admin, parent, educator, child, fee } = await family('CasApproveRules');
    const req = await service.requestCasualDay(parent, child.id, { date: TODAY }, NOW);

    await expect(service.approveCasualDay(parent, req.id, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approveCasualDay(educator, req.id, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    const otherCentre = await fixturePrisma.centre.create({ data: { orgId: tenant.orgId, name: 'Approve other centre' } });
    const otherAdmin = await makeUser({ orgId: tenant.orgId, centreId: otherCentre.id }, 'CENTRE_ADMIN');
    await expect(service.approveCasualDay(otherAdmin, req.id, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approveCasualDay(admin, randomUUID(), {}, NOW)).rejects.toBeInstanceOf(NotFoundException);

    // The requested day (TODAY) has passed by the time the admin looks at it.
    await expect(service.approveCasualDay(admin, req.id, {}, LATER)).rejects.toBeInstanceOf(BadRequestException);
    expect(await fixturePrisma.booking.count({ where: { childId: child.id } })).toBe(0);

    // Booked meanwhile: Conflict, request stays PENDING, no partial booking.
    await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: fee.id, bookingType: 'PERMANENT', daysOfWeek: [dayOfWeek(TODAY)], startDate: new Date('2026-01-01') },
    });
    await expect(service.approveCasualDay(admin, req.id, {}, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(await fixturePrisma.booking.count({ where: { childId: child.id } })).toBe(1);
    const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row).toMatchObject({ status: 'PENDING', bookingId: null, decidedByUserId: null });

    // Not PENDING any more -> Conflict.
    await fixturePrisma.booking.deleteMany({ where: { childId: child.id } });
    await service.approveCasualDay(admin, req.id, {}, NOW);
    await expect(service.approveCasualDay(admin, req.id, {}, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(await fixturePrisma.booking.count({ where: { childId: child.id } })).toBe(1);
  });

  it('billing: the approved day is chargeable at the fee schedule rate, and a younger sibling gets the sibling discount', async () => {
    const f = await family('CasBilling');
    // `child` was created first (elder). Give them a standing booking so they count for the discount.
    await fixturePrisma.booking.create({
      data: { orgId: f.tenant.orgId, centreId: f.tenant.centreId, childId: f.child.id, roomId: f.tenant.roomId, feeScheduleId: f.fee.id, bookingType: 'PERMANENT', daysOfWeek: [1], startDate: new Date('2026-01-01') },
    });
    const younger = await makeChild(f.tenant, { firstName: 'Younger' });
    await link(f.tenant, f.parent, younger.id);

    const cycle = [new Date(`${DAY}T00:00:00Z`), new Date(`${DAY}T00:00:00Z`)] as const;
    expect(await feeCalculation.getChargeableSessions(fixturePrisma, younger.id, ...cycle)).toHaveLength(0);

    const req = await service.requestCasualDay(f.parent, younger.id, { date: DAY }, NOW);
    expect(await feeCalculation.getChargeableSessions(fixturePrisma, younger.id, ...cycle)).toHaveLength(0); // pending is not billed
    await service.approveCasualDay(f.admin, req.id, { feeScheduleId: f.fee.id }, NOW);

    const sessions = await feeCalculation.getChargeableSessions(fixturePrisma, younger.id, ...cycle);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ feeScheduleId: f.fee.id, baseFeeCents: 12000, siblingDiscountPercent: 10, grossCents: 10800 });
  });

  it('decline: records the reason (max 500), only from PENDING, admin of that centre only, audited without the reason text', async () => {
    const { admin, parent, educator, child } = await family('CasDecline');
    const req = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);

    await expect(service.declineCasualDay(parent, req.id, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.declineCasualDay(educator, req.id, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.declineCasualDay(admin, req.id, { reason: 'x'.repeat(501) }, NOW)).rejects.toBeInstanceOf(BadRequestException);

    const declined = await service.declineCasualDay(admin, req.id, { reason: 'Room full secret-decline' }, NOW);
    expect(declined).toMatchObject({ status: 'DECLINED', declineReason: 'Room full secret-decline' });
    expect(declined.decidedAt).not.toBeNull();
    const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row).toMatchObject({ status: 'DECLINED', decidedByUserId: admin.userId, bookingId: null });
    expect(await fixturePrisma.booking.count({ where: { childId: child.id } })).toBe(0);

    await expect(service.declineCasualDay(admin, req.id, {}, NOW)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.approveCasualDay(admin, req.id, {}, NOW)).rejects.toBeInstanceOf(ConflictException);

    const audits = (await auditFor(req.id)).filter((a) => a.action === 'casual_day.declined');
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].metadata ?? {})).not.toContain('secret-decline');
  });

  it('cancel: only the requesting parent, only while PENDING; approved needs the centre; others cannot', async () => {
    const { tenant, admin, parent, educator, child } = await family('CasCancel');
    const coParent = await makeUser(tenant, 'PARENT');
    await link(tenant, coParent, child.id);
    const stranger = await makeUser(tenant, 'PARENT');
    const strangerChild = await makeChild(tenant);
    await link(tenant, stranger, strangerChild.id);

    const req = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    for (const actor of [coParent, stranger, educator, admin]) {
      await expect(service.cancelCasualDayRequest(actor, req.id)).rejects.toThrow();
    }
    expect((await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');

    expect(await service.cancelCasualDayRequest(parent, req.id)).toMatchObject({ id: req.id, status: 'CANCELLED' });
    await expect(service.cancelCasualDayRequest(parent, req.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.approveCasualDay(admin, req.id, {}, NOW)).rejects.toBeInstanceOf(ConflictException);

    const second = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    await service.approveCasualDay(admin, second.id, {}, NOW);
    await expect(service.cancelCasualDayRequest(parent, second.id)).rejects.toThrow(/centre/i);
    await expect(service.cancelCasualDayRequest(parent, second.id)).rejects.toBeInstanceOf(ConflictException);
    expect((await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('APPROVED');
  });

  it('a requester who is later restricted can no longer cancel', async () => {
    const { tenant, parent, child } = await family('CasCancelRestricted');
    const req = await service.requestCasualDay(parent, child.id, { date: DAY }, NOW);
    await fixturePrisma.guardianChildRelationship.updateMany({ where: { guardianUserId: parent.userId, childId: child.id }, data: { isRestricted: true } });
    await expect(service.cancelCasualDayRequest(parent, req.id)).rejects.toThrow();
    expect((await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
    expect(tenant.orgId).toBeDefined();
  });

  it('tenant isolation: another org cannot see, decide or cancel these requests, and RLS hides the rows', async () => {
    const a = await family('CasIsoA');
    const b = await family('CasIsoB');
    const req = await service.requestCasualDay(a.parent, a.child.id, { date: DAY }, NOW);

    await expect(service.requestCasualDay(b.parent, a.child.id, { date: addDays(DAY, 1) }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listCasualDayRequests(b.admin, a.child.id, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approveCasualDay(b.admin, req.id, {}, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.declineCasualDay(b.admin, req.id, {}, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancelCasualDayRequest(b.parent, req.id)).rejects.toThrow();
    expect((await service.listPendingCasualDayRequests(b.admin, NOW)).map((r) => r.id)).not.toContain(req.id);
    expect(await fixturePrisma.booking.count({ where: { childId: a.child.id } })).toBe(0);
    expect((await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');

    await setTenantContext(appPrisma, b.tenant.orgId, b.tenant.centreId);
    expect(await appPrisma.casualDayRequest.findMany({ where: { id: req.id } })).toHaveLength(0);
    await setTenantContext(appPrisma, a.tenant.orgId, a.tenant.centreId);
    expect(await appPrisma.casualDayRequest.findMany({ where: { id: req.id } })).toHaveLength(1);
  });
});
