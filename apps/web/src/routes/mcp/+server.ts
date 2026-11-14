/** The MCP server at /mcp (spec 005): lib/mcp/handler.server.ts. */
import type { RequestHandler } from './$types';
import { handleMcp, notOffered } from '#lib/mcp/handler.server.ts';

export const POST: RequestHandler = ({ request }) => handleMcp(request, null);
export const GET: RequestHandler = ({ request }) => notOffered(request, null);
export const DELETE: RequestHandler = ({ request }) => notOffered(request, null);
