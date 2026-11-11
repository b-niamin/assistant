/** A profile's MCP address, /mcp/x/<id> (spec 005): lib/mcp/handler.server.ts, endpoints.server.ts. */
import type { RequestHandler } from './$types';
import { handleMcp, notOffered } from '#lib/mcp/handler.server.ts';
import { ENDPOINT_ID_RE } from '#lib/mcp/endpoints.server.ts';

export const POST: RequestHandler = ({ request, params }) =>
  ENDPOINT_ID_RE.test(params.id) ? handleMcp(request, params.id) : new Response('Not found', { status: 404 });
export const GET: RequestHandler = notOffered;
export const DELETE: RequestHandler = notOffered;
