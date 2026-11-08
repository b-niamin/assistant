/** Installed extensions (id, name, href), so the terminal page can link a new one as soon as it is built. */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';

export const GET: RequestHandler = async () =>
  json((await allExtensions()).map((e) => ({ id: e.id, name: e.name, href: e.href })), { headers: { 'cache-control': 'no-store' } });
