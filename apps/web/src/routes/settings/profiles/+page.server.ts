/**
 * Profiles in System settings: who uses the assistant and which apps each one sees. A profile is a
 * separate data space, not an account. Adding one picks its apps in the same step; renaming keeps the id.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions, invalidate, saveExtensionSwitches, visibleTo } from '$lib/extensions/registry.server';
import { db } from '$lib/server/db';
import { isElevated, listProfiles, SESSION_COOKIE } from '$lib/server/session';
import { PROFILE_ID_RE, uniqueProfileId, visibilityAfterAdd } from '$lib/settings/guide';

async function guard(sid: string | undefined) {
  if (!(await isElevated(sid))) throw redirect(303, '/settings?next=profiles');
}

export const load: PageServerLoad = async ({ cookies, locals }) => {
  await guard(cookies.get(SESSION_COOKIE));
  const [profiles, extensions] = await Promise.all([listProfiles(), allExtensions()]);
  return {
    current: locals.profileId,
    profiles: profiles.map((p) => ({
      ...p,
      apps: extensions.filter((e) => visibleTo(e, p.id)).map((e) => ({ id: e.id, name: e.name }))
    })),
    extensions: extensions.filter((e) => e.enabled).map((e) => ({ id: e.id, name: e.name, description: e.description, scope: e.scope, everyone: e.profiles === null }))
  };
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const log = (what: string) => console.log(`[settings] ${new Date().toISOString()} ${what}`);

export const actions: Actions = {
  add: async ({ request, cookies }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const f = await request.formData();
    const name = str(f, 'name');
    if (!name || name.length > 40) return fail(400, { error: 'Give the profile a name (up to 40 characters).', name });
    const profiles = await listProfiles();
    const typed = str(f, 'id');
    const id = typed || uniqueProfileId(name, profiles.map((p) => p.id));
    if (!PROFILE_ID_RE.test(id) || id.length > 32)
      return fail(400, { error: 'The short id may use lowercase letters, digits and dashes, and must start with a letter.', name });
    if (profiles.some((p) => p.id === id)) return fail(400, { error: `There is already a profile with the id "${id}".`, name });

    await db()`INSERT INTO core.profiles (id, name) VALUES (${id}, ${name})`;
    const chosen = new Set(f.getAll('apps').map(String));
    const enabled = (await allExtensions()).filter((e) => e.enabled);
    for (const change of visibilityAfterAdd(enabled, profiles.map((p) => p.id), id, chosen))
      await saveExtensionSwitches(change.id, true, change.profiles);
    invalidate();
    log(`profile ${id} added`);
    return { ok: `Added ${name}. Switch to it from the menu at the top.`, added: id };
  },

  rename: async ({ request, cookies }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const f = await request.formData();
    const id = str(f, 'id');
    const name = str(f, 'name');
    if (!name || name.length > 40) return fail(400, { error: 'Name: 1 to 40 characters.' });
    const res = await db()`UPDATE core.profiles SET name = ${name} WHERE id = ${id}`;
    if (!res.count) return fail(404, { error: 'No such profile.' });
    invalidate();
    log(`profile ${id} renamed`);
    return { ok: `Renamed to ${name}.` };
  }
};
