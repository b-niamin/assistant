/**
 * The shell SDK: the ONLY shell module an extension imports (as `$shell`, UI as `$shell/ui`).
 * Everything else under src/lib is private to the shell and may change without notice.
 * Contract version: SHELL_API in scripts/extensions-lib.mjs. It only grows: an extension declares the
 * version it needs ("shell": 2 for the charts and helpers below), and runs on that core or a newer one.
 */
import type { RequestEvent, ServerLoadEvent } from '@sveltejs/kit';
import type { TransactionSql } from 'postgres';
import type { ExtensionInfo } from '#lib/extensions/types.ts';
import type { Translate } from '#lib/i18n/translate.ts';
import type { CalendarQuery, CalendarResult } from '#lib/extensions/calendar.server.ts';

export type { ExtensionInfo, Translate };
/** SvelteKit helpers, re-exported so extensions import everything shell-related from one place. */
export { error, fail, json, redirect } from '@sveltejs/kit';
/** Calendar days in the owner's time zone (never toISOString().slice(0, 10), which is UTC's day). */
export { dayIn, todayIn } from '#lib/dates.ts';
/** The instant of a wall-clock time on a day, and a zone's offset, in the owner's zone by default. Since shell 5. */
export { instantIn, offsetIn } from '#lib/dates.ts';
/** Translation without a page (tests, pure helpers' default): English, placeholders filled in. Since shell 2. */
export { EN } from '#lib/i18n/translate.ts';
/** Round axis ticks, in bytes or another unit, and the gap-aware runs of a series. Since shell 2. */
export { byteTicks, niceTicks, runsOf, scaledTicks } from '#lib/charts/ticks.ts';

/** A Postgres client inside a transaction running as the extension's own role (ext_<id>). */
export type Sql = TransactionSql;

export interface ExtensionContext {
  extension: ExtensionInfo;
  /** The profile that is looking at the page. */
  profileId: string;
  /** Language of the page (spec 007): en, pl, ... */
  lang: string;
  /**
   * Translate this extension's texts into the page's language, from its i18n/<lang>.json (then the
   * shell's): t('Last night'), t('{n} km', { n }), t.n(count, '{n} run', '{n} runs'), t.locale for dates.
   * In components use useT() from '$shell/ui' instead.
   */
  t: Translate;
  /**
   * Whose data to read and write: the viewing profile for scope "profile", null for scope "shared".
   * Profile-scoped tables have a profile_id column; filter every query by this.
   */
  dataProfileId: string | null;
  /**
   * Run queries as the extension's DB role: it can only see its own schema and core.profiles, so a
   * bug cannot touch another extension's tables. One transaction per call; queries inside pipeline.
   */
  db<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  /**
   * Secrets the manifest declares ("secrets": ["token"]), set by an admin in System settings ->
   * Extension secrets. Returns null when not set yet; throws for a name the manifest does not declare.
   * Keep values server-side: never put one in page data.
   */
  secrets: {
    get(name: string): Promise<string | null>;
  };
  /**
   * Values of the plain fields of its settings panel (manifest "settings"), set by an admin in
   * System settings -> <extension>. A field never saved gives its default, or null.
   */
  settings: {
    all(): Promise<Record<string, string | number | boolean | null>>;
    get(name: string): Promise<string | number | boolean | null>;
  };
  /**
   * The shared calendar (since shell 5): entries every extension the viewer sees puts on it through its
   * web/calendar.server.ts, in [from, to) (Dates, ISO instants, or YYYY-MM-DD read as UTC midnight;
   * at most 400 days), sorted, each with the extension it comes from. `only` limits it to some extensions.
   * Inside a calendar contributor it answers nothing.
   */
  calendar: {
    entries(q: CalendarQuery): Promise<CalendarResult>;
  };
  /** Small settings and state, scoped like the extension (core.extension_kv). */
  kv: {
    all(): Promise<Record<string, string>>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
}

/** `export const load: ExtLoad = async (event, ctx) => ...` in an extension's +page.server.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExtLoad<T = any> = (event: ServerLoadEvent, ctx: ExtensionContext) => T | Promise<T>;
export type ExtAction = (event: RequestEvent, ctx: ExtensionContext) => unknown;
export type ExtActions = Record<string, ExtAction>;
export type ExtHandler = (event: RequestEvent, ctx: ExtensionContext) => Response | Promise<Response>;

/** Page data type from a load: `let { data }: { data: DataOf<typeof load> } = $props();` */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataOf<L extends (...args: any[]) => any> = Awaited<ReturnType<L>>;


/** Dashboard tiles (spec 003): `export const tiles: ExtTile[]` in web/tiles.server.ts. */
/** Tools for Claude (spec 005): `export const tools: ExtTool[]` in web/tools.server.ts. */
/** Connected accounts in its System settings panel (spec 002): `export const sources: ExtSources` in web/sources.server.ts. */
export type { ExtSources, SourceAction, SourceActionInput, SourceFact, SourceState, SourceStatus, SourceSync, SyncState } from '#lib/extensions/sources.ts';
export type { ExtTool, ToolSchema } from '#lib/extensions/tools.ts';
/** Throw from a tool's run for a call that is wrong (not a failure of the tool). Since shell 2. */
export { ToolError } from '#lib/extensions/args.ts';
/** Entries on the shared calendar (spec 002): `export const calendar: ExtCalendar` in web/calendar.server.ts. Since shell 5. */
export type { CalendarEntry, CalendarRange, ExtCalendar, SharedEntry } from '#lib/extensions/calendar.ts';
export type { CalendarQuery, CalendarResult } from '#lib/extensions/calendar.server.ts';
/** The owner's day of an instant and the order the calendar uses. Since shell 5. */
export { nextDay, sortEntries } from '#lib/extensions/calendar.ts';
export type { ExtTile, TileData, TileKpi, TileListItem, TilePoint, TileSeries, TileSize, TileTone } from '#lib/extensions/tiles.ts';
