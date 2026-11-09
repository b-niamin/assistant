/** Server-side helpers for the terminal and browser sidecars (spec 004). */
import * as env from '$app/env/private';
import { mintTicket } from './sidecar-ticket.js';

export type Sidecar = 'terminal' | 'browser';
export const SIDECARS: Sidecar[] = ['terminal', 'browser'];

export const ticketFor = (aud: Sidecar, sid: string): string =>
  mintTicket(env.SIDECAR_TICKET_SECRET ?? '', aud, sid);

export const sidecarsConfigured = (): boolean => (env.SIDECAR_TICKET_SECRET ?? '').length >= 32;

/** Remote Control of an agent in the `claude` container (docker/claude/entrypoint.sh). */
export type RemoteState = 'starting' | 'running' | 'restarting' | 'signed-out' | 'off';
const REMOTE_STATES: RemoteState[] = ['starting', 'running', 'restarting', 'signed-out', 'off'];
const remoteOf = (v: unknown): RemoteState => (REMOTE_STATES.includes(v as RemoteState) ? (v as RemoteState) : 'off');

export interface LoginStatus {
  reachable: boolean;
  claude: boolean;
  codex: boolean;
  gh: boolean;
  remote: { claude: RemoteState; codex: RemoteState };
  /** Started from the app, in a detached tmux session of the terminal container. */
  background: { claude: boolean; codex: boolean };
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
    };
    return {
      reachable: true,
      claude: body.claude === true,
      codex: body.codex === true,
      gh: body.gh === true,
      remote: { claude: remoteOf(body.remote?.claude), codex: remoteOf(body.remote?.codex) },
      background: { claude: body.background?.claude === true, codex: body.background?.codex === true }
    };
  } catch {
    return { reachable: false, claude: false, codex: false, gh: false, remote: { claude: 'off', codex: 'off' }, background: { claude: false, codex: false } };
  }
}

/** Start an agent's Remote Control in the background of the terminal container (needs a ticket). */
export async function startBackgroundRemote(agent: 'claude' | 'codex', sid: string): Promise<boolean> {
  const addr = env.TERMINAL_ADDR ?? 'terminal:7681';
  const query = new URLSearchParams({ agent, ticket: ticketFor('terminal', sid) });
  try {
    const res = await fetch(`http://${addr}/remote?${query}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
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
