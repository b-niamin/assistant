/** OAuth token endpoint for the Claude connector (spec 005): authorization_code (PKCE S256) and refresh_token. */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { basicAuth, pkceMatches } from '#lib/mcp/oauth.ts';
import { clientAuthenticates, exchangeCode, OAuthError, refresh } from '#lib/mcp/oauth.server.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';

const limiter = createLimiter(120, 15 * 60 * 1000);
const noStore = { 'cache-control': 'no-store', pragma: 'no-cache' };
const oauthError = (code: string, description: string, status = 400) => json({ error: code, error_description: description }, { status, headers: noStore });

async function form(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v ?? '')]));
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

export const POST: RequestHandler = async ({ request }) => {
  if (!limiter.attempt('token')) return oauthError('slow_down', 'too many requests', 429);
  const f = await form(request);
  const basic = basicAuth(request.headers.get('authorization'));
  const clientId = basic?.[0] ?? f.client_id ?? '';
  const secret = basic?.[1] ?? f.client_secret ?? null;
  if (!clientId || !(await clientAuthenticates(clientId, secret))) return oauthError('invalid_client', 'unknown client or wrong secret', 401);
  try {
    if (f.grant_type === 'authorization_code')
      return json(await exchangeCode(clientId, f.code ?? '', f.redirect_uri ?? '', f.code_verifier ?? '', pkceMatches), { headers: noStore });
    if (f.grant_type === 'refresh_token') return json(await refresh(clientId, f.refresh_token ?? ''), { headers: noStore });
    return oauthError('unsupported_grant_type', 'authorization_code or refresh_token');
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e.code, e.message, e.status);
    throw e;
  }
};
