import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface ChargeableSession {
  date: Date;
  feeScheduleId: string;
  grossCents: number; // after sibling discount
  baseFeeCents: number; // before discount, for explainability
  siblingDiscountPercent: number;
}

/**
 * Pure-ish calculation logic, deliberately separated from BillingService so
 * it can be golden-case tested against known inputs/outputs without needing
 * to also exercise invoice/ledger side effects. All money is integer cents —
 * no floating point anywhere in this file.
 */
@Injectable()
export class FeeCalculationService {
  /** Every calendar day in [cycleStart, cycleEnd] inclusive. */
  private enumerateDays(cycleStart: Date, cycleEnd: Date): Date[] {
    const days: Date[] = [];
    const cursor = new Date(cycleStart);
    while (cursor <= cycleEnd) {
      days.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  /**
   * Determines whether `childId` gets the sibling discount: true if at least
   * one OTHER child sharing a guardian with `childId` has an earlier
   * Child.createdAt AND an active booking of their own. The eldest-enrolled
   * sibling always pays full price; younger siblings get the discount
   * defined on their own booking's fee schedule.
   */
  async isSiblingDiscountEligible(
    tx: Prisma.TransactionClient,
    childId: string,
    asOfDate: Date,
  ): Promise<boolean> {
    const thisChild = await tx.child.findUniqueOrThrow({ where: { id: childId } });

    const guardianIds = (
      await tx.guardianChildRelationship.findMany({ where: { childId }, select: { guardianUserId: true } })
    ).map((r) => r.guardianUserId);
    if (guardianIds.length === 0) return false;

    const siblingRelationships = await tx.guardianChildRelationship.findMany({
      where: { guardianUserId: { in: guardianIds }, childId: { not: childId } },
      select: { childId: true },
    });
    const siblingIds = [...new Set(siblingRelationships.map((r) => r.childId))];
    if (siblingIds.length === 0) return false;

    const siblings = await tx.child.findMany({
      where: { id: { in: siblingIds }, createdAt: { lt: thisChild.createdAt } },
    });

    for (const sibling of siblings) {
      const hasActiveBooking = await tx.booking.findFirst({
        where: {
          childId: sibling.id,
          startDate: { lte: asOfDate },
          OR: [{ endDate: null }, { endDate: { gte: asOfDate } }],
        },
      });
      if (hasActiveBooking) return true;
    }
    return false;
  }

  /**
   * Returns the chargeable sessions for a child over a cycle: every day
   * matched by an active booking, minus allowable-absence days, with the
   * sibling discount already applied to grossCents.
   */
  async getChargeableSessions(
    tx: Prisma.TransactionClient,
    childId: string,
    cycleStart: Date,
    cycleEnd: Date,
  ): Promise<ChargeableSession[]> {
    const bookings = await tx.booking.findMany({
      where: {
        childId,
        startDate: { lte: cycleEnd },
        OR: [{ endDate: null }, { endDate: { gte: cycleStart } }],
      },
      include: { feeSchedule: true },
    });
    if (bookings.length === 0) return [];

    const absences = await tx.absence.findMany({
      where: { childId, date: { gte: cycleStart, lte: cycleEnd } },
    });
    const absenceByDate = new Map(absences.map((a) => [a.date.toISOString().slice(0, 10), a]));

    const discountEligible = await this.isSiblingDiscountEligible(tx, childId, cycleStart);

    const sessions: ChargeableSession[] = [];
    for (const day of this.enumerateDays(cycleStart, cycleEnd)) {
      const dayKey = day.toISOString().slice(0, 10);
      const dayOfWeek = day.getUTCDay();

      const matchedBooking = bookings.find((b) => {
        if (day < b.startDate || (b.endDate && day > b.endDate)) return false;
        if (b.bookingType === 'PERMANENT') return b.daysOfWeek.includes(dayOfWeek);
        return b.specificDate && b.specificDate.toISOString().slice(0, 10) === dayKey;
      });
      if (!matchedBooking) continue;

      const absence = absenceByDate.get(dayKey);
      if (absence?.isAllowable) continue; // allowable absence: no fee

      const baseFeeCents = matchedBooking.feeSchedule.amountCents;
      const discountPercent = discountEligible ? matchedBooking.feeSchedule.siblingDiscountPercent : 0;
      const grossCents = Math.round(baseFeeCents * (1 - discountPercent / 100));

      sessions.push({
        date: day,
        feeScheduleId: matchedBooking.feeScheduleId,
        baseFeeCents,
        siblingDiscountPercent: discountPercent,
        grossCents,
      });
    }

    return sessions;
  }
}
