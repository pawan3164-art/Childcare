import { startOfCentreDay } from '../../src/common/time/centre-day';

describe('startOfCentreDay: "today" is the centre\'s local calendar day, not the server\'s', () => {
  it('returns local midnight in Sydney (AEST, UTC+10) as a UTC instant', () => {
    // 2026-07-15 09:30 in Sydney is 2026-07-14 23:30 UTC.
    const now = new Date('2026-07-14T23:30:00Z');
    expect(startOfCentreDay('Australia/Sydney', now).toISOString()).toBe('2026-07-14T14:00:00.000Z');
  });

  it('handles daylight saving in Sydney (AEDT, UTC+11)', () => {
    // 2026-12-01 08:00 in Sydney is 2026-11-30 21:00 UTC.
    const now = new Date('2026-11-30T21:00:00Z');
    expect(startOfCentreDay('Australia/Sydney', now).toISOString()).toBe('2026-11-30T13:00:00.000Z');
  });

  it('uses each centre\'s own timezone: the same instant can be a different day in Perth', () => {
    // 2026-07-14 23:30 UTC is 07:30 on the 15th in Perth (UTC+8, no DST).
    const now = new Date('2026-07-14T23:30:00Z');
    expect(startOfCentreDay('Australia/Perth', now).toISOString()).toBe('2026-07-14T16:00:00.000Z');
  });

  it('works on the day daylight saving starts (23-hour day)', () => {
    // DST starts 2026-10-04 02:00 in Sydney. Midnight that day is still AEST (UTC+10).
    const now = new Date('2026-10-04T05:00:00Z'); // 16:00 AEDT on the 4th
    expect(startOfCentreDay('Australia/Sydney', now).toISOString()).toBe('2026-10-03T14:00:00.000Z');
  });
});
