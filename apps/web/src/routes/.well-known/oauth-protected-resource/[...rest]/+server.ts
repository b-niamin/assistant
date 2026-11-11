/** RFC 9728 metadata of /mcp (spec 005): at /.well-known/oauth-protected-resource and .../mcp. */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publicBase, resourceMetadata } from '#lib/mcp/oauth.ts';

export const GET: RequestHandler = ({ request }) =>
  json(resourceMetadata(publicBase(request.headers.get('x-forwarded-host') ?? request.headers.get('host'), process.env.ORIGIN ?? '')), {
    headers: { 'access-control-allow-origin': '*' }
  });
