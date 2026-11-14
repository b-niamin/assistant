/**
 * Calendar days in the owner's time zone. `new Date().toISOString().slice(0, 10)` is the UTC day: in
 * Poland it says yesterday between midnight and 1-2 a.m. Extensions get these through $shell.
 */

/** YYYY-MM-DD of `at` in `timeZone` (default: the server's TZ, i.e. APP_TIMEZONE, or the browser's). */
export function dayIn(at: Date = new Date(), timeZone?: string): string {
  // sv-SE formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Today, YYYY-MM-DD, in `timeZone`. */
export const todayIn = (timeZone?: string): string => dayIn(new Date(), timeZone);

/** Minutes `timeZone` is ahead of UTC at `at` (Europe/Warsaw in November: 60). */
export function offsetIn(at: Date, timeZone?: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant of a wall-clock time on a day in `timeZone`: instantIn('2026-11-14', '18:30') in Warsaw is
 * 17:30Z. A time skipped by a DST change moves forward an hour, a repeated one takes the first.
 */
export function instantIn(day: string, time = '00:00', timeZone?: string): Date {
  const [h, m, s] = time.split(':').map(Number);
  const naive = Date.parse(`${day}T00:00:00Z`) + ((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000;
  const first = naive - offsetIn(new Date(naive), timeZone) * 60_000;
  return new Date(naive - offsetIn(new Date(first), timeZone) * 60_000);
}
