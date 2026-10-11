import type { AttendanceStatus } from './types';

export type SignEventType = 'SIGN_IN' | 'SIGN_OUT';

/** What the sign button should do next for a child, given today's attendance. */
export function nextSignAction(status: AttendanceStatus): { eventType: SignEventType; label: string } {
  if (status === 'SIGNED_IN') return { eventType: 'SIGN_OUT', label: 'Sign out' };
  if (status === 'SIGNED_OUT') return { eventType: 'SIGN_IN', label: 'Sign in again' };
  return { eventType: 'SIGN_IN', label: 'Sign in' };
}

/** Keeps only digits, at most six, so pasted or spaced codes still work. */
export function normaliseCode(input: string): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\D/g, '').slice(0, 6);
}

export function isCompleteCode(input: string): boolean {
  return normaliseCode(input).length === 6;
}

export function signInResultMessage(eventType: SignEventType, firstName: string, timestampIso: string, timeZone?: string): string {
  const name = typeof firstName === 'string' && firstName.trim() ? firstName.trim() : 'Your child';
  const time = new Date(timestampIso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone });
  return `${name} is signed ${eventType === 'SIGN_IN' ? 'in' : 'out'} at ${time}.`;
}

export function selfSignInErrorMessage(status: number, serverMessage: string, firstName: string): string {
  const msg = serverMessage ?? '';
  const lower = msg.toLowerCase();
  if (status === 403) {
    if (lower.includes('not turned on')) return 'Your centre has not turned on sign-in from the app. Please see a member of staff.';
    if (lower.includes('too many')) return 'Too many wrong codes. Please wait a few minutes or see a member of staff.';
    if (lower.includes('not right') || lower.includes('expired')) return 'That code is not right or has expired. Check the screen at the centre and try again.';
    const name = firstName && firstName.trim() ? firstName.trim() : 'your child';
    return `You don't have permission to sign ${name} in or out. Please see a member of staff.`;
  }
  if (status === 409) return msg;
  if (status === 0) return 'No connection. Try again when you are back online.';
  return msg || 'Something went wrong. Please try again.';
}
