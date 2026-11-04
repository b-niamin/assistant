/**
 * Dashboard tiles (spec 003). An extension contributes tiles as DATA; the shell renders them, so no
 * extension markup or script runs on the home page and every tile looks like part of one system.
 * This file is pure (no DB, no DOM): the contract types and the validator that clamps whatever an
 * extension (or an untrusted onefile app) hands back.
 */
import type { ExtensionContext } from '$lib/sdk';

/** sm = one number; md = numbers + a small chart (the default); lg = two columns wide. */
export type TileSize = 'sm' | 'md' | 'lg';
export type TileTone = 'good' | 'warning' | 'serious' | 'critical';

export interface TileKpi {
  label: string;
  /** null = no reading yet (rendered as a dash, never as 0). */
  value: number | null;
  unit?: string;
  /** How to print value: plain number (default) or a duration in seconds (7h 32m). */
  format?: 'number' | 'duration';
  /** Fraction digits for format "number" (default: 0, or 1 under 10). */
  digits?: number;
  /** Change against a baseline the extension picks, in the same unit; shown with arrow and sign. */
  delta?: number | null;
  /** Which direction of delta is good; decides the delta's colour. Omit for neutral. */
  better?: 'up' | 'down';
  /** Optional status word, always shown as dot + text. */
  status?: { label: string; tone: TileTone };
}

export interface TilePoint {
  /** Axis/tooltip label: a day (2026-11-06), a week (W45), a name. */
  label: string;
  value: number | null;
}

export interface TileSeries {
  /** line: a trend glyph (gaps bridged). bars: discrete buckets (km per week, minutes per day). */
  kind: 'line' | 'bars';
  points: TilePoint[];
  unit?: string;
  /** Categorical hue token name from app.css, e.g. "red" -> var(--hue-red). Default: accent. */
  hue?: Hue;
  /** Short caption under the chart, e.g. "last 8 weeks". */
  caption?: string;
}

export interface TileListItem {
  label: string;
  /** Right-aligned detail: a time, a count. */
  meta?: string;
}

export interface TileData {
  /** Up to two key figures. The first is the big one. */
  kpis?: TileKpi[];
  series?: TileSeries;
  /** Agenda-like content (calendar, to-dos, due cards). */
  list?: TileListItem[];
  /** Nothing to show yet: a short message and the way to fix it. */
  empty?: { message: string; action?: { label: string; href: string } };
  /** Where a click goes; default the extension's page. Shell paths only ("/..."). */
  href?: string;
  /** "as of" note, e.g. "yesterday" when Garmin has not uploaded today yet. */
  note?: string;
}

/** What a native extension exports from web/tiles.server.ts: `export const tiles: ExtTile[] = [...]`. */
export interface ExtTile {
  /** Unique within the extension, [a-z0-9-]. */
  id: string;
  title: string;
  size?: TileSize;
  /** Runs on the server with the extension's own context (DB role ext_<id>, scope, KV). */
  load(ctx: ExtensionContext): Promise<TileData> | TileData;
}

export const HUES = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] as const;
export type Hue = (typeof HUES)[number];

export const LIMITS = { kpis: 2, points: 90, list: 5, text: 60 } as const;
const SIZES: TileSize[] = ['sm', 'md', 'lg'];
const TONES: TileTone[] = ['good', 'warning', 'serious', 'critical'];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Plain text, trimmed to the limit. Control characters go; rendering is text-only anyway. */
export function text(v: unknown, max: number = LIMITS.text): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Only same-origin shell paths: "/x", never "//host", "javascript:", or a full URL. */
export function safeHref(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 200) return undefined;
  return /^\/(?![/\\])[A-Za-z0-9\-._~/?&=%#+]*$/.test(v) ? v : undefined;
}

export const sizeOf = (v: unknown): TileSize => (SIZES.includes(v as TileSize) ? (v as TileSize) : 'md');

function kpi(v: unknown): TileKpi | null {
  if (!isObj(v)) return null;
  const label = text(v.label, 30);
  if (!label) return null;
  const out: TileKpi = { label, value: num(v.value) };
  const unit = text(v.unit, 12);
  if (unit) out.unit = unit;
  if (v.format === 'duration') out.format = 'duration';
  const digits = num(v.digits);
  if (digits !== null) out.digits = Math.max(0, Math.min(2, Math.round(digits)));
  const delta = num(v.delta);
  if (delta !== null) out.delta = delta;
  if (v.better === 'up' || v.better === 'down') out.better = v.better;
  if (isObj(v.status) && TONES.includes(v.status.tone as TileTone)) {
    const sl = text(v.status.label, 20);
    if (sl) out.status = { label: sl, tone: v.status.tone as TileTone };
  }
  return out;
}

function series(v: unknown): TileSeries | undefined {
  if (!isObj(v) || !Array.isArray(v.points)) return undefined;
  const points = v.points
    .slice(-LIMITS.points)
    .filter(isObj)
    .map((p) => ({ label: text(p.label, 20) ?? '', value: num(p.value) }));
  if (!points.some((p) => p.value !== null)) return undefined;
  const out: TileSeries = { kind: v.kind === 'bars' ? 'bars' : 'line', points };
  const unit = text(v.unit, 12);
  if (unit) out.unit = unit;
  if (HUES.includes(v.hue as Hue)) out.hue = v.hue as Hue;
  const caption = text(v.caption, 40);
  if (caption) out.caption = caption;
  return out;
}

/**
 * Validate and clamp tile data from an extension. Never throws: anything unusable is dropped, and a
 * tile with nothing left becomes an empty state.
 */
export function normalizeTile(raw: unknown): TileData {
  if (!isObj(raw)) return { empty: { message: 'Nothing to show yet' } };
  const out: TileData = {};
  if (Array.isArray(raw.kpis)) {
    const kpis = raw.kpis.map(kpi).filter((k): k is TileKpi => k !== null).slice(0, LIMITS.kpis);
    if (kpis.length) out.kpis = kpis;
  }
  const s = series(raw.series);
  if (s) out.series = s;
  if (Array.isArray(raw.list)) {
    const list: TileListItem[] = [];
    for (const i of raw.list.filter(isObj)) {
      const label = text(i.label);
      if (!label) continue;
      const meta = text(i.meta, 20);
      list.push(meta ? { label, meta } : { label });
      if (list.length === LIMITS.list) break;
    }
    out.list = list;
  }
  if (isObj(raw.empty)) {
    const message = text(raw.empty.message, 90) ?? 'Nothing to show yet';
    const empty: NonNullable<TileData['empty']> = { message };
    if (isObj(raw.empty.action)) {
      const label = text(raw.empty.action.label, 30);
      const href = safeHref(raw.empty.action.href);
      if (label && href) empty.action = { label, href };
    }
    out.empty = empty;
  }
  const href = safeHref(raw.href);
  if (href) out.href = href;
  const note = text(raw.note, 40);
  if (note) out.note = note;
  if (!out.kpis && !out.series && !out.list && !out.empty) out.empty = { message: 'Nothing to show yet' };
  return out;
}

/** Big-number formatting shared by the tile renderer and tests. */
export function formatKpi(k: Pick<TileKpi, 'value' | 'format' | 'digits'>): string {
  if (k.value === null) return '–';
  if (k.format === 'duration') {
    const total = Math.round(k.value / 60);
    return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
  }
  const digits = k.digits ?? (Math.abs(k.value) < 10 && !Number.isInteger(k.value) ? 1 : 0);
  return k.value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/,/g, ' ');
}

/** "+3", "−1.2"; tone from `better`. null when there is no delta. */
export function formatDelta(k: TileKpi): { text: string; tone: 'good' | 'bad' | 'flat'; arrow: '↑' | '↓' | '→' } | null {
  if (k.delta === undefined || k.delta === null) return null;
  const d = k.delta;
  const digits = k.format === 'duration' ? 0 : (k.digits ?? (Math.abs(d) < 10 && !Number.isInteger(d) ? 1 : 0));
  const shown = k.format === 'duration' ? Math.round(d / 60) : Number(d.toFixed(digits));
  if (shown === 0) return { text: '±0', tone: 'flat', arrow: '→' };
  const mag = Math.abs(shown).toFixed(k.format === 'duration' ? 0 : digits) + (k.format === 'duration' ? ' min' : '');
  const up = shown > 0;
  const tone = !k.better ? 'flat' : up === (k.better === 'up') ? 'good' : 'bad';
  return { text: `${up ? '+' : '−'}${mag}`, tone, arrow: up ? '↑' : '↓' };
}
