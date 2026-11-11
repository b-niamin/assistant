/**
 * OAuth 2.1 for the Claude connector (spec 005), the database side (migrations 010, 011). A client
 * registers itself (POST /mcp/oauth/register); the public authorize page files a request, which the
 * owner approves on the tailnet, in a profile's settings, by picking one of its MCP addresses
 * (endpoints.server.ts). That makes a grant (one connection, which follows its address) and a single-use code; the code becomes an access token (1 hour)
 * and a refresh token (90 days, rotated on every use, never past the grant's end). Only SHA-256 hashes
 * are stored.
 */
import { db } from '#lib/server/db.ts';
import { ACCESS_TTL_S, CODE_TTL_S, randomToken, redirectHosts, REFRESH_TTL_S, REQUEST_TTL_S, scopeFor, sha256, userCode, validRedirectUri } from './oauth';

/** Where codes may go: Claude's callbacks, plus MCP_REDIRECT_HOSTS. */
export const allowedRedirectHosts = (): string[] => redirectHosts(process.env.MCP_REDIRECT_HOSTS ?? '');
const redirectOk = (uri: unknown): uri is string => validRedirectUri(uri, allowedRedirectHosts());

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  confidential: boolean;
}

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/** Anyone on the internet can register: keep the table small. Approval still needs the owner, in the app. */
const MAX_CLIENTS = 200;

export async function registerClient(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectOk))
    throw new OAuthError('invalid_redirect_uri', `redirect_uris: 1-10 https URLs on ${allowedRedirectHosts().join(', ')} (or http on localhost)`);
  const name = String(body.client_name ?? 'MCP client').replace(/[\u0000-\u001f]/g, '').slice(0, 80) || 'MCP client';
  const method = String(body.token_endpoint_auth_method ?? 'none');
  const confidential = method === 'client_secret_post' || method === 'client_secret_basic';
  const [{ n }] = await db()<{ n: number }[]>`SELECT count(*)::int AS n FROM core.oauth_clients`;
  if (n >= MAX_CLIENTS) {
    // Drop registrations that were never approved, oldest first, before refusing.
    await db()`DELETE FROM core.oauth_clients c WHERE c.created_at < now() - interval '1 day'
               AND NOT EXISTS (SELECT 1 FROM core.oauth_grants g WHERE g.client_id = c.id)`;
    const [{ m }] = await db()<{ m: number }[]>`SELECT count(*)::int AS m FROM core.oauth_clients`;
    if (m >= MAX_CLIENTS) throw new OAuthError('temporarily_unavailable', 'too many registered clients', 503);
  }
  const id = randomToken('bcl', 18);
  const secret = confidential ? randomToken('bcs') : null;
  await db()`INSERT INTO core.oauth_clients (id, name, redirect_uris, secret_hash)
             VALUES (${id}, ${name}, ${uris as string[]}, ${secret ? sha256(secret) : null})`;
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: confidential ? method : 'none'
  };
}

export async function getClient(id: string): Promise<OAuthClient | null> {
  if (!id || id.length > 100) return null;
  const [row] = await db()<{ id: string; name: string; redirect_uris: string[]; secret_hash: string | null }[]>`
    SELECT id, name, redirect_uris, secret_hash FROM core.oauth_clients WHERE id = ${id}`;
  return row ? { id: row.id, name: row.name, redirectUris: row.redirect_uris, confidential: !!row.secret_hash } : null;
}

/** A confidential client must send its secret; a public one (PKCE only) none. */
export async function clientAuthenticates(id: string, secret: string | null): Promise<boolean> {
  const [row] = await db()<{ secret_hash: string | null }[]>`SELECT secret_hash FROM core.oauth_clients WHERE id = ${id}`;
  if (!row) return false;
  if (!row.secret_hash) return true;
  return !!secret && sha256(secret) === row.secret_hash;
}

export interface PendingRequest {
  id: string;
  userCode: string;
  client: string;
  returnsTo: string;
  createdAt: string;
  /** The address the client connected to, when it said (RFC 8707 resource). */
  askedEndpoint: string | null;
}

/**
 * The public authorize page files a request and gets its id plus a browser secret (a cookie on the
 * public page), so only the browser that asked can collect the code. Old requests are cleaned up here.
 */
export async function fileRequest(client: OAuthClient, redirectUri: string, state: string, challenge: string, askedEndpoint: string | null): Promise<{ id: string; secret: string }> {
  await db()`DELETE FROM core.oauth_requests WHERE expires_at < now() - interval '1 day'`;
  const [{ n }] = await db()<{ n: number }[]>`SELECT count(*)::int AS n FROM core.oauth_requests WHERE expires_at > now() AND decision IS NULL`;
  if (n >= 20) throw new OAuthError('temporarily_unavailable', 'too many connections waiting for approval', 503);
  const id = randomToken('brq', 12);
  const secret = randomToken('brs');
  await db()`INSERT INTO core.oauth_requests (id, user_code, browser_hash, client_id, redirect_uri, state, code_challenge, asked_endpoint, expires_at)
             VALUES (${id}, ${userCode()}, ${sha256(secret)}, ${client.id}, ${redirectUri}, ${state.slice(0, 500)}, ${challenge}, ${askedEndpoint},
                     now() + make_interval(secs => ${REQUEST_TTL_S}))`;
  return { id, secret };
}

export type RequestState =
  | { state: 'gone' }
  | { state: 'pending'; userCode: string; client: string; returnsTo: string }
  | { state: 'denied'; redirectUri: string; stateParam: string }
  | { state: 'allowed'; redirectUri: string; stateParam: string; code: string };

/**
 * What the public page shows for a request, for the browser holding its secret. Once allowed, the grant
 * and its single-use code are made here, once: the request is then done.
 */
export async function requestState(id: string, secret: string): Promise<RequestState> {
  if (!id || id.length > 100 || !secret) return { state: 'gone' };
  return db().begin(async (sql) => {
    const [r] = await sql<
      { user_code: string; client_id: string; name: string; redirect_uri: string; state: string; code_challenge: string; decision: string | null;
        endpoint_id: string | null; profile_id: string | null; endpoint: string | null; expired: boolean; done: boolean }[]
    >`SELECT r.user_code, r.client_id, c.name, r.redirect_uri, r.state, r.code_challenge, r.decision, r.endpoint_id, e.profile_id, e.name AS endpoint,
             r.expires_at < now() AS expired, r.done_at IS NOT NULL AS done
      FROM core.oauth_requests r JOIN core.oauth_clients c ON c.id = r.client_id
      LEFT JOIN core.mcp_endpoints e ON e.id = r.endpoint_id
      WHERE r.id = ${id} AND r.browser_hash = ${sha256(secret)} FOR UPDATE OF r`;
    if (!r || r.done) return { state: 'gone' };
    if (r.decision === 'deny') {
      await sql`UPDATE core.oauth_requests SET done_at = now() WHERE id = ${id}`;
      return { state: 'denied', redirectUri: r.redirect_uri, stateParam: r.state };
    }
    if (r.decision === 'allow' && r.endpoint_id && r.profile_id) {
      const grant = randomToken('bgr', 12);
      const code = randomToken('bco');
      await sql`INSERT INTO core.oauth_grants (id, client_id, profile_id, endpoint_id) VALUES (${grant}, ${r.client_id}, ${r.profile_id}, ${r.endpoint_id})`;
      await sql`INSERT INTO core.oauth_tokens (hash, kind, grant_id, redirect_uri, code_challenge, expires_at)
                VALUES (${sha256(code)}, 'code', ${grant}, ${r.redirect_uri}, ${r.code_challenge}, now() + make_interval(secs => ${CODE_TTL_S}))`;
      await sql`UPDATE core.oauth_requests SET done_at = now() WHERE id = ${id}`;
      console.log(`[mcp] ${new Date().toISOString()} connection approved for ${r.name} (profile ${r.profile_id}, address ${r.endpoint})`);
      return { state: 'allowed', redirectUri: r.redirect_uri, stateParam: r.state, code };
    }
    if (r.expired) return { state: 'gone' };
    return { state: 'pending', userCode: r.user_code, client: r.name, returnsTo: new URL(r.redirect_uri).host };
  });
}

/** Requests waiting for the owner, for System settings. */
export async function pendingRequests(): Promise<PendingRequest[]> {
  const rows = await db()<{ id: string; user_code: string; name: string; redirect_uri: string; created_at: Date; asked_endpoint: string | null }[]>`
    SELECT r.id, r.user_code, c.name, r.redirect_uri, r.created_at, r.asked_endpoint
    FROM core.oauth_requests r JOIN core.oauth_clients c ON c.id = r.client_id
    WHERE r.decision IS NULL AND r.expires_at > now() ORDER BY r.created_at DESC`;
  return rows.map((r) => ({
    id: r.id,
    userCode: r.user_code,
    client: r.name,
    returnsTo: new URL(r.redirect_uri).host,
    createdAt: r.created_at.toISOString(),
    askedEndpoint: r.asked_endpoint
  }));
}

/** The owner's decision in a profile's settings. The public page picks it up on its next refresh. */
export async function decideRequest(id: string, d: { allow: false } | { allow: true; endpointId: string }): Promise<boolean> {
  const rows = d.allow
    ? await db()`UPDATE core.oauth_requests SET decision = 'allow', endpoint_id = ${d.endpointId}
                 WHERE id = ${id} AND decision IS NULL AND expires_at > now() RETURNING 1`
    : await db()`UPDATE core.oauth_requests SET decision = 'deny' WHERE id = ${id} AND decision IS NULL RETURNING 1`;
  return rows.length > 0;
}

export interface TokenSet {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** New tokens for a grant; none of them outlives the grant itself. */
async function issue(grantId: string): Promise<TokenSet> {
  const [g] = await db()<{ can_write: boolean; left_s: number }[]>`
    SELECT e.can_write, extract(epoch FROM g.expires_at - now())::int AS left_s
    FROM core.oauth_grants g JOIN core.mcp_endpoints e ON e.id = g.endpoint_id WHERE g.id = ${grantId}`;
  if (!g || g.left_s <= 60) throw new OAuthError('invalid_grant', 'this connection has ended; connect again');
  const access = randomToken('bat');
  const refresh = randomToken('brt');
  const accessS = Math.min(ACCESS_TTL_S, g.left_s);
  await db()`INSERT INTO core.oauth_tokens (hash, kind, grant_id, expires_at) VALUES
             (${sha256(access)}, 'access', ${grantId}, now() + make_interval(secs => ${accessS})),
             (${sha256(refresh)}, 'refresh', ${grantId}, now() + make_interval(secs => ${Math.min(REFRESH_TTL_S, g.left_s)}))`;
  return { access_token: access, token_type: 'Bearer', expires_in: accessS, refresh_token: refresh, scope: scopeFor(g.can_write) };
}

/**
 * Takes a code or refresh token once (marks it used) and returns its grant. A code used twice means it
 * leaked: the whole grant goes (RFC 6749 4.1.2), and so does a reused refresh token's.
 */
async function take(kind: 'code' | 'refresh', token: string, clientId: string) {
  const [row] = await db()<{ grant_id: string; client_id: string; redirect_uri: string | null; code_challenge: string | null; used: boolean; expired: boolean }[]>`
    SELECT t.grant_id, g.client_id, t.redirect_uri, t.code_challenge, t.used_at IS NOT NULL AS used, t.expires_at < now() AS expired
    FROM core.oauth_tokens t JOIN core.oauth_grants g ON g.id = t.grant_id
    WHERE t.hash = ${sha256(token)} AND t.kind = ${kind}`;
  if (!row || row.client_id !== clientId) throw new OAuthError('invalid_grant', `unknown ${kind}`);
  if (row.used) {
    await db()`DELETE FROM core.oauth_grants WHERE id = ${row.grant_id}`;
    throw new OAuthError('invalid_grant', `${kind} already used; the connection was removed`);
  }
  if (row.expired) throw new OAuthError('invalid_grant', `${kind} expired`);
  const marked = await db()`UPDATE core.oauth_tokens SET used_at = now() WHERE hash = ${sha256(token)} AND used_at IS NULL RETURNING 1`;
  if (!marked.length) throw new OAuthError('invalid_grant', `${kind} already used`);
  return row;
}

export async function exchangeCode(clientId: string, code: string, redirectUri: string, verifier: string, pkce: (v: string, c: string) => boolean): Promise<TokenSet> {
  const row = await take('code', code, clientId);
  if (row.redirect_uri !== redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
  if (!row.code_challenge || !pkce(verifier, row.code_challenge)) throw new OAuthError('invalid_grant', 'PKCE check failed');
  return issue(row.grant_id);
}

export async function refresh(clientId: string, token: string): Promise<TokenSet> {
  const row = await take('refresh', token, clientId);
  return issue(row.grant_id);
}

export interface GrantAccess {
  grantId: string;
  client: string;
  profileId: string;
  endpointId: string;
  endpoint: string;
  scope: string;
  /** The apps it sees (its address's); null = all. */
  extensions: string[] | null;
}

/** A bearer token at /mcp: its connection, or null. Touches last_used_at at most once a minute. */
export async function verifyAccess(token: string): Promise<GrantAccess | null> {
  if (!token.startsWith('bat_') || token.length > 100) return null;
  const [row] = await db()<
    { grant_id: string; name: string; profile_id: string; endpoint_id: string; endpoint: string; can_write: boolean; extensions: string[] | null; stale: boolean }[]
  >`
    SELECT g.id AS grant_id, c.name, e.profile_id, e.id AS endpoint_id, e.name AS endpoint, e.can_write, e.extensions,
           (g.last_used_at IS NULL OR g.last_used_at < now() - interval '1 minute') AS stale
    FROM core.oauth_tokens t JOIN core.oauth_grants g ON g.id = t.grant_id JOIN core.oauth_clients c ON c.id = g.client_id
    JOIN core.mcp_endpoints e ON e.id = g.endpoint_id
    WHERE t.hash = ${sha256(token)} AND t.kind = 'access' AND t.expires_at > now() AND g.expires_at > now()`;
  if (!row) return null;
  if (row.stale) await db()`UPDATE core.oauth_grants SET last_used_at = now() WHERE id = ${row.grant_id}`;
  return {
    grantId: row.grant_id,
    client: row.name,
    profileId: row.profile_id,
    endpointId: row.endpoint_id,
    endpoint: row.endpoint,
    scope: scopeFor(row.can_write),
    extensions: row.extensions
  };
}

/** RFC 7009: forget one token (and with a refresh token, its whole connection). Unknown tokens are fine. */
export async function revokeToken(token: string): Promise<void> {
  const [row] = await db()<{ grant_id: string; kind: string }[]>`SELECT grant_id, kind FROM core.oauth_tokens WHERE hash = ${sha256(token)}`;
  if (!row) return;
  if (row.kind === 'refresh') await db()`DELETE FROM core.oauth_grants WHERE id = ${row.grant_id}`;
  else await db()`DELETE FROM core.oauth_tokens WHERE hash = ${sha256(token)}`;
}

export interface Connection {
  id: string;
  client: string;
  profileId: string;
  endpointId: string;
  endpoint: string;
  builtin: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/** The approved connections, of one profile or all (expired ones are cleaned up). */
export async function listConnections(profileId: string | null = null): Promise<Connection[]> {
  await db()`DELETE FROM core.oauth_tokens WHERE expires_at < now() - interval '1 day'`;
  await db()`DELETE FROM core.oauth_grants g WHERE g.created_at < now() - interval '1 day'
             AND NOT EXISTS (SELECT 1 FROM core.oauth_tokens t WHERE t.grant_id = g.id)`;
  await db()`DELETE FROM core.oauth_grants WHERE expires_at < now()`;
  const rows = await db()<
    { id: string; name: string; profile_id: string; endpoint_id: string; endpoint: string; builtin: boolean; created_at: Date; last_used_at: Date | null; expires_at: Date }[]
  >`
    SELECT g.id, c.name, g.profile_id, e.id AS endpoint_id, e.name AS endpoint, e.builtin, g.created_at, g.last_used_at, g.expires_at
    FROM core.oauth_grants g JOIN core.oauth_clients c ON c.id = g.client_id JOIN core.mcp_endpoints e ON e.id = g.endpoint_id
    WHERE ${profileId}::text IS NULL OR g.profile_id = ${profileId}
    ORDER BY g.created_at DESC`;
  return rows.map((r) => ({
    id: r.id,
    client: r.name,
    profileId: r.profile_id,
    endpointId: r.endpoint_id,
    endpoint: r.endpoint,
    builtin: r.builtin,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
    expiresAt: r.expires_at.toISOString()
  }));
}

export async function removeConnection(id: string, profileId: string | null = null): Promise<boolean> {
  return (await db()`DELETE FROM core.oauth_grants WHERE id = ${id} AND (${profileId}::text IS NULL OR profile_id = ${profileId}) RETURNING 1`).length > 0;
}

/** Turning the connector off ends every connection, and every request still waiting. */
export async function removeAllConnections(): Promise<number> {
  await db()`DELETE FROM core.oauth_requests WHERE done_at IS NULL`;
  return (await db()`DELETE FROM core.oauth_grants RETURNING 1`).length;
}

export interface ToolCall {
  at: string;
  source: 'connector' | 'terminal';
  endpoint: string | null;
  client: string | null;
  profileId: string;
  tool: string;
  ok: boolean;
  error: string | null;
  ms: number;
}

/** One line in core.tool_calls per tools/call. Never fails the call itself. Rows older than 90 days go. */
export async function logToolCall(c: Omit<ToolCall, 'at'> & { grantId: string | null }): Promise<void> {
  try {
    await db()`INSERT INTO core.tool_calls (source, grant_id, endpoint, client, profile_id, tool, ok, error, ms)
               VALUES (${c.source}, ${c.grantId}, ${c.endpoint}, ${c.client}, ${c.profileId}, ${c.tool.slice(0, 200)}, ${c.ok}, ${c.error?.slice(0, 300) ?? null}, ${c.ms})`;
    if (Math.random() < 0.01) await db()`DELETE FROM core.tool_calls WHERE at < now() - interval '90 days'`;
  } catch (e) {
    console.warn(`[mcp] could not log a tool call: ${e instanceof Error ? e.message : e}`);
  }
}

/** The latest tool calls, of one profile or all. */
export async function recentToolCalls(limit = 50, profileId: string | null = null): Promise<ToolCall[]> {
  const rows = await db()<
    { at: Date; source: 'connector' | 'terminal'; endpoint: string | null; client: string | null; profile_id: string; tool: string; ok: boolean; error: string | null; ms: number }[]
  >`
    SELECT at, source, endpoint, client, profile_id, tool, ok, error, ms FROM core.tool_calls
    WHERE ${profileId}::text IS NULL OR profile_id = ${profileId} ORDER BY at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    at: r.at.toISOString(),
    source: r.source,
    endpoint: r.endpoint,
    client: r.client,
    profileId: r.profile_id,
    tool: r.tool,
    ok: r.ok,
    error: r.error,
    ms: r.ms
  }));
}
