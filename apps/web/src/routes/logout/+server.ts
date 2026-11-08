import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession, SESSION_COOKIE } from '#lib/server/session.ts';

export const POST: RequestHandler = async ({ cookies }) => {
  await deleteSession(cookies.get(SESSION_COOKIE));
  cookies.delete(SESSION_COOKIE, { path: '/' });
  throw redirect(303, '/login');
};
