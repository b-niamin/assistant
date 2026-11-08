/**
 * One extension's panel in System settings (like an app's page in iOS Settings): on/off, who sees it,
 * the fields its manifest declares, its secrets. Needs the 10-minute unlock, like all of System settings.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { readSettings, saveSettings } from '$lib/extensions/config.server';
import { extensionById, saveExtensionSwitches } from '$lib/extensions/registry.server';
import { deleteSecret, listSecretSlots, secretsAvailable, setSecret } from '$lib/server/extension-secrets';
import { isElevated, listProfiles, SESSION_COOKIE } from '$lib/server/session';
import { sidecarsConfigured, terminalStatus } from '$lib/server/sidecars';

async function guard(sid: string | undefined, id?: string) {
  if (!(await isElevated(sid))) throw redirect(303, id ? `/settings?next=extensions/${encodeURIComponent(id)}` : '/settings');
}

async function extOf(id: string) {
  const ext = await extensionById(id);
  if (!ext) throw error(404, 'Not found');
  return ext;
}

export const load: PageServerLoad = async ({ params, cookies }) => {
  await guard(cookies.get(SESSION_COOKIE), params.id);
  const ext = await extOf(params.id);
  const [values, secrets, profiles] = await Promise.all([readSettings(ext), listSecretSlots([ext]), listProfiles()]);
  const status = await terminalStatus();
  return {
    ext,
    values,
    secrets,
    profiles,
    secretsAvailable: secretsAvailable(),
    terminal: { configured: sidecarsConfigured(), reachable: status.reachable, claude: status.claude, codex: status.codex }
  };
};

const log = (what: string) => console.log(`[settings] ${new Date().toISOString()} ${what}`);

export const actions: Actions = {
  switches: async ({ params, request, cookies }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    const f = await request.formData();
    const known = new Set((await listProfiles()).map((p) => p.id));
    const picked = f.getAll('profiles').map(String).filter((p) => known.has(p));
    const everyone = f.get('everyone') === 'on';
    if (!everyone && !picked.length) return fail(400, { error: 'Pick at least one profile, or Everyone.' });
    await saveExtensionSwitches(ext.id, f.get('enabled') === 'on', everyone ? null : picked);
    log(`extension ${ext.id} switches saved`);
    return { ok: 'Saved.' };
  },
  fields: async ({ params, request, cookies }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    try {
      await saveSettings(ext, await request.formData());
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    log(`extension ${ext.id} settings saved`);
    return { ok: 'Settings saved.' };
  },
  secret: async ({ params, request, cookies }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    if (!secretsAvailable()) return fail(503, { error: 'Set SECRETS_KEY in .env first.' });
    const f = await request.formData();
    const name = String(f.get('name') ?? '');
    if (!ext.secrets.includes(name)) return fail(400, { error: 'Unknown secret.' });
    try {
      if (f.get('remove') === '1') await deleteSecret(ext, name);
      else await setSecret(ext, name, String(f.get('value') ?? ''));
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    log(`secret ${ext.id}/${name} ${f.get('remove') === '1' ? 'removed' : 'set'}`);
    return { ok: f.get('remove') === '1' ? 'Removed.' : 'Saved.' };
  }
};
