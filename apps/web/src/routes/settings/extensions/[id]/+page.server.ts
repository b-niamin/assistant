/**
 * One extension's panel in System settings (like an app's page in iOS Settings): on/off, who sees it,
 * the fields its manifest declares, its secrets. Needs the 10-minute unlock, like all of System settings.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { readSettings, saveSettings } from '#lib/extensions/config.server.ts';
import { runSourceAction, saveSourceFields, sourcesOf } from '#lib/extensions/sources.server.ts';
import { extensionById, saveExtensionSwitches } from '#lib/extensions/registry.server.ts';
import { deleteSecret, listSecretSlots, secretsAvailable, setSecret } from '#lib/server/extension-secrets.ts';
import { isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';
import { localizeExtension, tFor } from '#lib/i18n/index.ts';

async function guard(sid: string | undefined, id?: string) {
  if (!(await isElevated(sid))) throw redirect(303, id ? `/settings?next=extensions/${encodeURIComponent(id)}` : '/settings');
}

async function extOf(id: string) {
  const ext = await extensionById(id);
  if (!ext) throw error(404, 'Not found');
  return ext;
}

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
  await guard(cookies.get(SESSION_COOKIE), params.id);
  const ext = await extOf(params.id);
  const [values, secrets, profiles, sources] = await Promise.all([
    readSettings(ext),
    listSecretSlots([ext]),
    listProfiles(),
    sourcesOf(ext, { locals })
  ]);
  return {
    // Name, description and field labels in the page's language (the extension's i18n/<lang>.json).
    ext: localizeExtension(ext, locals.lang),
    values,
    secrets,
    profiles,
    sources,
    secretsAvailable: secretsAvailable()
  };
};

const log = (what: string) => console.log(`[settings] ${new Date().toISOString()} ${what}`);

export const actions: Actions = {
  switches: async ({ params, request, cookies, locals }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    const t = tFor(locals.lang, ext.id);
    const f = await request.formData();
    const known = new Set((await listProfiles()).map((p) => p.id));
    const picked = f.getAll('profiles').map(String).filter((p) => known.has(p));
    const everyone = f.get('everyone') === 'on';
    if (!everyone && !picked.length) return fail(400, { error: t('Pick at least one profile, or Everyone.') });
    await saveExtensionSwitches(ext.id, f.get('enabled') === 'on', everyone ? null : picked);
    log(`extension ${ext.id} switches saved`);
    return { ok: t('Saved.') };
  },
  fields: async ({ params, request, cookies, locals }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    const t = tFor(locals.lang, ext.id);
    try {
      await saveSettings(ext, await request.formData());
    } catch (e) {
      return fail(400, { error: t((e as Error).message) });
    }
    log(`extension ${ext.id} settings saved`);
    return { ok: t('Settings saved.') };
  },
  source: async ({ params, request, cookies, locals }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    const t = tFor(locals.lang, ext.id);
    const f = await request.formData();
    const source = String(f.get('source') ?? '');
    const action = String(f.get('action') ?? '');
    const date = f.get('date');
    try {
      const ok = await runSourceAction(ext, { locals }, source, action, typeof date === 'string' && date ? { date } : {});
      log(`extension ${ext.id} source ${source}: ${action}`);
      return { ok: t(ok), source };
    } catch (e) {
      return fail(400, { error: t((e as Error).message), source });
    }
  },
  connect: async ({ params, request, cookies, locals }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    const t = tFor(locals.lang, ext.id);
    const f = await request.formData();
    const source = String(f.get('source') ?? '');
    if (!secretsAvailable() && ext.settings.some((x) => x.type === 'secret' && f.get(`field:${x.name}`))) {
      return fail(503, { error: t('Set SECRETS_KEY in .env first.'), source });
    }
    try {
      const ok = await saveSourceFields(ext, { locals }, source, f);
      log(`extension ${ext.id} source ${source}: fields saved`);
      return { ok: t(ok), source };
    } catch (e) {
      return fail(400, { error: t((e as Error).message), source });
    }
  },
  secret: async ({ params, request, cookies, locals }) => {
    await guard(cookies.get(SESSION_COOKIE));
    const ext = await extOf(params.id);
    const t = tFor(locals.lang, ext.id);
    if (!secretsAvailable()) return fail(503, { error: t('Set SECRETS_KEY in .env first.') });
    const f = await request.formData();
    const name = String(f.get('name') ?? '');
    if (!ext.secrets.includes(name)) return fail(400, { error: t('Unknown secret.') });
    try {
      if (f.get('remove') === '1') await deleteSecret(ext, name);
      else await setSecret(ext, name, String(f.get('value') ?? ''));
    } catch (e) {
      return fail(400, { error: t((e as Error).message) });
    }
    log(`secret ${ext.id}/${name} ${f.get('remove') === '1' ? 'removed' : 'set'}`);
    return { ok: f.get('remove') === '1' ? t('Removed.') : t('Saved.') };
  }
};
