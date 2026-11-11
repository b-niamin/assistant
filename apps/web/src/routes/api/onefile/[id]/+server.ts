/** Serves a onefile extension's HTML, with its stored data and the storage shim injected. */
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { EXTENSIONS_DIR } from '#lib/extensions/generated/registry.ts';
import { kvAllVersioned } from '#lib/extensions/kv.server.ts';
import { readSettings } from '#lib/extensions/config.server.ts';
import { injectShim, ONEFILE_CSP } from '#lib/extensions/onefile.ts';
import { themeTags } from '#lib/extensions/theme.ts';
import { accessoryOf } from '#lib/mascot.ts';
import { extensionById, visibleTo } from '#lib/extensions/registry.server.ts';

export const GET: RequestHandler = async ({ params, locals, url }) => {
  const ext = await extensionById(params.id);
  if (!ext || ext.kind !== 'onefile' || !visibleTo(ext, locals.profileId)) throw error(404, 'Not found');
  if (!ext.entry) throw error(404, 'Not found');
  const html = await readFile(path.join(EXTENSIONS_DIR, ext.id, ext.entry), 'utf8');
  const [{ data, versions }, settings] = await Promise.all([kvAllVersioned(ext, locals.profileId), readSettings(ext)]);
  const body = injectShim(html, data, url.origin, settings, themeTags(undefined, undefined, accessoryOf(ext)), locals.lang, versions);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': ONEFILE_CSP,
      'Cache-Control': 'no-store',
      // The app's data is inlined: never let it end up in another origin's hands via Referer or caches.
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin'
    }
  });
};
