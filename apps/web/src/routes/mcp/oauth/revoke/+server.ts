/** OAuth token revocation (RFC 7009) for the Claude connector (spec 005). Always 200, as the RFC asks. */
import type { RequestHandler } from './$types';
import { revokeToken } from '#lib/mcp/oauth.server.ts';

export const POST: RequestHandler = async ({ request }) => {
  const token = new URLSearchParams(await request.text()).get('token') ?? '';
  if (token && token.length < 200) await revokeToken(token);
  return new Response(null, { status: 200 });
};
