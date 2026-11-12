/**
 * First-run wizard, step 1 (lib/setup/steps.ts): only while no app password exists. Needs the one-time
 * setup code that install.sh printed (SETUP_TOKEN), so whoever reaches the page first cannot claim the
 * instance. Makes the password, the app's language and the first profile, logs in and goes on to the apps.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isConfigured, passwordProblem, setPassword, setupTokenMatches, setupTokenSet } from '#lib/server/app-config.ts';
import { db } from '#lib/server/db.ts';
import { PROFILE_ID_RE } from '#lib/ids.js';
import { isLanguage, LANGUAGES } from '#lib/i18n/languages.ts';
import { tFor } from '#lib/i18n/index.ts';
import { saveLanguageSettings } from '#lib/server/languages.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';
import { createSession, elevateSession, PROFILE_COOKIE, SESSION_COOKIE, SESSION_DAYS } from '#lib/server/session.ts';

const limiter = createLimiter(10, 15 * 60 * 1000);

/** No language is chosen yet: the browser's first one the app knows (Accept-Language), else English. */
function browserLanguage(header: string | null): string {
  for (const part of (header ?? '').split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (code === 'en' || isLanguage(code)) return code;
  }
  return 'en';
}

export const load: PageServerLoad = async ({ request }) => {
  if (await isConfigured()) throw redirect(303, '/');
  const lang = browserLanguage(request.headers.get('accept-language'));
  return {
    tokenSet: setupTokenSet(),
    lang,
    setupLang: lang,
    languages: LANGUAGES.map((l) => ({ code: l.code, name: l.name }))
  };
};

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    if (await isConfigured()) throw redirect(303, '/');
    const ip = getClientAddress();
    const t = tFor(browserLanguage(request.headers.get('accept-language')));
    if (!limiter.attempt(ip)) return fail(429, { error: t('Too many attempts. Try again in 15 minutes.') });
    const f = await request.formData();
    if (!setupTokenMatches(String(f.get('code') ?? ''))) return fail(401, { error: t('Wrong setup code (install.sh printed it; it is SETUP_TOKEN in .env).') });
    const password = String(f.get('password') ?? '');
    const problem = passwordProblem(password, String(f.get('repeat') ?? ''));
    if (problem) return fail(400, { error: t(problem) });
    const name = String(f.get('name') ?? '').trim().slice(0, 40) || 'Me';
    const profileId = String(f.get('profile') ?? '').trim().toLowerCase();
    if (!PROFILE_ID_RE.test(profileId)) return fail(400, { error: t('Profile id: lowercase letters, digits and dashes.') });

    // The app's language (spec 007): offered next to English, and the default.
    const language = String(f.get('language') ?? '');
    if (isLanguage(language)) await saveLanguageSettings({ enabled: ['en', language], default: language });
    await setPassword(password);
    await db()`INSERT INTO core.profiles (id, name) VALUES (${profileId}, ${name})
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
    const sid = await createSession(request.headers.get('user-agent'), ip);
    await elevateSession(sid);
    const opts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: url.protocol === 'https:' };
    cookies.set(SESSION_COOKIE, sid, { ...opts, maxAge: SESSION_DAYS * 24 * 3600 });
    cookies.set(PROFILE_COOKIE, profileId, { ...opts, maxAge: 365 * 24 * 3600 });
    throw redirect(303, '/setup/apps');
  }
};
