import { describeTimelineEntry, shiftDay, dayLabel } from '@/lib/timeline';
import type { TimelineEntry } from '@/lib/types';

describe('describeTimelineEntry', () => {
  it('sign in', () => {
    const e: TimelineEntry = { kind: 'ATTENDANCE', id: 'a1', at: '2026-10-09T22:00:00Z', eventType: 'SIGN_IN' };
    expect(describeTimelineEntry(e)).toEqual({ icon: 'log-in-outline', title: 'Signed in', detail: null, photoCount: 0 });
  });
  it('sign out', () => {
    const e: TimelineEntry = { kind: 'ATTENDANCE', id: 'a2', at: '2026-10-09T22:00:00Z', eventType: 'SIGN_OUT' };
    expect(describeTimelineEntry(e)).toEqual({ icon: 'log-out-outline', title: 'Signed out', detail: null, photoCount: 0 });
  });
  it('care record uses describeCareRecord and note', () => {
    const e: TimelineEntry = { kind: 'CARE_RECORD', id: 'c1', at: 'x', type: 'NAPPY', note: 'All good', details: { condition: 'WET' } };
    expect(describeTimelineEntry(e)).toEqual({ icon: 'document-text-outline', title: 'Nappy change: wet', detail: 'All good', photoCount: 0 });
  });
  it('care record without note has null detail', () => {
    const e: TimelineEntry = { kind: 'CARE_RECORD', id: 'c2', at: 'x', type: 'SLEEP', note: null, details: { phase: 'END' } };
    expect(describeTimelineEntry(e)).toEqual({ icon: 'document-text-outline', title: 'Woke up', detail: null, photoCount: 0 });
  });
  it('care record with null details', () => {
    const e: TimelineEntry = { kind: 'CARE_RECORD', id: 'c3', at: 'x', type: 'MEAL', note: null, details: null };
    expect(describeTimelineEntry(e).title).toBe('Meal');
  });
  const media = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, url: `u${i}`, width: null, height: null }));
  it('single photo post', () => {
    const e: TimelineEntry = { kind: 'PHOTO_POST', id: 'p1', at: 'x', caption: 'Painting!', media: media(1) };
    expect(describeTimelineEntry(e)).toEqual({ icon: 'camera-outline', title: 'Photo shared', detail: 'Painting!', photoCount: 1 });
  });
  it('multiple photos post, no caption', () => {
    const e: TimelineEntry = { kind: 'PHOTO_POST', id: 'p2', at: 'x', caption: null, media: media(3) };
    expect(describeTimelineEntry(e)).toEqual({ icon: 'camera-outline', title: 'Photos shared', detail: null, photoCount: 3 });
  });
});

describe('shiftDay', () => {
  it('moves forward within a month', () => expect(shiftDay('2026-10-09', 1)).toBe('2026-10-10'));
  it('moves backward', () => expect(shiftDay('2026-10-09', -1)).toBe('2026-10-08'));
  it('zero is identity', () => expect(shiftDay('2026-10-09', 0)).toBe('2026-10-09'));
  it('crosses month boundary', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31');
  });
  it('crosses year boundary', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('handles leap years', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2028-02-29', 1)).toBe('2028-03-01');
    expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('handles multi-day shifts', () => {
    expect(shiftDay('2026-10-09', 30)).toBe('2026-11-08');
    expect(shiftDay('2026-10-09', -9)).toBe('2026-09-30');
  });
});

describe('dayLabel', () => {
  it('Today', () => expect(dayLabel('2026-10-09', '2026-10-09')).toBe('Today'));
  it('Yesterday', () => expect(dayLabel('2026-10-08', '2026-10-09')).toBe('Yesterday'));
  it('Yesterday across a month boundary', () => expect(dayLabel('2026-09-30', '2026-10-01')).toBe('Yesterday'));
  it('short weekday/day/month otherwise', () => expect(dayLabel('2026-10-08', '2026-10-10')).toMatch(/Thu.*8.*Oct/));
  it('does not call tomorrow Today', () => expect(dayLabel('2026-10-10', '2026-10-09')).not.toBe('Today'));
  it('formats an older date', () => expect(dayLabel('2026-10-01', '2026-10-09')).toMatch(/Thu.*1.*Oct/));
});
