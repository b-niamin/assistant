/** OAuth dynamic client registration (RFC 7591) for the Claude connector (spec 005). */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { OAuthError, registerClient } from '#lib/mcp/oauth.server.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';

// Public: a few registrations an hour are plenty (one per client that connects).
const limiter = createLimiter(30, 60 * 60 * 1000);

export const POST: RequestHandler = async ({ request }) => {
  if (!limiter.attempt('register')) return json({ error: 'temporarily_unavailable', error_description: 'too many registrations' }, { status: 429 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'invalid_client_metadata', error_description: 'JSON body expected' }, { status: 400 });
  try {
    return json(await registerClient(body as Record<string, unknown>), { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof OAuthError) return json({ error: e.code, error_description: e.message }, { status: e.status });
    throw e;
  }
};
