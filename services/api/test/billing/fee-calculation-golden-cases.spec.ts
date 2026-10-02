import { FeeCalculationService } from '../../src/billing/fee-calculation.service';
import { disconnectAll, fixturePrisma, seedOrgCentreRoom, uniqueSuffix } from '../test-utils';

/**
 * Delivery Plan §6.3: "Golden-case test suite for fee, discount, absence and
 * subsidy calculations, written with a childcare billing expert before the
 * code." These are the known-input/known-output cases a billing expert
 * would check first — integer cents throughout, no floating point.
 */
describe('FeeCalculationService: golden cases', () => {
  const feeCalculation = new FeeCalculationService();

  afterAll(async () => {
    await disconnectAll();
  });

  async function makeChild(tenant: { orgId: string; centreId: string; roomId: string }, label: string) {
    return fixturePrisma.child.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        roomId: tenant.roomId,
        firstName: label,
        lastName: `Fee-${uniqueSuffix()}`,
        dateOfBirth: new Date('2023-01-01'),
      },
    });
  }

  async function makeFeeSchedule(
    tenant: { orgId: string; centreId: string },
    amountCents: number,
    siblingDiscountPercent = 0,
  ) {
    return fixturePrisma.feeSchedule.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        name: `Daily fee ${uniqueSuffix()}`,
        feeType: 'DAILY',
        amountCents,
        siblingDiscountPercent,
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }

  // Monday 2026-01-05 through Friday 2026-01-09.
  const WEEK_START = new Date('2026-01-05T00:00:00Z');
  const WEEK_END = new Date('2026-01-09T00:00:00Z');

  it('a 5-day/week permanent booking over a Mon-Fri cycle charges exactly 5 sessions at the base fee', async () => {
    const tenant = await seedOrgCentreRoom('FeeBasic');
    const child = await makeChild(tenant, 'Basic');
    const feeSchedule = await makeFeeSchedule(tenant, 10000); // $100.00/day

    await fixturePrisma.booking.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        childId: child.id,
        roomId: tenant.roomId,
        feeScheduleId: feeSchedule.id,
        bookingType: 'PERMANENT',
        daysOfWeek: [1, 2, 3, 4, 5],
        startDate: new Date('2026-01-01'),
      },
    });

    const sessions = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, WEEK_START, WEEK_END);

    expect(sessions).toHaveLength(5);
    expect(sessions.every((s) => s.grossCents === 10000)).toBe(true);
    expect(sessions.reduce((sum, s) => sum + s.grossCents, 0)).toBe(50000);
  });

  it('an allowable absence on a booked day removes that day\'s fee entirely', async () => {
    const tenant = await seedOrgCentreRoom('FeeAllowableAbsence');
    const child = await makeChild(tenant, 'AllowAbs');
    const feeSchedule = await makeFeeSchedule(tenant, 10000);
    await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: feeSchedule.id, bookingType: 'PERMANENT', daysOfWeek: [1, 2, 3, 4, 5], startDate: new Date('2026-01-01') },
    });
    await fixturePrisma.absence.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, date: new Date('2026-01-07'), isAllowable: true, reason: 'Sick day' },
    });

    const sessions = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, WEEK_START, WEEK_END);

    expect(sessions).toHaveLength(4); // Wednesday excluded
    expect(sessions.reduce((sum, s) => sum + s.grossCents, 0)).toBe(40000);
  });

  it('a non-allowable absence still charges the full fee for that day', async () => {
    const tenant = await seedOrgCentreRoom('FeeNonAllowableAbsence');
    const child = await makeChild(tenant, 'NonAllowAbs');
    const feeSchedule = await makeFeeSchedule(tenant, 10000);
    await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: feeSchedule.id, bookingType: 'PERMANENT', daysOfWeek: [1, 2, 3, 4, 5], startDate: new Date('2026-01-01') },
    });
    await fixturePrisma.absence.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, date: new Date('2026-01-07'), isAllowable: false, reason: 'Unexplained' },
    });

    const sessions = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, WEEK_START, WEEK_END);

    expect(sessions).toHaveLength(5);
    expect(sessions.reduce((sum, s) => sum + s.grossCents, 0)).toBe(50000);
  });

  it('a casual booking charges only its specific date, not every matching weekday', async () => {
    const tenant = await seedOrgCentreRoom('FeeCasual');
    const child = await makeChild(tenant, 'Casual');
    const feeSchedule = await makeFeeSchedule(tenant, 12000);
    await fixturePrisma.booking.create({
      data: {
        orgId: tenant.orgId,
        centreId: tenant.centreId,
        childId: child.id,
        roomId: tenant.roomId,
        feeScheduleId: feeSchedule.id,
        bookingType: 'CASUAL',
        daysOfWeek: [],
        specificDate: new Date('2026-01-07'),
        startDate: new Date('2026-01-07'),
        endDate: new Date('2026-01-07'),
      },
    });

    const sessions = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, WEEK_START, WEEK_END);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].grossCents).toBe(12000);
  });

  it('the younger sibling (later-enrolled) gets the sibling discount; the elder does not', async () => {
    const tenant = await seedOrgCentreRoom('FeeSibling');
    const guardian = await fixturePrisma.user.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, email: `g-${uniqueSuffix()}@example.test`, passwordHash: 'x', role: 'PARENT', firstName: 'G', lastName: 'P' },
    });
    const elder = await makeChild(tenant, 'Elder');
    await new Promise((r) => setTimeout(r, 5)); // ensure a distinct, later createdAt for the younger sibling
    const younger = await makeChild(tenant, 'Younger');

    for (const child of [elder, younger]) {
      await fixturePrisma.guardianChildRelationship.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, guardianUserId: guardian.id, childId: child.id, relationshipType: 'PARENT' },
      });
    }

    const feeSchedule = await makeFeeSchedule(tenant, 10000, 10); // 10% sibling discount
    for (const child of [elder, younger]) {
      await fixturePrisma.booking.create({
        data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: feeSchedule.id, bookingType: 'PERMANENT', daysOfWeek: [1, 2, 3, 4, 5], startDate: new Date('2026-01-01') },
      });
    }

    const elderSessions = await feeCalculation.getChargeableSessions(fixturePrisma, elder.id, WEEK_START, WEEK_END);
    const youngerSessions = await feeCalculation.getChargeableSessions(fixturePrisma, younger.id, WEEK_START, WEEK_END);

    expect(elderSessions[0].grossCents).toBe(10000); // full price
    expect(elderSessions[0].siblingDiscountPercent).toBe(0);
    expect(youngerSessions[0].grossCents).toBe(9000); // 10% off
    expect(youngerSessions[0].siblingDiscountPercent).toBe(10);
  });

  it('an only child (no siblings with active bookings) is never discounted even if the schedule offers one', async () => {
    const tenant = await seedOrgCentreRoom('FeeOnlyChild');
    const child = await makeChild(tenant, 'OnlyChild');
    const feeSchedule = await makeFeeSchedule(tenant, 10000, 10);
    await fixturePrisma.booking.create({
      data: { orgId: tenant.orgId, centreId: tenant.centreId, childId: child.id, roomId: tenant.roomId, feeScheduleId: feeSchedule.id, bookingType: 'PERMANENT', daysOfWeek: [1, 2, 3, 4, 5], startDate: new Date('2026-01-01') },
    });

    const sessions = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, WEEK_START, WEEK_END);
    expect(sessions[0].grossCents).toBe(10000);
    expect(sessions[0].siblingDiscountPercent).toBe(0);
  });

  it('a child with no booking at all has zero chargeable sessions', async () => {
    const tenant = await seedOrgCentreRoom('FeeNoBooking');
    const child = await makeChild(tenant, 'NoBooking');

    const sessions = await feeCalculation.getChargeableSessions(fixturePrisma, child.id, WEEK_START, WEEK_END);
    expect(sessions).toHaveLength(0);
  });
});
