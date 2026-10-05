/**
 * The start of the centre's local calendar day containing `now`, as a UTC
 * instant. "Today" for attendance and care records means the centre's day,
 * not the server's: deployed servers run in UTC, and centres span AEST,
 * ACST and AWST with daylight saving in some states.
 */
export function startOfCentreDay(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const localMidnightAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'));

  // Midnight's UTC offset can differ from now's (DST starts/ends at 2-3am),
  // so take the offset at a first guess of midnight, then correct once.
  let guess = localMidnightAsUtc - offsetMs(timeZone, new Date(localMidnightAsUtc));
  guess = localMidnightAsUtc - offsetMs(timeZone, new Date(guess));
  return new Date(guess);
}

/** UTC offset of `timeZone` at `at`, in milliseconds (positive east of UTC). */
function offsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
