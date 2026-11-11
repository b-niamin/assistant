/**
 * The host's updater (scripts/update.sh, spec 006). It writes /logs/updater-status.json in the shared
 * `logs` volume, and a timestamp to /logs/updater-heartbeat on every run and every 15 s while an update
 * runs; this reads them, and writes the app's requests to /updater/control (UPDATER_CONTROL_FILE), a
 * volume only this container mounts.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface UpdaterStatus {
  status: 'ok' | 'failed' | 'blocked' | 'updating' | 'available';
  message: string;
  actions: string;
  sha: string;
  deployedSha: string;
  deployedAt: string;
  at: string;
  branch: string;
  /** Last tick (heartbeat), '' when the updater never wrote one (older updaters, or none running). */
  checkedAt: string;
  /** While updating: step n of steps (0 when unknown) and when the deploy started. */
  step: number;
  steps: number;
  startedAt: string;
  /** Which try of this update (2+ = resumed after an interruption). */
  attempt: number;
  /** The app's last request the updater took ('' when none, or an older updater). */
  request: string;
  /** Services that still run the previous version until a confirmed restart ("terminal"), '' when none. */
  pendingRestart: string;
  /** The app's last "Restart now" the updater took. */
  restartRequest: string;
  /** The repo the updater follows (no credentials), '' from older updaters. */
  repo: string;
}

const STATUSES = new Set(['ok', 'failed', 'blocked', 'updating', 'available']);
/** The updater ticks every 5 minutes: no sign of life for this long means its schedule does not run. */
export const STALE_MS = 20 * 60_000;
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000 ? v : 0);

/** Parses the status file; null when it is missing or not what the updater writes. */
export function parseUpdaterStatus(raw: string): UpdaterStatus | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || !STATUSES.has(j.status as string)) return null;
  return {
    status: j.status as UpdaterStatus['status'],
    message: text(j.message),
    actions: text(j.actions),
    sha: text(j.sha, 40),
    deployedSha: text(j.deployedSha, 40),
    deployedAt: text(j.deployedAt, 40),
    at: text(j.at, 40),
    branch: text(j.branch, 100),
    checkedAt: '',
    step: count(j.step),
    steps: count(j.steps),
    startedAt: text(j.startedAt, 40),
    attempt: count(j.attempt),
    request: text(j.request, 64),
    pendingRestart: text(j.pendingRestart, 200),
    restartRequest: text(j.restartRequest, 64),
    repo: text(j.repo, 300)
  };
}

/** The updater's last sign of life (a tick or a status change), in ms; 0 when unknown. */
export function lastSeen(s: UpdaterStatus): number {
  return Math.max(Date.parse(s.checkedAt) || 0, Date.parse(s.at) || 0);
}

/** True when the updater has not shown a sign of life for STALE_MS (a long build counts as alive). */
export const isStale = (s: UpdaterStatus, now = Date.now()): boolean => s.status !== 'updating' && now - lastSeen(s) > STALE_MS;

/** A running update beats every 15 s (a minute without root): this long without one, its process died. */
export const STALLED_MS = 3 * 60_000;
/** A request the updater has not taken this long after the click: its schedule probably does not run. */
export const UNANSWERED_MS = 3 * 60_000;

export type UpdateState = 'stale' | 'interrupted' | 'updating' | 'available' | 'ok' | 'failed' | 'blocked';

/**
 * What the Updates panel and the dock show. `interrupted`: the status still says updating, but no
 * heartbeat came for STALLED_MS (a reboot, or the process was killed): the updater's next run resumes it.
 * `pending`: "Update now" was clicked and the updater has not taken it yet.
 */
export function updateView(
  s: UpdaterStatus,
  c: UpdaterControl,
  now = Date.now()
): { state: UpdateState; pending: boolean; unanswered: boolean; restartPending: boolean } {
  let state: UpdateState = s.status;
  if (s.status === 'updating') {
    if (now - lastSeen(s) > STALLED_MS) state = 'interrupted';
  } else if (isStale(s, now)) state = 'stale';
  // The updater echoes the request it took; older ones did not, so compare times for them.
  const pending = !!c.request && c.request !== s.request && (!!s.request || Date.parse(c.request) > Date.parse(s.at));
  const restartPending = !!c.restart && c.restart !== s.restartRequest;
  const unanswered = (pending && now - Date.parse(c.request) > UNANSWERED_MS) || (restartPending && now - Date.parse(c.restart ?? '') > UNANSWERED_MS);
  return { state, pending, unanswered, restartPending };
}

export async function updaterStatus(file = process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json'): Promise<UpdaterStatus | null> {
  try {
    const s = parseUpdaterStatus(await readFile(file, 'utf8'));
    if (s) s.checkedAt = (await readFile(path.join(path.dirname(file), 'updater-heartbeat'), 'utf8').catch(() => '')).trim().slice(0, 40);
    return s;
  } catch {
    return null;
  }
}

/**
 * The app's side of updating (spec 006): `mode=auto|manual` and, after "Update now", `request=<id>`, in
 * /logs/updater-control. The host's updater reads it on its next tick; it never runs anything from it.
 */
export interface UpdaterControl {
  mode: 'auto' | 'manual';
  /** When "Update now" was last clicked (ISO), '' if never. */
  request: string;
  /** When "Cancel" was last clicked during an update (ISO), '' if never. */
  cancel?: string;
  /** Restarts of the terminal (they end the sessions in it): asked for first (default) or automatic. */
  restarts?: 'ask' | 'auto';
  /** When "Restart now" was last clicked (ISO), '' if never. */
  restart?: string;
  /** The Claude connector (spec 005): the updater turns Tailscale Funnel on or off for the public MCP listener. */
  funnel?: 'on' | 'off';
}

// Older stacks (and tests) keep it next to the status file, in the shared `logs` volume.
const legacyControlFile = (statusFile: string) => path.join(path.dirname(statusFile), 'updater-control');
const controlFile = (statusFile: string) => process.env.UPDATER_CONTROL_FILE || legacyControlFile(statusFile);
const STATUS_FILE = () => process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json';

export function parseControl(raw: string): UpdaterControl {
  const get = (k: string) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const id = (v: string) => (/^[A-Za-z0-9:._-]{1,64}$/.test(v) ? v : '');
  return {
    mode: get('mode') === 'manual' ? 'manual' : 'auto',
    request: id(get('request')),
    cancel: id(get('cancel')),
    restarts: get('restarts') === 'auto' ? 'auto' : 'ask',
    restart: id(get('restart')),
    funnel: get('funnel') === 'on' ? 'on' : 'off'
  };
}

export async function updaterControl(file = STATUS_FILE()): Promise<UpdaterControl> {
  // Until the app first writes the new file, the choices made before (mode, Funnel) are in the old one.
  const raw = await readFile(controlFile(file), 'utf8').catch(() => null);
  return parseControl(raw ?? (await readFile(legacyControlFile(file), 'utf8').catch(() => '')));
}

export async function setUpdaterControl(c: UpdaterControl, file = STATUS_FILE()): Promise<void> {
  const target = controlFile(file);
  const lines = [
    `mode=${c.mode}`,
    `restarts=${c.restarts ?? 'ask'}`,
    c.request && `request=${c.request}`,
    c.cancel && `cancel=${c.cancel}`,
    c.restart && `restart=${c.restart}`,
    `funnel=${c.funnel === 'on' ? 'on' : 'off'}`
  ].filter(Boolean);
  await writeFile(`${target}.tmp`, `${lines.join('\n')}\n`, { mode: 0o644 });
  await rename(`${target}.tmp`, target);
}

/** The last lines of the running (or last) deploy's build output, /logs/updater-build.log. */
export async function buildTail(lines = 12, file = STATUS_FILE()): Promise<string[]> {
  const raw = await readFile(path.join(path.dirname(file), 'updater-build.log'), 'utf8').catch(() => '');
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n|\r/).map((l) => l.trimEnd()).filter(Boolean).slice(-lines);
}

/** owner/name of a github.com repo URL (https, ssh or scp-like), null for anything else. */
export function githubRepo(url: string): string | null {
  const m = url.trim().match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

/** The commit of refs/heads/<branch> in git's ref advertisement (info/refs?service=git-upload-pack). */
export function refFromAdvertisement(body: string, branch: string): string | null {
  const re = new RegExp(`([0-9a-f]{40}) refs/heads/${branch.replace(/[^A-Za-z0-9_./-]/g, '')}(?:\\0|\\n|$)`);
  const m = body.split(/\n/).map((l) => l.replace(/^[0-9a-f]{4}/, '')).join('\n').match(re);
  return m ? m[1] : null;
}

const latestCache = new Map<string, { at: number; sha: string | null }>();
/**
 * main's commit on GitHub right now, asked when System settings opens (cached 30 s), so the panel tells a
 * newer commit at once instead of after the updater's next check. Public github.com repos only; null when
 * GitHub does not answer (the updater's own status is shown then).
 */
export async function latestOnGithub(repoUrl: string, branch: string): Promise<string | null> {
  const repo = githubRepo(repoUrl);
  if (!repo || !branch) return null;
  const key = `${repo}#${branch}`;
  const hit = latestCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.sha;
  let sha: string | null = null;
  try {
    const res = await fetch(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
      headers: { 'user-agent': 'git/2.45 beni-assistant' },
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) sha = refFromAdvertisement(await res.text(), branch);
  } catch {
    sha = null;
  }
  latestCache.set(key, { at: Date.now(), sha });
  return sha;
}

/**
 * The Claude connector's state as the host's updater last applied it (/logs/funnel-status.json, spec 005):
 * `on` with the public URL, `off`, `error` (with a message, e.g. Funnel not allowed for this machine yet)
 * or `unavailable` (no Tailscale on the host). null: no updater, or one from before the connector.
 */
export interface FunnelStatus {
  want: 'on' | 'off';
  state: 'on' | 'off' | 'error' | 'unavailable';
  port: string;
  url: string;
  message: string;
  at: string;
}

export function parseFunnelStatus(raw: string): FunnelStatus | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const states = ['on', 'off', 'error', 'unavailable'];
  if (!j || typeof j !== 'object' || !states.includes(j.state as string)) return null;
  const url = text(j.url, 300);
  return {
    want: j.want === 'on' ? 'on' : 'off',
    state: j.state as FunnelStatus['state'],
    port: /^\d{1,5}$/.test(String(j.port ?? '')) ? String(j.port) : '',
    url: /^https:\/\/[a-z0-9.-]+(:\d+)?\/mcp$/i.test(url) ? url : '',
    message: text(j.message, 400),
    at: text(j.at, 40)
  };
}

export async function funnelStatus(file = STATUS_FILE()): Promise<FunnelStatus | null> {
  return parseFunnelStatus(await readFile(path.join(path.dirname(file), 'funnel-status.json'), 'utf8').catch(() => ''));
}
