/**
 * "Add an app": a short guided form that turns an idea into a ready prompt for Claude Code in the
 * terminal (add-extension skill). Nothing is installed from here; Claude builds the extension in the repo.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '$lib/extensions/registry.server';
import { isElevated, SESSION_COOKIE } from '$lib/server/session';
import { sidecarsConfigured, terminalStatus } from '$lib/server/sidecars';

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=extensions/new');
  const [extensions, status] = await Promise.all([allExtensions(), terminalStatus()]);
  return {
    installed: extensions.map((e) => e.name),
    terminal: { configured: sidecarsConfigured(), reachable: status.reachable, claude: status.claude }
  };
};
