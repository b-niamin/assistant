/**
 * Data sources (spec 002, "Connected accounts"): an extension that pulls data from outside accounts
 * (Garmin, Strava, ...) describes them as DATA; its panel in System settings renders them, with the
 * sync state, a progress bar while a sync runs and the actions it offers (sync now, fetch older data).
 * This file is pure (no DB, no DOM): the contract types and the validator that clamps what an
 * extension hands back.
 */
import type { ExtensionContext } from '#lib/sdk/index.ts';
import { text } from './tiles';

/** connected; not_connected (never set up); reconnect (the login expired); planned (not supported yet). */
export type SourceState = 'connected' | 'not_connected' | 'reconnect' | 'planned';
export type SyncState = 'idle' | 'queued' | 'running' | 'failed';

export interface SourceSync {
  state: SyncState;
  /** What it is doing now or did last, e.g. "Fetching history: March 2024". */
  label?: string;
  /** 0..1 while running; null or absent = running, size unknown. */
  progress?: number | null;
  /** ISO time the last pass finished. */
  lastAt?: string | null;
  /** ISO time of the next scheduled pass. */
  nextAt?: string | null;
  /** The last pass's error, shown in red. */
  error?: string;
}

export interface SourceAction {
  /** Unique within the source, [a-z0-9-]. */
  id: string;
  label: string;
  /** A date the action asks for (e.g. "fetch data since"), sent as input.date (YYYY-MM-DD). */
  date?: { label: string; default?: string; min?: string; max?: string };
  /** Shown under the button. */
  help?: string;
  /** Greyed out, e.g. while a sync is already running. */
  disabled?: boolean;
}

export interface SourceFact {
  label: string;
  value: string;
}

export interface SourceStatus {
  /** Unique within the extension, [a-z0-9-]. */
  id: string;
  /** "Garmin Connect". */
  name: string;
  state: SourceState;
  /** Which account, or since when: "Connected on 3 Nov 2026". */
  account?: string;
  /** How to connect or reconnect, when that is not done in this panel. */
  help?: string;
  /** A command to run in the terminal (System settings -> Terminal) to connect. */
  command?: string;
  sync?: SourceSync;
  /** Up to 6 small numbers: "Activities 412", "Data since 2 Mar 2021". */
  facts?: SourceFact[];
  actions?: SourceAction[];
}

export interface SourceActionInput {
  date?: string;
}

/** What a native extension exports from web/sources.server.ts: `export const sources: ExtSources`. */
export interface ExtSources {
  /** Runs on the server with the extension's own context (DB role ext_<id>, the viewing profile). */
  list(ctx: ExtensionContext): Promise<SourceStatus[]> | SourceStatus[];
  /** Runs one of the actions a source offers; returns a short confirmation for the owner. */
  act?(ctx: ExtensionContext, source: string, action: string, input: SourceActionInput): Promise<string | void> | string | void;
}

/** What the panel gets for one extension. */
export type SourcesResult = { ok: true; sources: SourceStatus[] } | { ok: false; reason: 'hidden' | 'error' | 'timeout' };

export const SOURCE_LIMITS = { sources: 8, facts: 6, actions: 4 } as const;
const STATES: SourceState[] = ['connected', 'not_connected', 'reconnect', 'planned'];
const SYNC_STATES: SyncState[] = ['idle', 'queued', 'running', 'failed'];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const day = (v: unknown): string | undefined => (typeof v === 'string' && DAY.test(v) ? v : undefined);

function sync(v: unknown): SourceSync | undefined {
  if (!isObj(v) || !SYNC_STATES.includes(v.state as SyncState)) return undefined;
  const out: SourceSync = { state: v.state as SyncState };
  const label = text(v.label, 80);
  if (label) out.label = label;
  if (typeof v.progress === 'number' && Number.isFinite(v.progress)) out.progress = Math.max(0, Math.min(1, v.progress));
  else if (v.progress === null) out.progress = null;
  const lastAt = iso(v.lastAt);
  if (lastAt) out.lastAt = lastAt;
  const nextAt = iso(v.nextAt);
  if (nextAt) out.nextAt = nextAt;
  const error = text(v.error, 160);
  if (error) out.error = error;
  return out;
}

function action(v: unknown): SourceAction | null {
  if (!isObj(v) || typeof v.id !== 'string' || !ID.test(v.id)) return null;
  const label = text(v.label, 30);
  if (!label) return null;
  const out: SourceAction = { id: v.id, label };
  if (isObj(v.date)) {
    const dl = text(v.date.label, 30);
    if (dl) out.date = { label: dl, default: day(v.date.default), min: day(v.date.min), max: day(v.date.max) };
  }
  const help = text(v.help, 160);
  if (help) out.help = help;
  if (v.disabled === true) out.disabled = true;
  return out;
}

/** Clamp one extension's answer: unknown fields dropped, text trimmed, lists capped. */
export function normalizeSources(v: unknown): SourceStatus[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: SourceStatus[] = [];
  for (const s of v.slice(0, SOURCE_LIMITS.sources)) {
    if (!isObj(s) || typeof s.id !== 'string' || !ID.test(s.id) || seen.has(s.id)) continue;
    const name = text(s.name, 40);
    if (!name || !STATES.includes(s.state as SourceState)) continue;
    seen.add(s.id);
    const src: SourceStatus = { id: s.id, name, state: s.state as SourceState };
    const account = text(s.account, 80);
    if (account) src.account = account;
    const help = text(s.help, 240);
    if (help) src.help = help;
    const command = text(s.command, 160);
    if (command) src.command = command;
    const sy = sync(s.sync);
    if (sy) src.sync = sy;
    if (Array.isArray(s.facts)) {
      const facts = s.facts
        .filter(isObj)
        .map((f) => ({ label: text(f.label, 30), value: text(f.value, 40) }))
        .filter((f): f is SourceFact => !!f.label && !!f.value)
        .slice(0, SOURCE_LIMITS.facts);
      if (facts.length) src.facts = facts;
    }
    if (Array.isArray(s.actions)) {
      const ids = new Set<string>();
      const actions = s.actions
        .map(action)
        .filter((a): a is SourceAction => !!a && !ids.has(a.id) && !!ids.add(a.id))
        .slice(0, SOURCE_LIMITS.actions);
      if (actions.length) src.actions = actions;
    }
    out.push(src);
  }
  return out;
}

/** Is any source busy? The panel then polls for progress. */
export const busy = (list: SourceStatus[]) => list.some((s) => s.sync?.state === 'running' || s.sync?.state === 'queued');
