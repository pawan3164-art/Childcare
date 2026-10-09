import { pickSelectedChild, attendanceLabel } from '@/lib/children';
import type { ChildListItem } from '@/lib/types';

const child = (id: string): ChildListItem => ({
  id, firstName: id, lastName: 'L', dateOfBirth: '2023-01-01', roomId: null, roomName: null,
  attendanceStatus: 'NO_EVENTS_TODAY', previousDayNotSignedOut: false,
});

describe('pickSelectedChild', () => {
  const kids = [child('a'), child('b'), child('c')];
  it('returns the preferred child when present', () => expect(pickSelectedChild(kids, 'b')).toBe(kids[1]));
  it('falls back to the first when preferred is missing', () => expect(pickSelectedChild(kids, 'zzz')).toBe(kids[0]));
  it('falls back to the first when preferred is null', () => expect(pickSelectedChild(kids, null)).toBe(kids[0]));
  it('returns null for an empty list', () => {
    expect(pickSelectedChild([], 'a')).toBeNull();
    expect(pickSelectedChild([], null)).toBeNull();
  });
});

describe('attendanceLabel', () => {
  it('signed in', () => expect(attendanceLabel('SIGNED_IN', false)).toEqual({ text: 'At the centre', tone: 'success' }));
  it('signed out', () => expect(attendanceLabel('SIGNED_OUT', false)).toEqual({ text: 'Collected for the day', tone: 'neutral' }));
  it('no events today', () => expect(attendanceLabel('NO_EVENTS_TODAY', false)).toEqual({ text: 'Not arrived yet', tone: 'neutral' }));
  it.each(['SIGNED_IN', 'SIGNED_OUT', 'NO_EVENTS_TODAY'] as const)('previous day not signed out overrides %s', (s) => {
    expect(attendanceLabel(s, true)).toEqual({ text: 'Not signed out yesterday — please check with the centre', tone: 'warning' });
  });
});
