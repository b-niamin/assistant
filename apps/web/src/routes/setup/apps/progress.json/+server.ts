/**
 * Where the wizard's installs are: `fetched` = in extensions/installed.json (`ext install` is done), `built`
 * = in the running app (live-reload rebuilt it with them). Between the two the app is being rebuilt.
 */
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { EXTENSIONS_DIR } from '#lib/extensions/generated/registry.ts';
import { jsonObject, readText } from '#lib/server/status-files.ts';

export const GET: RequestHandler = async () => {
  const reg = jsonObject(await readText(path.join(EXTENSIONS_DIR, 'installed.json')));
  const list = Array.isArray(reg?.extensions) ? (reg.extensions as unknown[]) : [];
  const fetched = list.map((e) => (e && typeof e === 'object' ? String((e as { id?: unknown }).id ?? '') : '')).filter(Boolean);
  const built = (await allExtensions()).map((e) => e.id);
  return json({ fetched, built }, { headers: { 'cache-control': 'no-store' } });
};
