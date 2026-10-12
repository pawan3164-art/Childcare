/**
 * Records retention (BRD v2.3 §36.3, decision DL-026).
 *
 * The effective period for a record is the longest applicable minimum:
 *  - Education and Care Services National Regulations, reg. 183: child records
 *    for 3 years after the child's last attendance; incident, injury, trauma and
 *    illness records until the child is 25.
 *  - Family Assistance Law (CCS): attendance and billing records for 7 years.
 * Seven years is therefore the default for everything except incidents. A centre
 * may keep records longer, never shorter. These values are working defaults that
 * compliance must confirm (OI-32).
 */
export const RECORD_TYPES = [
  'attendance',
  'care_records',
  'medication',
  'learning',
  'media',
  'messages',
  'billing',
  'enrolment',
  'incidents',
  'audit_logs',
  'health',
  'forms',
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export type RetentionRule = Readonly<{ years: number }> | Readonly<{ untilAge: number }>;

const sevenYears = Object.freeze({ years: 7 });

export const RETENTION_DEFAULTS: Readonly<Record<RecordType, RetentionRule>> = Object.freeze({
  attendance: sevenYears,
  care_records: sevenYears,
  medication: sevenYears,
  learning: sevenYears,
  media: sevenYears,
  messages: sevenYears,
  billing: sevenYears,
  enrolment: sevenYears,
  incidents: Object.freeze({ untilAge: 25 }),
  audit_logs: sevenYears,
  health: sevenYears,
  forms: sevenYears,
});

/** The only types the purge job deletes or anonymises. The rest are reported as needing manual review. */
export const AUTOMATED_TYPES: readonly RecordType[] = ['attendance', 'care_records', 'media', 'messages', 'health', 'forms', 'enrolment'];
export const NOT_AUTOMATED_TYPES: readonly RecordType[] = RECORD_TYPES.filter((t) => !AUTOMATED_TYPES.includes(t));

/** Anonymising the child record waits until all of these have passed their own periods. */
export const CONTENT_TYPES: readonly RecordType[] = ['attendance', 'care_records', 'media', 'messages', 'health', 'forms'];

export const MAX_OVERRIDE_YEARS = 50;

export const isRecordType = (value: string): value is RecordType => (RECORD_TYPES as readonly string[]).includes(value);

/** The centre-local calendar date (YYYY-MM-DD) at `now`. Servers run in UTC, so never use the UTC date for "today". */
export function localDate(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Calendar addition. 29 February plus a non-leap number of years lands on 1 March (the same as JS Date). */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/** First day on which a departed child's records of `type` may be purged. */
export function eligibleOn(type: RecordType, departedOn: string, dateOfBirth: string, overrideYears?: number): string {
  const rule = RETENTION_DEFAULTS[type];
  if ('untilAge' in rule) return addYears(dateOfBirth, rule.untilAge);
  return addYears(departedOn, Math.max(rule.years, overrideYears ?? 0));
}
