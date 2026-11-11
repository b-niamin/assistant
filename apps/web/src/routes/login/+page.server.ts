import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { passwordHash } from '#lib/server/app-config.ts';
import { tFor } from '#lib/i18n/index.ts';
import { verifyPassword } from '#lib/server/password.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';
import { createSession, SESSION_COOKIE, SESSION_DAYS } from '#lib/server/session.ts';

const limiter = createLimiter(10, 15 * 60 * 1000);

/** Only same-site relative paths, so `next` can never send you to another origin. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.authenticated) throw redirect(303, safeNext(url.searchParams.get('next')));
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress, locals }) => {
    const t = tFor(locals.lang);
    const ip = getClientAddress();
    if (!limiter.attempt(ip)) return fail(429, { error: t('Too many attempts. Try again in 15 minutes.') });
    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    if (!verifyPassword(password, await passwordHash())) return fail(401, { error: t('Wrong password.') });
    limiter.reset(ip);
    const id = await createSession(request.headers.get('user-agent'), ip);
    cookies.set(SESSION_COOKIE, id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: SESSION_DAYS * 24 * 3600
    });
    throw redirect(303, safeNext(url.searchParams.get('next')));
  }
};
