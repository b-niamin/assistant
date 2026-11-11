/**
 * OAuth 2.1 for the Claude connector (spec 005), the database side (migration 010). A client registers
 * itself (POST /mcp/oauth/register); the owner approves it once with the app password, which makes a
 * grant (one connection, shown in System settings) and a single-use code; the code becomes an access
 * token (1 hour) and a refresh token (90 days, rotated on every use). Only SHA-256 hashes are stored.
 */
import { db } from '#lib/server/db.ts';
import { ACCESS_TTL_S, CODE_TTL_S, randomToken, REFRESH_TTL_S, sha256, validRedirectUri } from './oauth';

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

/** Anyone on the internet can register: keep the table small. Approval still needs the app password. */
const MAX_CLIENTS = 200;

export async function registerClient(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirectUri))
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris: 1-10 https URLs (or http on localhost)');
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

/** After the owner approved: a new grant and its single-use code. */
export async function approve(client: OAuthClient, profileId: string, redirectUri: string, codeChallenge: string): Promise<string> {
  const grant = randomToken('bgr', 12);
  const code = randomToken('bco');
  await db().begin(async (sql) => {
    await sql`INSERT INTO core.oauth_grants (id, client_id, profile_id) VALUES (${grant}, ${client.id}, ${profileId})`;
    await sql`INSERT INTO core.oauth_tokens (hash, kind, grant_id, redirect_uri, code_challenge, expires_at)
              VALUES (${sha256(code)}, 'code', ${grant}, ${redirectUri}, ${codeChallenge}, now() + make_interval(secs => ${CODE_TTL_S}))`;
  });
  return code;
}

export interface TokenSet {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issue(grantId: string): Promise<TokenSet> {
  const access = randomToken('bat');
  const refresh = randomToken('brt');
  await db()`INSERT INTO core.oauth_tokens (hash, kind, grant_id, expires_at) VALUES
             (${sha256(access)}, 'access', ${grantId}, now() + make_interval(secs => ${ACCESS_TTL_S})),
             (${sha256(refresh)}, 'refresh', ${grantId}, now() + make_interval(secs => ${REFRESH_TTL_S}))`;
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: 'mcp' };
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

/** A bearer token at /mcp: its grant's profile, or null. Touches last_used_at at most once a minute. */
export async function verifyAccess(token: string): Promise<{ grantId: string; profileId: string } | null> {
  if (!token.startsWith('bat_') || token.length > 100) return null;
  const [row] = await db()<{ grant_id: string; profile_id: string; stale: boolean }[]>`
    SELECT g.id AS grant_id, g.profile_id, (g.last_used_at IS NULL OR g.last_used_at < now() - interval '1 minute') AS stale
    FROM core.oauth_tokens t JOIN core.oauth_grants g ON g.id = t.grant_id
    WHERE t.hash = ${sha256(token)} AND t.kind = 'access' AND t.expires_at > now()`;
  if (!row) return null;
  if (row.stale) await db()`UPDATE core.oauth_grants SET last_used_at = now() WHERE id = ${row.grant_id}`;
  return { grantId: row.grant_id, profileId: row.profile_id };
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
  createdAt: string;
  lastUsedAt: string | null;
}

/** The approved connections for System settings (expired ones, whose refresh token ran out, are cleaned up). */
export async function listConnections(): Promise<Connection[]> {
  await db()`DELETE FROM core.oauth_tokens WHERE expires_at < now() - interval '1 day'`;
  await db()`DELETE FROM core.oauth_grants g WHERE g.created_at < now() - interval '1 day'
             AND NOT EXISTS (SELECT 1 FROM core.oauth_tokens t WHERE t.grant_id = g.id)`;
  const rows = await db()<{ id: string; name: string; profile_id: string; created_at: Date; last_used_at: Date | null }[]>`
    SELECT g.id, c.name, g.profile_id, g.created_at, g.last_used_at
    FROM core.oauth_grants g JOIN core.oauth_clients c ON c.id = g.client_id ORDER BY g.created_at DESC`;
  return rows.map((r) => ({
    id: r.id,
    client: r.name,
    profileId: r.profile_id,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null
  }));
}

export async function removeConnection(id: string): Promise<boolean> {
  return (await db()`DELETE FROM core.oauth_grants WHERE id = ${id} RETURNING 1`).length > 0;
}

/** Turning the connector off ends every connection. */
export async function removeAllConnections(): Promise<number> {
  return (await db()`DELETE FROM core.oauth_grants RETURNING 1`).length;
}
