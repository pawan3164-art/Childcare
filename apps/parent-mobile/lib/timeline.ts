import { describeCareRecord } from './care-labels';
import type { TimelineEntry } from './types';

export interface TimelineLine {
  /** An Ionicons glyph name. */
  icon: string;
  title: string;
  detail: string | null;
  photoCount: number;
}

export function describeTimelineEntry(entry: TimelineEntry): TimelineLine {
  switch (entry.kind) {
    case 'ATTENDANCE':
      return entry.eventType === 'SIGN_IN'
        ? { icon: 'log-in-outline', title: 'Signed in', detail: null, photoCount: 0 }
        : { icon: 'log-out-outline', title: 'Signed out', detail: null, photoCount: 0 };
    case 'CARE_RECORD':
      return { icon: 'document-text-outline', title: describeCareRecord(entry.type, entry.details), detail: entry.note ?? null, photoCount: 0 };
    case 'PHOTO_POST':
      return {
        icon: 'camera-outline',
        title: entry.media.length === 1 ? 'Photo shared' : 'Photos shared',
        detail: entry.caption ?? null,
        photoCount: entry.media.length,
      };
  }
}

/** Move a YYYY-MM-DD date by whole days (noon UTC avoids any DST edge). */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === shiftDay(today, -1)) return 'Yesterday';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
