/**
 * Tools for Claude (spec 005). Not for browsers: hooks.server.ts lets a request in only with
 * `Authorization: Bearer $CLAUDE_TOOLS_TOKEN`, which the claude container has.
 *   GET  /api/claude?profile=alex                       every extension the profile sees, with its tools
 *   POST /api/claude {extension, tool, arguments, profile}  run one tool, returns {result}
 */
import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callTool, listTools } from '#lib/extensions/tools.server.ts';
import { listProfiles } from '#lib/server/session.ts';

async function profileOf(v: unknown, fallback: string): Promise<string> {
  const id = typeof v === 'string' && v ? v : fallback;
  if (!(await listProfiles()).some((p) => p.id === id)) throw error(400, `unknown profile ${id}`);
  return id;
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const profile = await profileOf(url.searchParams.get('profile'), locals.profileId);
  return json({ profile, profiles: await listProfiles(), extensions: await listTools(profile) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.extension !== 'string' || typeof body.tool !== 'string') throw error(400, 'need {extension, tool}');
  const profile = await profileOf(body.profile, locals.profileId);
  try {
    return json({ result: await callTool(body.extension, body.tool, body.arguments ?? {}, profile) });
  } catch (e) {
    if (isHttpError(e)) throw e;
    // Tool errors (bad SQL, validation) go back to Claude as text, not as a 500.
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
};
