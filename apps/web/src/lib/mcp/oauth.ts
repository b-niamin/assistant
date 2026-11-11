/**
 * OAuth 2.1 for the Claude connector (spec 005), the pure parts: PKCE, redirect URI rules, the public
 * base URL and the discovery documents. Unit-tested; the database side is oauth.server.ts.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SCOPE = 'mcp';
export const CODE_TTL_S = 5 * 60;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 90 * 24 * 3600;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('base64url');
export const randomToken = (prefix: string, bytes = 32): string => `${prefix}_${randomBytes(bytes).toString('base64url')}`;

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. Plain is not accepted. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !challenge) return false;
  const a = Buffer.from(sha256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Where a client may send the code back: https anywhere (claude.ai's callback), or http on the loopback
 * (Claude Code, MCP inspectors on this computer). No fragments, no credentials in the URL.
 */
export function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 500) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/**
 * The origin a client reached us at: the Funnel address (https://<machine>.<tailnet>.ts.net:8443) or the
 * app's own. Tailscale keeps the client's Host; only the public origin's host name is believed, so a
 * forged Host cannot make the discovery documents point elsewhere.
 */
export function publicBase(host: string | null, origin: string): string {
  let pub: URL;
  try {
    pub = new URL(origin);
  } catch {
    return origin.replace(/\/$/, '');
  }
  const h = (host ?? '').toLowerCase();
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(h);
  if (!m || m[1] !== pub.hostname) return pub.origin;
  return m[2] && m[2] !== '443' ? `https://${m[1]}:${m[2]}` : `https://${m[1]}`;
}

/** RFC 9728: what /mcp is and who issues its tokens. */
export const resourceMetadata = (base: string) => ({
  resource: `${base}/mcp`,
  authorization_servers: [base],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'Beni Assistant'
});

/** RFC 8414: the endpoints, all under /mcp/oauth so one public listener serves them. */
export const authServerMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/mcp/oauth/authorize`,
  token_endpoint: `${base}/mcp/oauth/token`,
  registration_endpoint: `${base}/mcp/oauth/register`,
  revocation_endpoint: `${base}/mcp/oauth/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  scopes_supported: [SCOPE]
});

/** `Authorization: Basic base64(id:secret)` -> [id, secret]. */
export function basicAuth(header: string | null): [string, string] | null {
  if (!header?.startsWith('Basic ')) return null;
  const raw = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = raw.indexOf(':');
  if (i < 1) return null;
  return [decodeURIComponent(raw.slice(0, i)), decodeURIComponent(raw.slice(i + 1))];
}

/** The redirect back to the client: code (or error) and state on its URI, which may carry a query. */
export function redirectWith(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);
