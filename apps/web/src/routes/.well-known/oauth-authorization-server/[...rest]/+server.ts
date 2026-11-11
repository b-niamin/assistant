/** RFC 8414 metadata of the Claude connector's OAuth server (spec 005). */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authServerMetadata, publicBase } from '#lib/mcp/oauth.ts';

export const GET: RequestHandler = ({ request }) =>
  json(authServerMetadata(publicBase(request.headers.get('x-forwarded-host') ?? request.headers.get('host'), process.env.ORIGIN ?? '')), {
    headers: { 'access-control-allow-origin': '*' }
  });
