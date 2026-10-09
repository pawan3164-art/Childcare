import { formatCents, formatDeduction, formatDate, formatDateTime, formatTime, initials, ageLabel } from '@/lib/format';

describe('formatCents', () => {
  it('formats dollars and cents', () => expect(formatCents(1250)).toBe('$12.50'));
  it('formats zero', () => expect(formatCents(0)).toBe('$0.00'));
  it('formats negatives', () => expect(formatCents(-1250)).toBe('-$12.50'));
  it('uses thousands separators', () => expect(formatCents(123456)).toBe('$1,234.56'));
  it('formats sub-dollar amounts', () => expect(formatCents(5)).toBe('$0.05'));
});

describe('formatDeduction', () => {
  it('prefixes a U+2212 minus', () => expect(formatDeduction(1250)).toBe('−$12.50'));
  it('shows zero without a minus', () => expect(formatDeduction(0)).toBe('$0.00'));
  it('handles thousands', () => expect(formatDeduction(123456)).toBe('−$1,234.56'));
});

describe('date/time formatting', () => {
  const iso = '2026-10-09T03:30:00Z';
  it('formatDate includes day, short month and year', () => expect(formatDate(iso)).toMatch(/9.*Oct.*2026/));
  it('formatDateTime includes month and a time', () => {
    expect(formatDateTime(iso)).toMatch(/Oct/);
    expect(formatDateTime(iso)).toMatch(/\d{1,2}:\d{2}/);
  });
  it('formatTime returns a clock time', () => expect(formatTime(iso)).toMatch(/^\d{1,2}:\d{2}\s?(am|pm)$/i));
});

describe('initials', () => {
  it('uppercases first letters', () => expect(initials('ava', 'smith')).toBe('AS'));
  it('handles empty names', () => {
    expect(initials('', 'Smith')).toBe('S');
    expect(initials('', '')).toBe('');
  });
});

describe('ageLabel', () => {
  const at = (s: string) => new Date(`${s}T12:00:00Z`);
  it('is "Under 1 mth" for a newborn', () => expect(ageLabel('2026-10-01', at('2026-10-09'))).toBe('Under 1 mth'));
  it('is "Under 1 mth" on the birth day', () => expect(ageLabel('2026-10-09', at('2026-10-09'))).toBe('Under 1 mth'));
  it('does not count an incomplete month (day not yet reached)', () => {
    expect(ageLabel('2026-09-10', at('2026-10-09'))).toBe('Under 1 mth');
    expect(ageLabel('2025-04-20', at('2026-10-09'))).toBe('17 mths');
  });
  it('counts a month on the exact day', () => expect(ageLabel('2026-09-09', at('2026-10-09'))).toBe('1 mth'));
  it('pluralises months', () => expect(ageLabel('2026-07-09', at('2026-10-09'))).toBe('3 mths'));
  it('stays in months at 23 months', () => expect(ageLabel('2024-11-09', at('2026-10-09'))).toBe('23 mths'));
  it('switches to years at 24 months', () => expect(ageLabel('2024-10-09', at('2026-10-09'))).toBe('2 yrs'));
  it('shows years and 1 month', () => expect(ageLabel('2024-09-09', at('2026-10-09'))).toBe('2 yrs 1 mth'));
  it('shows years and plural months', () => expect(ageLabel('2022-05-09', at('2026-10-09'))).toBe('4 yrs 5 mths'));
  it('handles a year boundary', () => expect(ageLabel('2025-12-15', at('2026-01-20'))).toBe('1 mth'));
  it('month-end DOB: 31 Jan is not a full month on 28 Feb', () => {
    expect(ageLabel('2026-01-31', at('2026-02-28'))).toBe('Under 1 mth');
  });
  it('month-end DOB: 31 Jan is 2 months on 31 Mar', () => expect(ageLabel('2026-01-31', at('2026-03-31'))).toBe('2 mths'));
  it('leap day DOB is not a full 2 years until 1 Mar in non-leap years', () => {
    expect(ageLabel('2024-02-29', at('2026-02-28'))).toBe('23 mths');
    expect(ageLabel('2024-02-29', at('2026-03-01'))).toBe('2 yrs');
  });
  it('leap day DOB on the next leap day', () => expect(ageLabel('2024-02-29', at('2028-02-29'))).toBe('4 yrs'));
});
