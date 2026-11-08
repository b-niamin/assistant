/**
 * The shell SDK: the ONLY shell module an extension imports (as `$shell`, UI as `$shell/ui`).
 * Everything else under src/lib is private to the shell and may change without notice.
 * Contract version: SHELL_API in scripts/extensions-lib.mjs (extensions declare "shell": 1).
 */
import type { RequestEvent, ServerLoadEvent } from '@sveltejs/kit';
import type { TransactionSql } from 'postgres';
import type { ExtensionInfo } from '#lib/extensions/types.ts';

export type { ExtensionInfo };
/** SvelteKit helpers, re-exported so extensions import everything shell-related from one place. */
export { error, fail, json, redirect } from '@sveltejs/kit';

/** A Postgres client inside a transaction running as the extension's own role (ext_<id>). */
export type Sql = TransactionSql;

export interface ExtensionContext {
  extension: ExtensionInfo;
  /** The profile that is looking at the page. */
  profileId: string;
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
export type { ExtTool, ToolSchema } from '#lib/extensions/tools.ts';
export type { ExtTile, TileData, TileKpi, TileListItem, TilePoint, TileSeries, TileSize, TileTone } from '#lib/extensions/tiles.ts';
