/**
 * System settings -> Terminal and AI: the sign-ins of the terminal's CLIs (Claude Code, Codex, GitHub CLI),
 * the default AI that Update, Build it and Install start, and where the Claude connector stands.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tFor } from '#lib/i18n/index.ts';
import { defaultAgent, isAgent, setDefaultAgent } from '#lib/server/app-config.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { sidecarsConfigured, terminalStatus } from '#lib/server/sidecars.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=ai');
  const [terminal, agent] = await Promise.all([terminalStatus(), defaultAgent()]);
  return { terminal: { ...terminal, configured: sidecarsConfigured() }, defaultAgent: agent };
};

export const actions: Actions = {
  /** The AI CLI that Update, Build it and Install start in the dock's terminal. */
  defaultAgent: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    const agent = String((await request.formData()).get('agent') ?? '').trim();
    if (!isAgent(agent)) return fail(400, { error: t('Pick Claude Code or Codex.') });
    await setDefaultAgent(agent);
    return { ok: t('{name} is the default AI.', { name: agent === 'codex' ? 'Codex' : 'Claude Code' }) };
  }
};
