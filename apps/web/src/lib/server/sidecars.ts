/** Server-side helpers for the terminal and browser sidecars (spec 004). */
import * as env from '$app/env/private';
import { mintTicket } from './sidecar-ticket.js';

export type Sidecar = 'terminal' | 'browser';
export const SIDECARS: Sidecar[] = ['terminal', 'browser'];

export const ticketFor = (aud: Sidecar, sid: string): string =>
  mintTicket(env.SIDECAR_TICKET_SECRET ?? '', aud, sid);

export const sidecarsConfigured = (): boolean => (env.SIDECAR_TICKET_SECRET ?? '').length >= 32;

/** Remote Control of an agent in the `llm` container (docker/llm/entrypoint.sh). */
export type RemoteState = 'starting' | 'running' | 'restarting' | 'signed-out' | 'off';
const REMOTE_STATES: RemoteState[] = ['starting', 'running', 'restarting', 'signed-out', 'off'];
const remoteOf = (v: unknown): RemoteState => (REMOTE_STATES.includes(v as RemoteState) ? (v as RemoteState) : 'off');

const reasonOf = (v: unknown): string => (v === 'mfa' || v === 'signed-out' ? v : '');

export interface LoginStatus {
  reachable: boolean;
  claude: boolean;
  codex: boolean;
  gh: boolean;
  remote: { claude: RemoteState; codex: RemoteState };
  /** Started from the app, in a detached tmux session of the terminal container. */
  background: { claude: boolean; codex: boolean };
  /** Why one keeps failing, from the end of its log: 'mfa' (the ChatGPT account needs MFA), 'signed-out', or ''. */
  reasons: { claude: string; codex: string };
  /** The terminal container still runs code from before Remote Control states (an update is building). */
  outdated: boolean;
}

/** Which CLIs are logged in and which Remote Control sessions run: booleans and states only. */
export async function terminalStatus(): Promise<LoginStatus> {
  const addr = env.TERMINAL_ADDR ?? 'terminal:7681';
  try {
    const res = await fetch(`http://${addr}/status`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as {
      claude?: unknown;
      codex?: unknown;
      gh?: unknown;
      remote?: { claude?: unknown; codex?: unknown };
      background?: { claude?: unknown; codex?: unknown };
      reasons?: { claude?: unknown; codex?: unknown };
    };
    return {
      reachable: true,
      claude: body.claude === true,
      codex: body.codex === true,
      gh: body.gh === true,
      remote: { claude: remoteOf(body.remote?.claude), codex: remoteOf(body.remote?.codex) },
      background: { claude: body.background?.claude === true, codex: body.background?.codex === true },
      reasons: { claude: reasonOf(body.reasons?.claude), codex: reasonOf(body.reasons?.codex) },
      outdated: body.remote === undefined || body.background === undefined
    };
  } catch {
    return { reachable: false, claude: false, codex: false, gh: false, remote: { claude: 'off', codex: 'off' }, background: { claude: false, codex: false }, reasons: { claude: '', codex: '' }, outdated: false };
  }
}

/** Start an agent's Remote Control in the background of the terminal container (needs a ticket): its HTTP status, 0 if unreachable. */
export async function startBackgroundRemote(agent: 'claude' | 'codex', sid: string): Promise<number> {
  const addr = env.TERMINAL_ADDR ?? 'terminal:7681';
  const query = new URLSearchParams({ agent, ticket: ticketFor('terminal', sid) });
  try {
    const res = await fetch(`http://${addr}/remote?${query}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    return res.status;
  } catch {
    return 0;
  }
}

/** A short-lived code to pair a device with the Codex daemon in the llm container (needs a ticket). */
export async function codexPairingCode(sid: string): Promise<{ ok: boolean; text: string } | null> {
  const addr = env.TERMINAL_ADDR ?? 'terminal:7681';
  const query = new URLSearchParams({ ticket: ticketFor('terminal', sid) });
  try {
    const res = await fetch(`http://${addr}/remote/pair?${query}`, { method: 'POST', signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: unknown; text?: unknown };
    return { ok: body.ok === true, text: typeof body.text === 'string' ? body.text.slice(0, 2000) : '' };
  } catch {
    return null;
  }
}

/** The browser container's own health: is its noVNC endpoint up? */
export async function browserReachable(): Promise<boolean> {
  const addr = env.BROWSER_VNC_ADDR ?? 'browser:6080';
  try {
    await fetch(`http://${addr}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
