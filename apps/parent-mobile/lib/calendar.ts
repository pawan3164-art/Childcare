export interface EventItem {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  roomId: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export type Meal = 'MORNING_TEA' | 'LUNCH' | 'AFTERNOON_TEA' | 'LATE_SNACK';

export interface MenuEntry {
  id: string;
  date: string;
  meal: Meal;
  description: string;
  allergenNotes: string | null;
}

const MEAL_ORDER: Meal[] = ['MORNING_TEA', 'LUNCH', 'AFTERNOON_TEA', 'LATE_SNACK'];

export function isCancelled(e: EventItem): boolean {
  return !!e.cancelledAt;
}

function localDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function clock(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .replace(/ /g, ' ')
    .toLowerCase();
}

/** Events grouped under their local date, earliest day first and earliest event first within a day. */
export function groupEventsByDay(events: EventItem[], timeZone?: string): { date: string; events: EventItem[] }[] {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const groups: { date: string; events: EventItem[] }[] = [];
  for (const e of sorted) {
    const date = localDate(e.startsAt, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.events.push(e);
    else groups.push({ date, events: [e] });
  }
  return groups;
}

export function eventTimeLabel(e: EventItem, timeZone?: string): string {
  if (e.allDay) return 'All day';
  const start = clock(e.startsAt, timeZone);
  return e.endsAt ? `${start} – ${clock(e.endsAt, timeZone)}` : start;
}

/** "Tuesday 20 October" for a YYYY-MM-DD date. */
export function dayHeading(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const part = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...opts }).format(d);
  return `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })}`;
}

export function mealLabel(m: Meal): string {
  return { MORNING_TEA: 'Morning tea', LUNCH: 'Lunch', AFTERNOON_TEA: 'Afternoon tea', LATE_SNACK: 'Late snack' }[m];
}

export function groupMenuByDay(items: MenuEntry[]): { date: string; items: MenuEntry[] }[] {
  const dates = [...new Set(items.map((i) => i.date))].sort();
  return dates.map((date) => ({
    date,
    items: items.filter((i) => i.date === date).sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal)),
  }));
}
