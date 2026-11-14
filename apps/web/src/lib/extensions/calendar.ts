/**
 * The shared calendar (spec 002, "Calendar entries"). Any extension may put entries on it: a native or
 * onefile extension ships web/calendar.server.ts exporting `calendar: ExtCalendar`, and the shell asks
 * each one for the entries in a range (a workout, a Garmin activity, an event of a subscribed calendar).
 * Nobody copies anything: every entry stays in the extension that owns it and is read live.
 * This file is pure (no DB): the contract types and the validator that clamps what an extension returns.
 */
import type { ExtensionContext } from '#lib/sdk/index.ts';
import { dayIn } from '#lib/dates.ts';
import { safeHref, text } from './tiles';

/** What an extension returns. */
export interface CalendarEntry {
  /** Stable and unique within the extension (at most 200 characters), e.g. the workout's id. */
  id: string;
  title: string;
  /** A timed entry: an instant with a zone ("2026-11-14T18:30:00Z", "...+01:00"). All day: "2026-11-14". */
  start: string;
  /** Exclusive end in the same form. Left out: the start (timed) or the next day (all day). */
  end?: string;
  location?: string;
  /** A line or two of detail (sets done, distance, ...). */
  note?: string;
  /** A short label of what it is ("Workout", "Run"), shown next to the title. */
  kind?: string;
  /** Where a click goes: a path inside the extension ("/gym", "/health/activity/123"). */
  href?: string;
}

/** The range asked for: [from, to) as instants, and the owner's time zone that days are counted in. */
export interface CalendarRange {
  from: Date;
  to: Date;
  timeZone: string;
}

/** What an extension exports from web/calendar.server.ts: `export const calendar: ExtCalendar = {...}`. */
export interface ExtCalendar {
  /** Runs with the extension's own context; return what overlaps the range (more is clipped by the shell). */
  entries(ctx: ExtensionContext, range: CalendarRange): CalendarEntry[] | Promise<CalendarEntry[]>;
}

/** An entry as the shell hands it out: checked, with its kind of time and the extension it comes from. */
export interface SharedEntry {
  id: string;
  title: string;
  allDay: boolean;
  /** As in CalendarEntry, end always set (exclusive). */
  start: string;
  end: string;
  location?: string;
  note?: string;
  kind?: string;
  href?: string;
  /** The extension that owns it. */
  source: { extension: string; name: string };
}

export const CALENDAR_LIMITS = { perExtension: 2000, days: 400, title: 200, note: 1000, location: 200, kind: 30 } as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const validDay = (v: string) => DAY_RE.test(v) && dayIn(new Date(`${v}T12:00:00Z`), 'UTC') === v;
/** The day after "2026-11-14". */
export const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Days of the range in the zone: the first day and the last one touched (inclusive). */
export function rangeDays(range: CalendarRange): { first: string; last: string } {
  return { first: dayIn(range.from, range.timeZone), last: dayIn(new Date(range.to.getTime() - 1), range.timeZone) };
}

/**
 * Check and clamp one entry. Null for anything unusable: no id or title, a start that is neither a day
 * nor an instant with a zone, or one outside the range. Never throws.
 */
export function normalizeEntry(raw: unknown, range: CalendarRange, source: SharedEntry['source']): SharedEntry | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id).slice(0, 200) : '';
  const title = text(raw.title, CALENDAR_LIMITS.title);
  const start = typeof raw.start === 'string' ? raw.start.trim() : '';
  if (!id || !title || !start) return null;
  let entry: SharedEntry;
  if (DAY_RE.test(start)) {
    if (!validDay(start)) return null;
    const end = typeof raw.end === 'string' && validDay(raw.end.trim()) && raw.end.trim() > start ? raw.end.trim() : nextDay(start);
    const { first, last } = rangeDays(range);
    if (start > last || end <= first) return null;
    entry = { id, title, allDay: true, start, end, source };
  } else {
    if (!INSTANT_RE.test(start)) return null;
    const s = Date.parse(start);
    if (!Number.isFinite(s)) return null;
    const endRaw = typeof raw.end === 'string' ? raw.end.trim() : '';
    const e = INSTANT_RE.test(endRaw) && Date.parse(endRaw) >= s ? Date.parse(endRaw) : s;
    const from = range.from.getTime();
    const to = range.to.getTime();
    // A zero-length entry belongs to the range it starts in.
    if (!(s < to && (e > from || (e === s && s >= from)))) return null;
    entry = { id, title, allDay: false, start: new Date(s).toISOString(), end: new Date(e).toISOString(), source };
  }
  const location = text(raw.location, CALENDAR_LIMITS.location);
  if (location) entry.location = location;
  const note = typeof raw.note === 'string' ? raw.note.replace(/\r\n?/g, '\n').trim().slice(0, CALENDAR_LIMITS.note) : '';
  if (note) entry.note = note;
  const kind = text(raw.kind, CALENDAR_LIMITS.kind);
  if (kind) entry.kind = kind;
  const href = safeHref(raw.href);
  if (href && (href === `/${source.extension}` || /^[/?#]/.test(href.slice(source.extension.length + 1))) && href.startsWith(`/${source.extension}`))
    entry.href = href;
  return entry;
}

/** All-day first, then by start, then by title; the same order on every page and in every tool. */
export function sortEntries<T extends Pick<SharedEntry, 'allDay' | 'start' | 'title'>>(list: T[], timeZone: string): T[] {
  const dayOf = (e: T) => (e.allDay ? e.start : dayIn(new Date(e.start), timeZone));
  return [...list].sort(
    (a, b) =>
      dayOf(a).localeCompare(dayOf(b)) ||
      Number(b.allDay) - Number(a.allDay) ||
      (a.allDay ? 0 : Date.parse(a.start) - Date.parse(b.start)) ||
      a.title.localeCompare(b.title)
  );
}

/** Turn what a caller passed ({ from, to } as Dates or ISO strings) into a range; throws on a bad one. */
export function toRange(from: Date | string, to: Date | string, timeZone: string): CalendarRange {
  const f = from instanceof Date ? from : new Date(DAY_RE.test(from) ? `${from}T00:00:00Z` : from);
  const t = to instanceof Date ? to : new Date(DAY_RE.test(to) ? `${to}T00:00:00Z` : to);
  if (!Number.isFinite(f.getTime()) || !Number.isFinite(t.getTime()) || t <= f) throw new Error('calendar: a range needs from < to');
  if (t.getTime() - f.getTime() > CALENDAR_LIMITS.days * 86_400_000) throw new Error(`calendar: at most ${CALENDAR_LIMITS.days} days at once`);
  return { from: f, to: t, timeZone };
}
