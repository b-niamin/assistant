/**
 * The shared calendar, server side: asks every extension the profile can see for its entries in a range
 * (web/calendar.server.ts, `calendar: ExtCalendar`), each with its own context and a time limit, so a
 * slow or broken extension costs only its own entries. Extensions reach it as ctx.calendar.
 */
import { localizeExtension } from '#lib/i18n/index.ts';
import type { ExtensionContext } from '#lib/sdk/index.ts';
import { CALENDAR_LIMITS, normalizeEntry, sortEntries, toRange, type CalendarRange, type ExtCalendar, type SharedEntry } from './calendar';
import { CALENDAR_MODULES } from './generated/calendar.server';
import { extensionsFor } from './registry.server';
import type { ExtensionInfo } from './types';

export const CALENDAR_TIMEOUT_MS = 6000;

/** The owner's zone: the server runs in APP_TIMEZONE (TZ). */
export const ownerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export interface CalendarResult {
  entries: SharedEntry[];
  /** Extensions that put entries on the calendar, with what went wrong for each that failed. */
  sources: { extension: string; name: string; count: number; error?: 'timeout' | 'error' }[];
}

export interface CalendarQuery {
  from: Date | string;
  to: Date | string;
  /** Only these extensions (ids); default every one. */
  only?: string[];
}

type ContextOf = (id: string) => Promise<ExtensionContext>;

async function entriesOf(ext: ExtensionInfo, contextOf: ContextOf, range: CalendarRange, ms: number) {
  const source = { extension: ext.id, name: ext.name };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), ms)));
  const work = (async () => {
    const mod = (await CALENDAR_MODULES[ext.id]?.()) as { calendar?: ExtCalendar } | undefined;
    if (!mod?.calendar || typeof mod.calendar.entries !== 'function') return [];
    const raw = await mod.calendar.entries(await contextOf(ext.id), range);
    const out: SharedEntry[] = [];
    const seen = new Set<string>();
    for (const r of Array.isArray(raw) ? raw : []) {
      const e = normalizeEntry(r, range, source);
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
      if (out.length === CALENDAR_LIMITS.perExtension) break;
    }
    return out;
  })();
  try {
    const r = await Promise.race([work, timeout]);
    if (r === 'timeout') {
      console.error(`calendar: ${ext.id} took longer than ${ms} ms`);
      return { source, entries: [], error: 'timeout' as const };
    }
    return { source, entries: r };
  } catch (e) {
    console.error(`calendar: ${ext.id} failed:`, e instanceof Error ? e.message : e);
    return { source, entries: [], error: 'error' as const };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Entries of every extension the profile sees, in [from, to), sorted. `contextOf` builds an extension's
 * context for the same viewer (runtime.server.ts passes contextFor, whose ctx.calendar inside a
 * contributor answers nothing, so no extension can loop through the calendar).
 */
export async function calendarFor(
  profileId: string,
  lang: string,
  q: CalendarQuery,
  contextOf: ContextOf,
  ms = CALENDAR_TIMEOUT_MS
): Promise<CalendarResult> {
  const range = toRange(q.from, q.to, ownerTimeZone());
  const exts = (await extensionsFor(profileId))
    .filter((e) => CALENDAR_MODULES[e.id] && (!q.only || q.only.includes(e.id)))
    .map((e) => localizeExtension(e, lang));
  const results = await Promise.all(exts.map((e) => entriesOf(e, contextOf, range, ms)));
  return {
    entries: sortEntries(results.flatMap((r) => r.entries), range.timeZone),
    sources: results.map((r) => ({ ...r.source, count: r.entries.length, ...(r.error ? { error: r.error } : {}) }))
  };
}
