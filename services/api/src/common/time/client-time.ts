import { BadRequestException } from '@nestjs/common';

/** Device clocks drift; a few minutes ahead is a slow server, not a bad record. */
export const MAX_CLIENT_FUTURE_MS = 5 * 60 * 1000;
/** How long a device may stay offline and still upload what it recorded. */
export const MAX_CLIENT_PAST_MS = 72 * 60 * 60 * 1000;

/**
 * Parses a client-supplied time for a regulatory record (care record,
 * checklist completion) and rejects one that is in the future or older than
 * the offline window. A future time would, for example, silence safe-sleep
 * reminders; an old one would backdate compliance evidence.
 */
export function plausibleClientTime(value: string | Date | undefined | null, label: string, now = Date.now()): Date {
  const t = value instanceof Date ? value : new Date(value ?? '');
  if (Number.isNaN(t.getTime())) throw new BadRequestException(`${label} is not a valid time`);
  if (t.getTime() > now + MAX_CLIENT_FUTURE_MS) throw new BadRequestException(`${label} is in the future; check the device clock`);
  if (t.getTime() < now - MAX_CLIENT_PAST_MS) throw new BadRequestException(`${label} is too far in the past (more than 72 hours); ask a centre admin to record it`);
  return t;
}
