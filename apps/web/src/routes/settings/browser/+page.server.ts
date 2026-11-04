import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isElevated, SESSION_COOKIE } from '$lib/server/session';
import { browserReachable, sidecarsConfigured } from '$lib/server/sidecars';

export const load: PageServerLoad = async ({ cookies }) => {
  // Admin only: System settings unlocks with the password (10 min), then comes back here.
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings');
  return {
  configured: sidecarsConfigured(),
  reachable: await browserReachable()
};
};
