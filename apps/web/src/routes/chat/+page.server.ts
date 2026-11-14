/** The chat moved into the panel on the right of every page: old links open it on the dashboard. */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
  const c = url.searchParams.get('c');
  throw redirect(303, c && /^[a-f0-9]{16}$/.test(c) ? `/?chat=${c}` : '/?chat');
};
