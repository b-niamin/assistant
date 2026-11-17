/**
 * Installed extensions (id, name, href, version), so "Extend the system" can link a new one as soon as it is built
 * and Apps can tell when an update has landed.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { localizeExtension } from '#lib/i18n/index.ts';

export const GET: RequestHandler = async ({ locals }) =>
  json(
    (await allExtensions()).map((e) => localizeExtension(e, locals.lang)).map((e) => ({ id: e.id, name: e.name, href: e.href, version: e.version })),
    { headers: { 'cache-control': 'no-store' } }
  );
