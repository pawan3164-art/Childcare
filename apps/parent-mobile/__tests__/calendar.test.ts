import { dayHeading, eventTimeLabel, groupEventsByDay, groupMenuByDay, isCancelled, mealLabel, type EventItem, type MenuEntry } from '../lib/calendar';

const TZ = 'Australia/Sydney';

function event(over: Partial<EventItem>): EventItem {
  return { id: 'e', title: 'Event', description: null, startsAt: '2026-10-20T00:00:00.000Z', endsAt: null, allDay: false, roomId: null, cancelledAt: null, cancelReason: null, ...over };
}

describe('groupEventsByDay', () => {
  it('groups by the centre-local date, in date order', () => {
    // 2026-10-19T14:00Z is 01:00 on the 20th in Sydney (UTC+11); 2026-10-20T10:00Z is 21:00 on the 20th.
    const a = event({ id: 'a', startsAt: '2026-10-20T10:00:00.000Z' });
    const b = event({ id: 'b', startsAt: '2026-10-19T14:00:00.000Z' });
    const c = event({ id: 'c', startsAt: '2026-10-22T00:00:00.000Z' });
    const groups = groupEventsByDay([c, a, b], TZ);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-20', '2026-10-22']);
    expect(groups[0].events.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('returns nothing for no events', () => {
    expect(groupEventsByDay([], TZ)).toEqual([]);
  });
});

describe('eventTimeLabel', () => {
  it('says All day for all-day events', () => {
    expect(eventTimeLabel(event({ allDay: true }), TZ)).toBe('All day');
  });

  it('shows a start time, and a range when there is an end', () => {
    expect(eventTimeLabel(event({ startsAt: '2026-10-19T22:00:00.000Z' }), TZ)).toBe('9:00 am');
    expect(eventTimeLabel(event({ startsAt: '2026-10-19T22:00:00.000Z', endsAt: '2026-10-20T01:30:00.000Z' }), TZ)).toBe('9:00 am – 12:30 pm');
  });
});

describe('isCancelled', () => {
  it('is true only when cancelledAt is set', () => {
    expect(isCancelled(event({}))).toBe(false);
    expect(isCancelled(event({ cancelledAt: '2026-10-01T00:00:00.000Z' }))).toBe(true);
  });
});

describe('dayHeading', () => {
  it('names the weekday, day and month', () => {
    expect(dayHeading('2026-10-20')).toBe('Tuesday 20 October');
  });
});

describe('menus', () => {
  const item = (date: string, meal: MenuEntry['meal'], description = 'Food'): MenuEntry => ({ id: `${date}${meal}`, date, meal, description, allergenNotes: null });

  it('labels meals', () => {
    expect(mealLabel('MORNING_TEA')).toBe('Morning tea');
    expect(mealLabel('LUNCH')).toBe('Lunch');
    expect(mealLabel('AFTERNOON_TEA')).toBe('Afternoon tea');
    expect(mealLabel('LATE_SNACK')).toBe('Late snack');
  });

  it('groups by date and orders meals through the day', () => {
    const groups = groupMenuByDay([item('2026-10-13', 'LUNCH'), item('2026-10-12', 'LATE_SNACK'), item('2026-10-12', 'MORNING_TEA'), item('2026-10-12', 'AFTERNOON_TEA')]);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-12', '2026-10-13']);
    expect(groups[0].items.map((i) => i.meal)).toEqual(['MORNING_TEA', 'AFTERNOON_TEA', 'LATE_SNACK']);
  });
});
