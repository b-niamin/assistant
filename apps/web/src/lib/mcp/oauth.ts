/**
 * OAuth 2.1 for the Claude connector (spec 005), the pure parts: PKCE, redirect URI rules, the public
 * base URL and the discovery documents. Unit-tested; the database side is oauth.server.ts.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** What a connection may do: read (overviews, read-only tools) and, when the owner allows it, write. */
export const READ = 'mcp:read';
export const WRITE = 'mcp:write';
export const SCOPES = [READ, WRITE];
/** The scope clients asked for before read/write existed; still accepted as a request. */
const LEGACY_SCOPE = 'mcp';
export const CODE_TTL_S = 5 * 60;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 90 * 24 * 3600;
/** A pending connection waits this long for the owner in System settings. */
export const REQUEST_TTL_S = 10 * 60;

/** A requested scope string is fine when every part is one we know (the owner picks the real one). */
export const knownScope = (scope: string | null): boolean =>
  !scope || scope.split(' ').every((s) => s === '' || s === LEGACY_SCOPE || SCOPES.includes(s));

/** The scope a grant gets from the owner's choice: read only, or read and write. */
export const scopeFor = (write: boolean): string => (write ? `${READ} ${WRITE}` : READ);
export const canWrite = (scope: string): boolean => scope.split(' ').includes(WRITE);

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
 * Hosts a code may go back to over https: Claude's own callbacks. Anything else would let whoever
 * registers a client collect a code the owner approved for "Claude". More hosts (another MCP client):
 * MCP_REDIRECT_HOSTS in .env, comma-separated.
 */
export const REDIRECT_HOSTS = ['claude.ai', 'claude.com'];

export function redirectHosts(extra = ''): string[] {
  return [...REDIRECT_HOSTS, ...extra.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)];
}

/**
 * Where a client may send the code back: https on an allowed host (claude.ai's callback), or http on the
 * loopback (Claude Code, MCP inspectors on this computer). No fragments, no credentials in the URL.
 */
export function validRedirectUri(uri: unknown, hosts: string[] = REDIRECT_HOSTS): uri is string {
  if (typeof uri !== 'string' || uri.length > 500) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return hosts.includes(u.hostname.toLowerCase());
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

/** RFC 9728: what /mcp (or a profile's address /mcp/x/<id>) is and who issues its tokens. */
export const resourceMetadata = (base: string, path = '/mcp') => ({
  resource: `${base}${path}`,
  authorization_servers: [base],
  scopes_supported: SCOPES,
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
  scopes_supported: SCOPES
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
/** A short code shown on the public page and in System settings, to tell requests apart: ABCD-EFGH. */
export function userCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const b = randomBytes(8);
  const s = Array.from(b, (x) => abc[x % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** The MCP address a client names in `resource` (RFC 8707): its endpoint id, or null for /mcp or none. */
export function endpointOfResource(resource: string | null): string | null {
  if (!resource) return null;
  try {
    return /^\/mcp\/x\/(e[a-z0-9]{20})\/?$/.exec(new URL(resource).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);
