/**
 * First-run wizard: only while no app password exists. Needs the one-time setup code that install.sh
 * printed (SETUP_TOKEN), so whoever reaches the page first cannot claim the instance.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isConfigured, passwordProblem, setPassword, setupTokenMatches, setupTokenSet } from '$lib/server/app-config';
import { db } from '$lib/server/db';
import { createLimiter } from '$lib/server/rate-limit';
import { createSession, elevateSession, PROFILE_COOKIE, SESSION_COOKIE, SESSION_DAYS } from '$lib/server/session';

const limiter = createLimiter(10, 15 * 60 * 1000);

export const load: PageServerLoad = async () => {
  if (await isConfigured()) throw redirect(303, '/');
  return { tokenSet: setupTokenSet() };
};

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    if (await isConfigured()) throw redirect(303, '/');
    const ip = getClientAddress();
    if (!limiter.attempt(ip)) return fail(429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const f = await request.formData();
    if (!setupTokenMatches(String(f.get('code') ?? ''))) return fail(401, { error: 'Wrong setup code (install.sh printed it; it is SETUP_TOKEN in .env).' });
    const password = String(f.get('password') ?? '');
    const problem = passwordProblem(password, String(f.get('repeat') ?? ''));
    if (problem) return fail(400, { error: problem });
    const name = String(f.get('name') ?? '').trim().slice(0, 40) || 'Me';
    const profileId = String(f.get('profile') ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(profileId)) return fail(400, { error: 'Profile id: lowercase letters, digits and dashes.' });

    await setPassword(password);
    await db()`INSERT INTO core.profiles (id, name) VALUES (${profileId}, ${name})
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
    const sid = await createSession(request.headers.get('user-agent'), ip);
    await elevateSession(sid);
    const opts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: url.protocol === 'https:' };
    cookies.set(SESSION_COOKIE, sid, { ...opts, maxAge: SESSION_DAYS * 24 * 3600 });
    cookies.set(PROFILE_COOKIE, profileId, { ...opts, maxAge: 365 * 24 * 3600 });
    throw redirect(303, '/settings?welcome=1');
  }
};
