/**
 * Profile settings (the menu under the avatar): the profile in use, its name, and how the app looks in this
 * browser (cookies, no server side). Its MCP connector is /settings/mcp.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db.ts';
import { invalidate } from '#lib/extensions/registry.server.ts';
import { tFor } from '#lib/i18n/index.ts';
import { isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';

const guard = async (cookies: { get(n: string): string | undefined }) => isElevated(cookies.get(SESSION_COOKIE));

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await guard(cookies))) throw redirect(303, '/settings?next=profile');
  const profiles = await listProfiles();
  return { profile: profiles.find((p) => p.id === locals.profileId) ?? { id: locals.profileId, name: locals.profileId }, profiles };
};

export const actions: Actions = {
  /** The profile's own name (the id stays: data hangs on it). */
  rename: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const name = String((await request.formData()).get('name') ?? '').trim();
    if (!name || name.length > 40) return fail(400, { error: t('Name: 1 to 40 characters.') });
    await db()`UPDATE core.profiles SET name = ${name} WHERE id = ${locals.profileId}`;
    invalidate();
    return { ok: t('Renamed to {name}.', { name }) };
  }
};
