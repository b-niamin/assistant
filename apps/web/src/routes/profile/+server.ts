import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProfiles, PROFILE_COOKIE } from '$lib/server/session';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
  const id = String((await request.formData()).get('profile') ?? '');
  const profiles = await listProfiles();
  if (!profiles.some((p) => p.id === id)) throw error(400, 'Unknown profile');
  cookies.set(PROFILE_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 365 * 24 * 3600
  });
  const back = request.headers.get('referer');
  const target = back && new URL(back).origin === url.origin ? new URL(back).pathname : '/';
  throw redirect(303, target);
};
