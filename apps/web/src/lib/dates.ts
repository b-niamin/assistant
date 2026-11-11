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
