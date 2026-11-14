/**
 * The chat with Claude Code (/chat) runs an agent with the terminal's access, so like the terminal it needs
 * the unlocked session (the header's lock). The terminal, once connected, stays up for hours; the chat gets
 * the same: a write made while unlocked grants this session the chat for GRANT_HOURS, until the lock or a
 * restart of the app. In memory only: keyed by the session's hash, never the session id itself.
 */
import { sessionKey } from './session.ts';

export const GRANT_HOURS = 8;
const grants = new Map<string, number>();

export function grantChat(sid: string, now = Date.now()) {
  grants.set(sessionKey(sid), now + GRANT_HOURS * 3600_000);
}

export function hasChatGrant(sid: string | undefined, now = Date.now()): boolean {
  if (!sid) return false;
  const until = grants.get(sessionKey(sid));
  if (until && until > now) return true;
  grants.delete(sessionKey(sid));
  return false;
}

export function dropChatGrant(sid: string | undefined) {
  if (sid) grants.delete(sessionKey(sid));
}
