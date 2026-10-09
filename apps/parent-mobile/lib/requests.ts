import type { CasualDayStatus } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `count` consecutive days starting at `today` (YYYY-MM-DD), for a simple day picker. Pure UTC arithmetic: no device timezone involved. */
export function upcomingDays(today: string, count: number): { date: string; weekday: string; day: number; month: string }[] {
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const d = new Date(start + i * DAY_MS);
    return {
      date: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' }),
      day: d.getUTCDate(),
      month: d.toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' }),
    };
  });
}

export function absenceStatus(a: { isAllowable: boolean }): { text: string; tone: 'success' | 'warning' } {
  return a.isAllowable
    ? { text: 'Confirmed, no fee', tone: 'success' }
    : { text: 'Recorded. The centre will confirm whether a fee applies.', tone: 'warning' };
}

export function casualDayStatus(
  status: CasualDayStatus,
  declineReason: string | null,
): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case 'PENDING':
      return { text: 'Waiting for the centre', tone: 'warning' };
    case 'APPROVED':
      return { text: 'Approved', tone: 'success' };
    case 'DECLINED':
      return { text: declineReason?.trim() ? `Declined: ${declineReason}` : 'Declined', tone: 'danger' };
    case 'CANCELLED':
      return { text: 'Cancelled', tone: 'neutral' };
  }
}

const PHONE = /^[0-9+()\- ]{6,20}$/;

/** The same rules the server enforces, so mistakes show up before the request is sent. */
export function validatePickupForm(input: { personName: string; personPhone: string }): { personName?: string; personPhone?: string } {
  const errors: { personName?: string; personPhone?: string } = {};
  const name = input.personName.trim();
  if (name.length < 2 || name.length > 100) errors.personName = 'Enter the person’s full name';
  const phone = input.personPhone.trim();
  if (phone && !PHONE.test(phone)) errors.personPhone = 'Use 6 to 20 digits, spaces, + ( ) or -';
  return errors;
}
