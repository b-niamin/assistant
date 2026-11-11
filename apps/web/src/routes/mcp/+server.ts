/**
 * The assistant's MCP server (spec 005), Streamable HTTP without sessions: POST one JSON-RPC message (or
 * a batch), get one JSON answer. Two ways in, both a bearer token:
 *   - an OAuth access token of the Claude connector (claude.ai, over Tailscale Funnel), for the profile
 *     its connection was approved for;
 *   - CLAUDE_TOOLS_TOKEN, for the AI CLIs in the terminal container (scripts/assistant-mcp.mjs), for the
 *     default profile. Refused on the public listener: it never leaves the stack.
 * Without a token: 401 with the protected-resource metadata, where an MCP client starts OAuth.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { backendFor } from '#lib/mcp/backend.server.ts';
import { publicBase } from '#lib/mcp/oauth.ts';
import { verifyAccess } from '#lib/mcp/oauth.server.ts';
import { handleBody } from '#lib/mcp/protocol.ts';
import { defaultProfile } from '#lib/server/app-config.ts';
import { claudeTokenMatches } from '#lib/server/claude-token.ts';

const MAX_BODY = 1024 * 1024;

async function profileFor(request: Request): Promise<string | null> {
  const auth = request.headers.get('authorization');
  if (request.headers.get('x-beni-public') !== '1' && claudeTokenMatches(auth)) return defaultProfile();
  if (!auth?.startsWith('Bearer ')) return null;
  return (await verifyAccess(auth.slice(7).trim()))?.profileId ?? null;
}

function unauthorized(request: Request) {
  const base = publicBase(request.headers.get('x-forwarded-host') ?? request.headers.get('host'), process.env.ORIGIN ?? '');
  return json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in: connect this server through OAuth.' } },
    {
      status: 401,
      headers: { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="mcp"` }
    }
  );
}

export const POST: RequestHandler = async ({ request }) => {
  const profile = await profileFor(request);
  if (!profile) return unauthorized(request);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const out = await handleBody(body, backendFor(profile));
  if (out.status === 202) return new Response(null, { status: 202 });
  return json(out.json, { status: out.status, headers: { 'cache-control': 'no-store' } });
};

/** No server-to-client stream and no sessions: GET and DELETE are not offered (Streamable HTTP allows that). */
const notOffered: RequestHandler = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
export const GET = notOffered;
export const DELETE = notOffered;
