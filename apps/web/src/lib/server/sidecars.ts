/** Server-side helpers for the terminal and browser sidecars (spec 004). */
import * as env from '$app/env/private';
import { mintTicket } from './sidecar-ticket.js';

export type Sidecar = 'terminal' | 'browser';
export const SIDECARS: Sidecar[] = ['terminal', 'browser'];

export const ticketFor = (aud: Sidecar, sid: string): string =>
  mintTicket(env.SIDECAR_TICKET_SECRET ?? '', aud, sid);

export const sidecarsConfigured = (): boolean => (env.SIDECAR_TICKET_SECRET ?? '').length >= 32;

export interface LoginStatus {
  reachable: boolean;
  claude: boolean;
  codex: boolean;
  gh: boolean;
}

/** Which CLIs are logged in, as booleans only (the terminal never returns file contents). */
export async function terminalStatus(): Promise<LoginStatus> {
  const addr = env.TERMINAL_ADDR ?? 'terminal:7681';
  try {
    const res = await fetch(`http://${addr}/status`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { claude?: unknown; codex?: unknown; gh?: unknown };
    return { reachable: true, claude: body.claude === true, codex: body.codex === true, gh: body.gh === true };
  } catch {
    return { reachable: false, claude: false, codex: false, gh: false };
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
