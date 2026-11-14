/**
 * The assistant's MCP server (spec 005), Streamable HTTP without sessions: POST one JSON-RPC message (or
 * a batch), get one JSON answer. Served at /mcp and at each profile's MCP address /mcp/x/<id>
 * (endpoints.server.ts). Two ways in, both a bearer token:
 *   - an OAuth access token of the Claude connector (claude.ai, over Tailscale Funnel): the profile, apps
 *     and writes of the address its connection was approved on (lib/mcp/backend.server.ts). On an address
 *     only that address's connections are let in; /mcp takes any (connections made before addresses);
 *   - CLAUDE_TOOLS_TOKEN, for the AI CLIs in the terminal container (scripts/assistant-mcp.mjs), on /mcp
 *     only: every tool, default profile unless a call names one. Refused on the public listener: it never
 *     leaves the stack.
 * Without a token: 401 with the protected-resource metadata, where an MCP client starts OAuth.
 */
import { json } from '@sveltejs/kit';
import { backendFor, type Caller } from './backend.server';
import { publicBase } from './oauth';
import { verifyAccess } from './oauth.server';
import { handleBody } from './protocol';
import { defaultProfile } from '#lib/server/app-config.ts';
import { claudeTokenMatches } from '#lib/server/claude-token.ts';

const MAX_BODY = 1024 * 1024;

async function callerFor(request: Request, endpointId: string | null): Promise<Caller | null> {
  const auth = request.headers.get('authorization');
  if (!endpointId && request.headers.get('x-beni-public') !== '1' && claudeTokenMatches(auth))
    return { kind: 'terminal', profileId: await defaultProfile() };
  if (!auth?.startsWith('Bearer ')) return null;
  const grant = await verifyAccess(auth.slice(7).trim());
  if (!grant || (endpointId && grant.endpointId !== endpointId)) return null;
  return { kind: 'connector', ...grant };
}

function unauthorized(request: Request, path: string) {
  const base = publicBase(request.headers.get('x-forwarded-host') ?? request.headers.get('host'), process.env.ORIGIN ?? '');
  return json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in: connect this server through OAuth.' } },
    {
      status: 401,
      headers: { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource${path}", scope="mcp:read mcp:write"` }
    }
  );
}

export async function handleMcp(request: Request, endpointId: string | null): Promise<Response> {
  const caller = await callerFor(request, endpointId);
  if (!caller) return unauthorized(request, endpointId ? `/mcp/x/${endpointId}` : '/mcp');
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request too large' } }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const out = await handleBody(body, backendFor(caller));
  if (out.status === 202) return new Response(null, { status: 202 });
  return json(out.json, { status: out.status, headers: { 'cache-control': 'no-store' } });
}

/**
 * No server-to-client stream and no sessions: GET and DELETE are not offered (Streamable HTTP allows that).
 * Without a token they still answer 401, so a client probing the address with GET finds where to sign in.
 */
export async function notOffered(request: Request, endpointId: string | null): Promise<Response> {
  if (!(await callerFor(request, endpointId))) return unauthorized(request, endpointId ? `/mcp/x/${endpointId}` : '/mcp');
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
