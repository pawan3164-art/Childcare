export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

/** An amount taken off the balance: "−$12.50", or "$0.00" when there is none. */
export function formatDeduction(cents: number): string {
  return cents === 0 ? formatCents(0) : `−${formatCents(cents)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

/**
 * A child's age as a parent says it: months under two years, then years and
 * months. Only whole months count (an unreached day-of-month is not a month).
 */
export function ageLabel(dateOfBirth: string, now: Date): string {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  let months = (now.getFullYear() - by) * 12 + (now.getMonth() + 1 - bm);
  if (now.getDate() < bd) months -= 1;
  if (months < 1) return 'Under 1 mth';
  const mths = (n: number) => `${n} ${n === 1 ? 'mth' : 'mths'}`;
  if (months < 24) return mths(months);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years} yrs` : `${years} yrs ${mths(rest)}`;
}
