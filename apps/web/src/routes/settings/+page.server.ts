/**
 * System settings: one place for everything, like the iOS Settings app. The sidebar (+layout.svelte) leads
 * to a page per section; this overview shows what needs attention and the common tasks. Everything here
 * needs the app password again (10-minute unlock, core.sessions.elevated_until): this page holds the
 * unlock and the lock. Extensions are built by Claude: /settings/extensions/new prepares the request.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { tFor } from '#lib/i18n/index.ts';
import { languageSettings } from '#lib/server/languages.ts';
import { defaultAgent, passwordHash } from '#lib/server/app-config.ts';
import { verifyPassword } from '#lib/server/password.ts';
import { dropChatGrant } from '#lib/server/chat-grant.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';
import { sidecarsConfigured, terminalStatus } from '#lib/server/sidecars.ts';
import { dropElevation, elevateSession, isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';

const limiter = createLimiter(5, 15 * 60 * 1000);
/** Where unlock goes next (?next=profiles): a settings sub-page, nothing else. */
const NEXT_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/;

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return { locked: true as const };
  const [all, profiles, terminal, agent, languages] = await Promise.all([
    allExtensions(),
    listProfiles(),
    terminalStatus(),
    defaultAgent(),
    languageSettings()
  ]);
  return {
    locked: false as const,
    apps: all.length,
    untranslated: all.filter((e) => languages.enabled.some((l) => !e.languages.includes(l))).length,
    profiles,
    terminal: { ...terminal, configured: sidecarsConfigured() },
    defaultAgent: agent
  };
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export const actions: Actions = {
  unlock: async ({ request, cookies, getClientAddress, url, locals }) => {
    const t = tFor(locals.lang);
    const ip = getClientAddress();
    if (!limiter.attempt(ip)) return fail(429, { error: t('Too many attempts. Try again in 15 minutes.') });
    if (!verifyPassword(str(await request.formData(), 'password'), await passwordHash())) {
      console.warn(`[auth] ${new Date().toISOString()} wrong password at unlock from ${ip}`);
      return fail(401, { error: t('Wrong password.') });
    }
    limiter.reset(ip);
    await elevateSession(cookies.get(SESSION_COOKIE)!);
    const next = url.searchParams.get('next') ?? '';
    if (NEXT_RE.test(next)) throw redirect(303, `/settings/${next}`);
    return { ok: t('Unlocked for 10 minutes.') };
  },

  lock: async ({ cookies, locals }) => {
    await dropElevation(cookies.get(SESSION_COOKIE));
    dropChatGrant(cookies.get(SESSION_COOKIE));
    return { ok: tFor(locals.lang)('Locked.') };
  }
};
