/**
 * Extension key-value storage: GET everything, PATCH {set, remove, clear, base}. Same-origin only.
 * PATCH answers the new versions of the keys it wrote; with `base` (the versions the writer loaded),
 * a key changed elsewhere since answers 409 and nothing is written.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { KvConflict, kvAll, kvApply, validatePatch } from '#lib/extensions/kv.server.ts';
import { extensionById, visibleTo } from '#lib/extensions/registry.server.ts';

async function extFor(id: string, profileId: string) {
  const ext = await extensionById(id);
  if (!ext || !visibleTo(ext, profileId)) throw error(404, 'Not found');
  return ext;
}

export const GET: RequestHandler = async ({ params, locals }) =>
  json(await kvAll(await extFor(params.id, locals.profileId), locals.profileId));

export const PATCH: RequestHandler = async ({ params, locals, request, url }) => {
  // JSON requests are not covered by SvelteKit's form CSRF check: insist on our own origin.
  if (request.headers.get('origin') !== url.origin) throw error(403, 'Cross-origin request');
  const ext = await extFor(params.id, locals.profileId);
  let patch;
  try {
    patch = validatePatch(await request.json());
  } catch (e) {
    throw error(400, (e as Error).message);
  }
  try {
    return json({ versions: await kvApply(ext, locals.profileId, patch) });
  } catch (e) {
    if (e instanceof KvConflict) return json({ conflict: e.keys }, { status: 409 });
    throw error(413, (e as Error).message);
  }
};
