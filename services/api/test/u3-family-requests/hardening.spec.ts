import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { FamilyRequestsService } from '../../src/family-requests/family-requests.service';
import { RequestUser } from '../../src/authorization/request-user.interface';
import { disconnectAll, fixturePrisma } from '../test-utils';
import { NOW, TODAY, addDays, auditFor, buildService, link, makeFeeSchedule, makeUser, setupFamily } from './helpers';

const DAY = addDays(TODAY, 7);
const ROUNDS = 5;

/**
 * U3 security-review hardening: concurrency (no double booking, no half-states),
 * pickup cap under load, verified pickups are immutable to cancellation,
 * centre scoping fails closed, range caps and free-text sanitising.
 */
describe('FamilyRequestsService: U3 hardening', () => {
  let prismaService: PrismaService;
  let service: FamilyRequestsService;

  beforeAll(async () => {
    ({ prismaService, service } = await buildService());
  });

  afterAll(async () => {
    await prismaService.onModuleDestroy();
    await disconnectAll();
  });

  async function family(label: string) {
    const f = await setupFamily(label);
    const fee = await makeFeeSchedule(f.tenant, { amountCents: 12000 });
    return { ...f, fee };
  }

  async function pendingRequest(label: string, note?: string) {
    const f = await family(label);
    const req = await service.requestCasualDay(f.parent, f.child.id, { date: DAY, note }, NOW);
    return { ...f, req };
  }

  const bookingsFor = (childId: string) => fixturePrisma.booking.findMany({ where: { childId, bookingType: 'CASUAL' } });
  const auditCount = async (entityId: string, action: string) => (await auditFor(entityId)).filter((a) => a.action === action).length;
  const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'fulfilled').length;

  // ------------------------------------------------------------ 1. approve x approve

  it('concurrent approve: exactly one fulfils, one booking, request linked, one audit entry', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const { tenant, admin, child, req } = await pendingRequest(`RaceApprove${i}`);
      const admin2 = await makeUser(tenant, 'CENTRE_ADMIN');
      const results = await Promise.allSettled([service.approveCasualDay(admin, req.id, {}, NOW), service.approveCasualDay(admin2, req.id, {}, NOW)]);

      expect(fulfilled(results)).toBe(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);

      const bookings = await bookingsFor(child.id);
      expect(bookings).toHaveLength(1);
      const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } });
      expect(row.status).toBe('APPROVED');
      expect(row.bookingId).toBe(bookings[0].id);
      expect(await auditCount(req.id, 'casual_day.approved')).toBe(1);
    }
  });

  // ------------------------------------------------------- 2. approve x cancel, 3. approve x decline

  it('approve vs cancel race always ends consistent', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const { admin, parent, child, req } = await pendingRequest(`RaceCancel${i}`);
      const results = await Promise.allSettled([service.approveCasualDay(admin, req.id, {}, NOW), service.cancelCasualDayRequest(parent, req.id)]);

      expect(fulfilled(results)).toBe(1);
      const bookings = await bookingsFor(child.id);
      const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } });
      if (row.status === 'APPROVED') {
        expect(bookings).toHaveLength(1);
        expect(row.bookingId).toBe(bookings[0].id);
      } else {
        expect(row.status).toBe('CANCELLED');
        expect(bookings).toHaveLength(0);
        expect(row.bookingId).toBeNull();
      }
    }
  });

  it('approve vs decline race always ends consistent', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const { tenant, admin, child, req } = await pendingRequest(`RaceDecline${i}`);
      const admin2 = await makeUser(tenant, 'CENTRE_ADMIN');
      const results = await Promise.allSettled([service.approveCasualDay(admin, req.id, {}, NOW), service.declineCasualDay(admin2, req.id, { reason: 'No room' }, NOW)]);

      expect(fulfilled(results)).toBe(1);
      const bookings = await bookingsFor(child.id);
      const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } });
      if (row.status === 'APPROVED') {
        expect(bookings).toHaveLength(1);
        expect(row.bookingId).toBe(bookings[0].id);
      } else {
        expect(row.status).toBe('DECLINED');
        expect(bookings).toHaveLength(0);
        expect(row.bookingId).toBeNull();
      }
    }
  });

  // ------------------------------------------------------------ 4. double decline / double cancel

  it('double decline and double cancel concurrently: one wins, one audit entry each', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const { tenant, admin, req } = await pendingRequest(`DoubleDecline${i}`);
      const admin2 = await makeUser(tenant, 'CENTRE_ADMIN');
      const results = await Promise.allSettled([service.declineCasualDay(admin, req.id, {}, NOW), service.declineCasualDay(admin2, req.id, {}, NOW)]);
      expect(fulfilled(results)).toBe(1);
      expect(await auditCount(req.id, 'casual_day.declined')).toBe(1);
    }
    for (let i = 0; i < ROUNDS; i++) {
      const { parent, req } = await pendingRequest(`DoubleCancel${i}`);
      const results = await Promise.allSettled([service.cancelCasualDayRequest(parent, req.id), service.cancelCasualDayRequest(parent, req.id)]);
      expect(fulfilled(results)).toBe(1);
      expect(await auditCount(req.id, 'casual_day.cancelled')).toBe(1);
    }
  });

  // ------------------------------------------------------------ 5. pickup cap

  it('pickup cap holds under concurrency: 3 fulfil, 3 conflict, 3 active rows', async () => {
    for (let i = 0; i < 2; i++) {
      const { tenant, parent, child } = await family(`PickupCap${i}`);
      const parent2 = await makeUser(tenant, 'PARENT');
      await link(tenant, parent2, child.id, { canPickup: true });
      const results = await Promise.allSettled(
        [0, 1, 2, 3, 4, 5].map((n) => service.nominatePickup(n % 2 === 0 ? parent : parent2, child.id, { date: DAY, personName: `Person ${n}` }, NOW)),
      );
      expect(fulfilled(results)).toBe(3);
      for (const r of results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
        expect(r.reason).toBeInstanceOf(ConflictException);
      }
      expect(await fixturePrisma.pickupNomination.count({ where: { childId: child.id, status: 'ACTIVE' } })).toBe(3);
    }
  });

  // ------------------------------------------------------------ 6. cancel after verification

  it('a verified nomination cannot be cancelled by its parent or an admin', async () => {
    const { admin, educator, parent, child } = await family('CancelVerified');
    const n = await service.nominatePickup(parent, child.id, { date: TODAY, personName: 'Uncle Bob' }, NOW);
    await service.verifyPickup(educator, n.id, NOW);

    for (const actor of [parent, admin]) {
      const err = await service.cancelPickupNomination(actor, n.id).then(
        () => null,
        (e) => e,
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toMatch(/already.*checked/i);
    }
    const row = await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.status).toBe('ACTIVE');
    expect(row.verifiedAt).not.toBeNull();
  });

  // ------------------------------------------------------------ 7. verify x cancel

  it('verify vs cancel race never leaves CANCELLED and verified', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const { educator, parent, child } = await family(`VerifyCancel${i}`);
      const n = await service.nominatePickup(parent, child.id, { date: TODAY, personName: 'Aunt May' }, NOW);
      await Promise.allSettled([service.verifyPickup(educator, n.id, NOW), service.cancelPickupNomination(parent, n.id)]);
      const row = await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: n.id } });
      if (row.status === 'ACTIVE') {
        expect(row.verifiedAt).not.toBeNull();
      } else {
        expect(row.status).toBe('CANCELLED');
        expect(row.verifiedAt).toBeNull();
        expect(row.verifiedByUserId).toBeNull();
      }
    }
  });

  // ------------------------------------------------------------ 8. fail-closed centre scoping

  it('a CENTRE_ADMIN with no centre is Forbidden on centre-wide operations; ORG_ADMIN still lists', async () => {
    const { tenant, parent, child, req } = await pendingRequest('FailClosed');
    const absence = await service.reportAbsence(parent, child.id, { date: DAY }, NOW);
    const nocentre: RequestUser = { ...(await makeUser(tenant, 'CENTRE_ADMIN')), centreId: null };

    await expect(service.listCentreAbsences(nocentre, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listPendingCasualDayRequests(nocentre, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listPickupsForDate(nocentre, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approveCasualDay(nocentre, req.id, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setAbsenceAllowable(nocentre, absence.id, true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'PENDING', bookingId: null });

    const orgAdmin: RequestUser = { ...(await makeUser(tenant, 'ORG_ADMIN')), centreId: null };
    await expect(service.listCentreAbsences(orgAdmin, { from: DAY, to: DAY }, NOW)).resolves.toEqual(expect.any(Array));
    await expect(service.listPendingCasualDayRequests(orgAdmin, NOW)).resolves.toEqual(expect.any(Array));
    await expect(service.listPickupsForDate(orgAdmin, { date: DAY }, NOW)).resolves.toEqual(expect.any(Array));
  });

  // ------------------------------------------------------------ 9. range cap

  it('listCentreAbsences: a range over 366 days is rejected, exactly 366 is allowed', async () => {
    const { admin } = await family('RangeCap');
    const from = '2026-10-01';
    await expect(service.listCentreAbsences(admin, { from, to: addDays(from, 366) }, NOW)).resolves.toEqual(expect.any(Array));
    await expect(service.listCentreAbsences(admin, { from, to: addDays(from, 367) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listCentreAbsences(admin, { from, to: addDays(from, 5000) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  // ------------------------------------------------------------ 10. text sanitising

  const DIRTY = (s: string) => `‮${s}\u0000‏`;

  it('strips control and bidirectional characters from the pickup name and returns the clean name', async () => {
    const { parent, child } = await family('SanitiseName');
    const view = await service.nominatePickup(parent, child.id, { date: DAY, personName: '‮Evil\u0000 Name‏' }, NOW);
    expect(view.personName).toBe('Evil Name');
    const row = await fixturePrisma.pickupNomination.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.personName).toBe('Evil Name');

    await expect(service.nominatePickup(parent, child.id, { date: DAY, personName: '‮\u0000‏ ‬' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    // Stripped text is what the length limits apply to.
    await expect(service.nominatePickup(parent, child.id, { date: DAY, personName: `A\u0000` }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.nominatePickup(parent, child.id, { date: DAY, personName: DIRTY('x'.repeat(100)) }, NOW)).resolves.toMatchObject({ personName: 'x'.repeat(100) });
  });

  it('strips the same characters from pickup note, absence reason, casual note and decline reason, keeping newlines and tabs', async () => {
    const { admin, parent, child } = await family('SanitiseText');

    const pickup = await service.nominatePickup(parent, child.id, { date: DAY, personName: 'Clean Name', note: `${DIRTY('Gate\ncode\t42')}` }, NOW);
    expect(pickup.note).toBe('Gate\ncode\t42');
    await expect(
      service.nominatePickup(parent, child.id, { date: addDays(DAY, 1), personName: 'Clean Name', note: DIRTY('n'.repeat(300)) }, NOW),
    ).resolves.toMatchObject({ note: 'n'.repeat(300) });
    await expect(
      service.nominatePickup(parent, child.id, { date: addDays(DAY, 2), personName: 'Clean Name', note: DIRTY('n'.repeat(301)) }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);

    const absence = await service.reportAbsence(parent, child.id, { date: DAY, reason: DIRTY('Sick\nvery\tsick') }, NOW);
    expect(absence.reason).toBe('Sick\nvery\tsick');
    await expect(service.reportAbsence(parent, child.id, { date: addDays(DAY, 1), reason: DIRTY('r'.repeat(500)) }, NOW)).resolves.toMatchObject({ reason: 'r'.repeat(500) });
    // Only control characters: becomes empty, stored as no reason.
    await expect(service.reportAbsence(parent, child.id, { date: addDays(DAY, 2), reason: '‮\u0000‏' }, NOW)).resolves.toMatchObject({ reason: null });

    const casual = await service.requestCasualDay(parent, child.id, { date: DAY, note: DIRTY('Extra\nday\tplease') }, NOW);
    expect(casual.note).toBe('Extra\nday\tplease');
    await expect(service.requestCasualDay(parent, child.id, { date: addDays(DAY, 1), note: DIRTY('m'.repeat(500)) }, NOW)).resolves.toMatchObject({ note: 'm'.repeat(500) });
    await expect(service.requestCasualDay(parent, child.id, { date: addDays(DAY, 2), note: DIRTY('m'.repeat(501)) }, NOW)).rejects.toBeInstanceOf(BadRequestException);

    const declined = await service.declineCasualDay(admin, casual.id, { reason: DIRTY('Full\nup\tsorry') }, NOW);
    expect(declined.declineReason).toBe('Full\nup\tsorry');
    const other = await service.requestCasualDay(parent, child.id, { date: addDays(DAY, 3) }, NOW);
    await expect(service.declineCasualDay(admin, other.id, { reason: DIRTY('d'.repeat(501)) }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    const row = await fixturePrisma.casualDayRequest.findUniqueOrThrow({ where: { id: casual.id } });
    expect(row.declineReason).toBe('Full\nup\tsorry');
  });
});
