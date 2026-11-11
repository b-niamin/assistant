/**
 * System settings: one place for everything, like the iOS Settings app. Each extension has its own panel
 * (/settings/extensions/<id>); profiles have /settings/profiles; the system part has the terminal, browser,
 * updates and the app password. Everything here needs the app password again (10-minute unlock,
 * core.sessions.elevated_until). Extensions are built by Claude: /settings/extensions/new prepares the request.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { LANG_COOKIE, LANGUAGES, localizeExtension, pickLanguage, tFor } from '#lib/i18n/index.ts';
import { languageSettings, saveLanguageSettings } from '#lib/server/languages.ts';
import { defaultAgent, isAgent, passwordFromEnv, passwordHash, passwordProblem, setDefaultAgent, setPassword } from '#lib/server/app-config.ts';
import { verifyPassword } from '#lib/server/password.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';
import { sidecarsConfigured, terminalStatus } from '#lib/server/sidecars.ts';
import { buildTail, latestOnGithub, setUpdaterControl, updateView, updaterControl, updaterStatus } from '#lib/server/updater.ts';
import { deleteOtherSessions, dropElevation, elevateSession, isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';

const limiter = createLimiter(5, 15 * 60 * 1000);
/** Where unlock goes next (?next=profiles): a settings sub-page, nothing else. */
const NEXT_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/;

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return { locked: true as const };
  const [all, profiles, updates, terminal, updateControl, agent, languages] = await Promise.all([
    allExtensions(),
    listProfiles(),
    updaterStatus(),
    terminalStatus(),
    updaterControl(),
    defaultAgent(),
    languageSettings()
  ]);
  const extensions = all.map((e) => localizeExtension(e, locals.lang));
  return {
    locked: false as const,
    extensions,
    // System settings -> Language (spec 007): what is offered, and which apps still lack a language.
    languages: {
      ...languages,
      all: LANGUAGES.map((l) => ({ code: l.code, name: l.name })),
      missing: extensions
        .map((e) => ({ id: e.id, name: e.name, langs: languages.enabled.filter((l) => !e.languages.includes(l)) }))
        .filter((e) => e.langs.length)
    },
    profiles,
    updates,
    updateView: updates ? updateView(updates, updateControl) : null,
    // main on GitHub right now (null when it does not answer): a newer commit shows "Update" at once.
    latestSha: updates?.repo ? await latestOnGithub(updates.repo, updates.branch) : null,
    updateControl,
    buildTail: updates?.status === 'updating' || updates?.status === 'failed' ? await buildTail() : [],
    terminal: { ...terminal, configured: sidecarsConfigured() },
    defaultAgent: agent,
    passwordFromEnv: passwordFromEnv()
  };
};

/** Every action but unlock: refuse unless this session is unlocked. */
async function guard(cookies: { get(n: string): string | undefined }) {
  return isElevated(cookies.get(SESSION_COOKIE));
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export const actions: Actions = {
  unlock: async ({ request, cookies, getClientAddress, url, locals }) => {
    const t = tFor(locals.lang);
    const ip = getClientAddress();
    if (!limiter.attempt(ip)) return fail(429, { error: t('Too many attempts. Try again in 15 minutes.') });
    if (!verifyPassword(str(await request.formData(), 'password'), await passwordHash()))
      return fail(401, { error: t('Wrong password.') });
    limiter.reset(ip);
    await elevateSession(cookies.get(SESSION_COOKIE)!);
    const next = url.searchParams.get('next') ?? '';
    if (NEXT_RE.test(next)) throw redirect(303, `/settings/${next}`);
    return { ok: t('Unlocked for 10 minutes.') };
  },

  lock: async ({ cookies, locals }) => {
    await dropElevation(cookies.get(SESSION_COOKIE));
    return { ok: tFor(locals.lang)('Locked.') };
  },

  /** Which languages the app offers and extensions are translated into, and the default (spec 007). */
  languages: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const f = await request.formData();
    const saved = await saveLanguageSettings({ enabled: f.getAll('enabled').map(String), default: str(f, 'default') });
    // The new default may be another language than this page's: answer in the one the next page shows.
    return { ok: tFor(pickLanguage(saved, cookies.get(LANG_COOKIE)))('Languages saved.') };
  },

  /** Automatic or manual updates; the host's updater reads it on its next run (spec 006). */
  updateMode: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const mode = str(await request.formData(), 'mode') === 'manual' ? 'manual' : 'auto';
    await setUpdaterControl({ ...(await updaterControl()), mode });
    return { ok: mode === 'manual' ? t('Manual updates: the app shows new versions and waits for "Update now".') : t('Automatic updates.') };
  },

  /** "Update now" (also "Retry" and "Resume"): a request the updater takes at its next run, within a minute
   * (it deploys GitHub main, nothing else). */
  updateNow: async ({ cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    await setUpdaterControl({ ...(await updaterControl()), request: new Date().toISOString() });
    console.log(`[settings] ${new Date().toISOString()} update requested`);
    return { ok: t('Update requested: it starts within a minute.') };
  },

  /** Restarts of llm and terminal: asked for first, or automatic (spec 006). */
  updateRestarts: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const restarts = str(await request.formData(), 'restarts') === 'auto' ? 'auto' : 'ask';
    await setUpdaterControl({ ...(await updaterControl()), restarts });
    return { ok: restarts === 'auto' ? t('Updates restart llm and terminal by themselves.') : t('Updates ask before restarting llm and terminal.') };
  },

  /** The AI CLI that Update, Build it and Install start in the dock's terminal. */
  defaultAgent: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const agent = str(await request.formData(), 'agent');
    if (!isAgent(agent)) return fail(400, { error: t('Pick Claude Code or Codex.') });
    await setDefaultAgent(agent);
    return { ok: t('{name} is the default AI.', { name: agent === 'codex' ? 'Codex' : 'Claude Code' }) };
  },

  /** "Restart now": the updater recreates the services that wait for it, within a minute. */
  updateRestart: async ({ cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    await setUpdaterControl({ ...(await updaterControl()), restart: new Date().toISOString() });
    console.log(`[settings] ${new Date().toISOString()} restart of the held services requested`);
    return { ok: t('Restart requested: it starts within a minute.') };
  },

  /** "Cancel" during an update: the updater's next run stops the running one (old containers stay). */
  updateCancel: async ({ cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    await setUpdaterControl({ ...(await updaterControl()), cancel: new Date().toISOString() });
    console.log(`[settings] ${new Date().toISOString()} update cancel requested`);
    return { ok: t('Cancelling: the updater stops the update within a minute.') };
  },

  password: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    if (passwordFromEnv()) return fail(400, { error: t('The password is set in .env (APP_PASSWORD_HASH); change it there.') });
    const f = await request.formData();
    const problem = passwordProblem(String(f.get('password') ?? ''), String(f.get('repeat') ?? ''));
    if (problem) return fail(400, { error: t(problem) });
    await setPassword(String(f.get('password')));
    // Whoever knew the old password may still hold a session: log every other device out.
    const n = await deleteOtherSessions(cookies.get(SESSION_COOKIE));
    return { ok: t('Password changed.') + ' ' + t.n(n, '{n} other session logged out.', '{n} other sessions logged out.') };
  }
};
