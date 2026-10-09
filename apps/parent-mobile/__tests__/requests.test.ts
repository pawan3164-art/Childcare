import { upcomingDays, absenceStatus, casualDayStatus, validatePickupForm } from '@/lib/requests';

describe('upcomingDays', () => {
  it('returns an empty list for count 0', () => expect(upcomingDays('2026-10-14', 0)).toEqual([]));

  it('starts with today itself and gives en-AU short names', () => {
    expect(upcomingDays('2026-10-14', 1)).toEqual([{ date: '2026-10-14', weekday: 'Wed', day: 14, month: 'Oct' }]);
  });

  it('returns consecutive days', () => {
    const days = upcomingDays('2026-10-14', 3);
    expect(days.map((d) => d.date)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
    expect(days.map((d) => d.weekday)).toEqual(['Wed', 'Thu', 'Fri']);
    expect(days.map((d) => d.day)).toEqual([14, 15, 16]);
  });

  it('returns exactly count entries', () => expect(upcomingDays('2026-10-14', 14)).toHaveLength(14));

  it('crosses a month boundary', () => {
    const days = upcomingDays('2026-10-30', 3);
    expect(days.map((d) => d.date)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(days[2]).toEqual({ date: '2026-11-01', weekday: 'Sun', day: 1, month: 'Nov' });
  });

  it('crosses a year boundary', () => {
    const days = upcomingDays('2026-12-31', 2);
    expect(days[0]).toEqual({ date: '2026-12-31', weekday: 'Thu', day: 31, month: 'Dec' });
    expect(days[1]).toEqual({ date: '2027-01-01', weekday: 'Fri', day: 1, month: 'Jan' });
  });

  it('handles a leap day', () => {
    const days = upcomingDays('2028-02-28', 3);
    expect(days.map((d) => d.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(days[1]).toEqual({ date: '2028-02-29', weekday: 'Tue', day: 29, month: 'Feb' });
  });

  it('skips Feb 29 in a non-leap year', () => {
    expect(upcomingDays('2027-02-28', 2).map((d) => d.date)).toEqual(['2027-02-28', '2027-03-01']);
  });

  it('is timezone independent', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Australia/Sydney', 'UTC']) {
        process.env.TZ = tz;
        expect(upcomingDays('2026-10-14', 2).map((d) => `${d.date}${d.weekday}${d.day}`)).toEqual(['2026-10-14Wed14', '2026-10-15Thu15']);
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it('crosses the Sydney DST change without skipping or repeating a day', () => {
    // DST starts 2026-10-04 in Sydney
    expect(upcomingDays('2026-10-03', 3).map((d) => d.date)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
  });
});

describe('absenceStatus', () => {
  it('allowable', () => expect(absenceStatus({ isAllowable: true })).toEqual({ text: 'Confirmed, no fee', tone: 'success' }));
  it('not allowable', () =>
    expect(absenceStatus({ isAllowable: false })).toEqual({
      text: 'Recorded. The centre will confirm whether a fee applies.',
      tone: 'warning',
    }));
});

describe('casualDayStatus', () => {
  it('pending', () => expect(casualDayStatus('PENDING', null)).toEqual({ text: 'Waiting for the centre', tone: 'warning' }));
  it('approved', () => expect(casualDayStatus('APPROVED', null)).toEqual({ text: 'Approved', tone: 'success' }));
  it('approved ignores any reason', () => expect(casualDayStatus('APPROVED', 'x')).toEqual({ text: 'Approved', tone: 'success' }));
  it('declined with reason', () =>
    expect(casualDayStatus('DECLINED', 'Room is full')).toEqual({ text: 'Declined: Room is full', tone: 'danger' }));
  it('declined with null reason', () => expect(casualDayStatus('DECLINED', null)).toEqual({ text: 'Declined', tone: 'danger' }));
  it('declined with empty reason', () => expect(casualDayStatus('DECLINED', '')).toEqual({ text: 'Declined', tone: 'danger' }));
  it('declined with whitespace-only reason', () => expect(casualDayStatus('DECLINED', '   ')).toEqual({ text: 'Declined', tone: 'danger' }));
  it('cancelled', () => expect(casualDayStatus('CANCELLED', null)).toEqual({ text: 'Cancelled', tone: 'neutral' }));
});

describe('validatePickupForm', () => {
  const NAME_ERR = 'Enter the person’s full name';
  const PHONE_ERR = 'Use 6 to 20 digits, spaces, + ( ) or -';
  const form = (personName: string, personPhone = '') => validatePickupForm({ personName, personPhone });

  it('valid form returns {}', () => expect(form('Jane Citizen', '0412 345 678')).toEqual({}));
  it('valid name with empty phone returns {}', () => expect(form('Jane Citizen', '')).toEqual({}));

  describe('name', () => {
    it('rejects empty', () => expect(form('').personName).toBe(NAME_ERR));
    it('rejects whitespace-only', () => expect(form('     ').personName).toBe(NAME_ERR));
    it('rejects 1 char', () => expect(form('A').personName).toBe(NAME_ERR));
    it('rejects 1 char padded with spaces', () => expect(form('  A  ').personName).toBe(NAME_ERR));
    it('accepts 2 chars', () => expect(form('Al')).toEqual({}));
    it('accepts 2 chars padded with spaces', () => expect(form('  Al  ')).toEqual({}));
    it('accepts 100 chars', () => expect(form('a'.repeat(100))).toEqual({}));
    it('accepts 100 chars with surrounding spaces', () => expect(form(`  ${'a'.repeat(100)}  `)).toEqual({}));
    it('rejects 101 chars', () => expect(form('a'.repeat(101)).personName).toBe(NAME_ERR));
  });

  describe('phone', () => {
    it('empty is valid', () => expect(form('Jane', '')).toEqual({}));
    it('whitespace-only is valid', () => expect(form('Jane', '    ')).toEqual({}));
    it('rejects 5 chars', () => expect(form('Jane', '12345').personPhone).toBe(PHONE_ERR));
    it('accepts 6 chars', () => expect(form('Jane', '123456')).toEqual({}));
    it('accepts 20 chars', () => expect(form('Jane', '1'.repeat(20))).toEqual({}));
    it('rejects 21 chars', () => expect(form('Jane', '1'.repeat(21)).personPhone).toBe(PHONE_ERR));
    it('rejects letters', () => expect(form('Jane', '0412abc678').personPhone).toBe(PHONE_ERR));
    it('rejects angle brackets', () => expect(form('Jane', '<123456>').personPhone).toBe(PHONE_ERR));
    it('accepts + ( ) - and spaces', () => expect(form('Jane', '+61 (4) 12-345-678')).toEqual({}));
    it('ignores leading and trailing spaces', () => expect(form('Jane', '   123456   ')).toEqual({}));
    it('counts length after trimming (20 chars padded)', () => expect(form('Jane', `  ${'1'.repeat(20)}  `)).toEqual({}));
    it('counts length after trimming (5 chars padded)', () => expect(form('Jane', `  12345  `).personPhone).toBe(PHONE_ERR));
  });

  it('returns both errors when both fields are invalid', () => {
    expect(form('A', 'abc')).toEqual({ personName: NAME_ERR, personPhone: PHONE_ERR });
  });

  it('only reports the invalid field', () => {
    expect(form('A', '123456')).toEqual({ personName: NAME_ERR });
    expect(form('Jane', 'abc')).toEqual({ personPhone: PHONE_ERR });
  });
});
