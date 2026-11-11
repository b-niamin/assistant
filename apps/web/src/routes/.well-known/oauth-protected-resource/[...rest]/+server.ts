/** RFC 9728 metadata of /mcp and of each profile's MCP address (spec 005): .../mcp, .../mcp/x/<id>. */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publicBase, resourceMetadata } from '#lib/mcp/oauth.ts';

export const GET: RequestHandler = ({ request, params }) => {
  const path = /^mcp\/x\/e[a-z0-9]{20}$/.test(params.rest) ? `/${params.rest}` : '/mcp';
  return json(resourceMetadata(publicBase(request.headers.get('x-forwarded-host') ?? request.headers.get('host'), process.env.ORIGIN ?? ''), path), {
    headers: { 'access-control-allow-origin': '*' }
  });
};
