import type { AttendanceStatus, ChildListItem } from './types';

export function pickSelectedChild(children: ChildListItem[], preferredId: string | null): ChildListItem | null {
  return children.find((c) => c.id === preferredId) ?? children[0] ?? null;
}

export function attendanceLabel(
  status: AttendanceStatus,
  previousDayNotSignedOut: boolean,
): { text: string; tone: 'success' | 'neutral' | 'warning' } {
  if (previousDayNotSignedOut) {
    return { text: 'Not signed out yesterday — please check with the centre', tone: 'warning' };
  }
  switch (status) {
    case 'SIGNED_IN':
      return { text: 'At the centre', tone: 'success' };
    case 'SIGNED_OUT':
      return { text: 'Collected for the day', tone: 'neutral' };
    default:
      return { text: 'Not arrived yet', tone: 'neutral' };
  }
}
