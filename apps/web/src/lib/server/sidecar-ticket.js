/**
 * Short-lived, single-use tickets that let a browser open a sidecar WebSocket (terminal, browser).
 * Minted by the web app for an elevated session; verified by the web proxy AND by the sidecar.
 * KEEP IN SYNC with services/terminal/ticket.mjs (same format, same secret).
 *
 * token = base64url(JSON {aud, sid, exp, n}) + "." + base64url(HMAC-SHA256(secret, payload))
 *   aud  which sidecar ("terminal" | "browser")
 *   sid  sha256 of the session id, so a leaked ticket is useless without that session's cookie
 *   exp  expiry, ms since epoch (60 s after minting)
 *   n    random nonce; each one is accepted once
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TICKET_TTL_MS = 60_000;

/** @param {string} sid */
export const sidHash = (sid) => createHash('sha256').update(String(sid)).digest('hex').slice(0, 32);

/** @param {string} secret @param {string} payload */
const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * @param {string} secret
 * @param {string} aud
 * @param {string} sid
 * @returns {string}
 */
export function mintTicket(secret, aud, sid, now = Date.now()) {
  if (!secret || secret.length < 32) throw new Error('ticket secret missing or shorter than 32 chars');
  const payload = Buffer.from(
    JSON.stringify({ aud, sid: sidHash(sid), exp: now + TICKET_TTL_MS, n: randomBytes(16).toString('base64url') })
  ).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** A verifier remembers used nonces until they expire. */
/** @param {string} secret */
export function createVerifier(secret) {
  /** @type {Map<string, number>} */
  const used = new Map();
  /**
   * @param {string | null | undefined} token
   * @param {string} aud
   * @param {string} [sid] when given, the ticket must have been minted for this session
   * @returns {{aud: string, sid: string, exp: number, n: string} | null}
   */
  return function verify(token, aud, sid, now = Date.now()) {
    if (!secret || secret.length < 32 || typeof token !== 'string') return null;
    for (const [n, exp] of used) if (exp < now) used.delete(n);
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const want = Buffer.from(sign(secret, payload));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    let t;
    try {
      t = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (t.aud !== aud || typeof t.exp !== 'number' || t.exp < now || typeof t.n !== 'string') return null;
    if (sid !== undefined && t.sid !== sidHash(sid)) return null;
    if (used.has(t.n)) return null;
    used.set(t.n, t.exp);
    return t;
  };
}
