/**
 * System settings: one place for everything, like the iOS Settings app. Each extension has its own panel
 * (/settings/extensions/<id>); profiles have /settings/profiles; the system part has the terminal, browser,
 * updates and the app password. Everything here needs the app password again (10-minute unlock,
 * core.sessions.elevated_until). Extensions are built by Claude: /settings/extensions/new prepares the request.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '$lib/extensions/registry.server';
import { passwordFromEnv, passwordHash, passwordProblem, setPassword } from '$lib/server/app-config';
import { verifyPassword } from '$lib/server/password';
import { createLimiter } from '$lib/server/rate-limit';
import { sidecarsConfigured, terminalStatus } from '$lib/server/sidecars';
import { updaterStatus } from '$lib/server/updater';
import { deleteOtherSessions, dropElevation, elevateSession, isElevated, listProfiles, SESSION_COOKIE } from '$lib/server/session';

const limiter = createLimiter(5, 15 * 60 * 1000);
/** Where unlock goes next (?next=profiles): a settings sub-page, nothing else. */
const NEXT_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/;

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return { locked: true as const };
  const [extensions, profiles, updates, terminal] = await Promise.all([allExtensions(), listProfiles(), updaterStatus(), terminalStatus()]);
  return {
    locked: false as const,
    extensions,
    profiles,
    updates,
    terminal: { ...terminal, configured: sidecarsConfigured() },
    passwordFromEnv: passwordFromEnv()
  };
};

/** Every action but unlock: refuse unless this session is unlocked. */
async function guard(cookies: { get(n: string): string | undefined }) {
  return isElevated(cookies.get(SESSION_COOKIE));
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export const actions: Actions = {
  unlock: async ({ request, cookies, getClientAddress, url }) => {
    const ip = getClientAddress();
    if (!limiter.attempt(ip)) return fail(429, { error: 'Too many attempts. Try again in 15 minutes.' });
    if (!verifyPassword(str(await request.formData(), 'password'), await passwordHash()))
      return fail(401, { error: 'Wrong password.' });
    limiter.reset(ip);
    await elevateSession(cookies.get(SESSION_COOKIE)!);
    const next = url.searchParams.get('next') ?? '';
    if (NEXT_RE.test(next)) throw redirect(303, `/settings/${next}`);
    return { ok: 'Unlocked for 10 minutes.' };
  },

  lock: async ({ cookies }) => {
    await dropElevation(cookies.get(SESSION_COOKIE));
    return { ok: 'Locked.' };
  },

  password: async ({ request, cookies }) => {
    if (!(await guard(cookies))) return fail(403, { error: 'Unlock first.' });
    if (passwordFromEnv()) return fail(400, { error: 'The password is set in .env (APP_PASSWORD_HASH); change it there.' });
    const f = await request.formData();
    const problem = passwordProblem(String(f.get('password') ?? ''), String(f.get('repeat') ?? ''));
    if (problem) return fail(400, { error: problem });
    await setPassword(String(f.get('password')));
    // Whoever knew the old password may still hold a session: log every other device out.
    const n = await deleteOtherSessions(cookies.get(SESSION_COOKIE));
    return { ok: `Password changed. ${n} other session${n === 1 ? '' : 's'} logged out.` };
  }
};
