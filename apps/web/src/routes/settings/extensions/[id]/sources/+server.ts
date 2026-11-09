/** The panel's connected accounts as JSON: polled every few seconds while a sync runs, for the progress bar. */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sourcesOf } from '#lib/extensions/sources.server.ts';
import { extensionById } from '#lib/extensions/registry.server.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const GET: RequestHandler = async ({ params, cookies, locals }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw error(403, 'Unlock System settings first');
  const ext = await extensionById(params.id);
  if (!ext) throw error(404, 'Not found');
  return json(await sourcesOf(ext, { locals }), { headers: { 'cache-control': 'no-store' } });
};
