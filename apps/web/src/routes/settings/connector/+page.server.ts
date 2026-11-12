/**
 * System settings -> Claude connector (spec 005): the assistant's MCP server for claude.ai and the Claude
 * apps. On: the host's updater runs Tailscale Funnel for the public MCP listener (within a minute), and
 * Claude signs in with OAuth. Here: the switch, the state the updater reports, every profile's
 * connections and the latest tool calls. The addresses to paste into Claude, and the approval of new
 * connections, are in each profile's settings (/settings/profile).
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listConnections, recentToolCalls, removeAllConnections, removeConnection } from '#lib/mcp/oauth.server.ts';
import { tFor } from '#lib/i18n/index.ts';
import { isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';
import { funnelStatus, isStale, setUpdaterControl, updaterControl, updaterStatus } from '#lib/server/updater.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=connector');
  const [control, funnel, updater, connections, profiles, calls] = await Promise.all([
    updaterControl(),
    funnelStatus(),
    updaterStatus(),
    listConnections(),
    listProfiles(),
    recentToolCalls(30)
  ]);
  return {
    want: control.funnel ?? 'off',
    funnel,
    updaterInstalled: !!updater,
    // The updater applies the switch: when it has stopped ticking, "Turning on…" would wait forever.
    updaterStale: !!updater && isStale(updater),
    updaterSeen: updater ? updater.checkedAt || updater.at : '',
    connections,
    profiles,
    calls
  };
};

const guard = async (cookies: { get(n: string): string | undefined }) => isElevated(cookies.get(SESSION_COOKIE));

export const actions: Actions = {
  /** The switch: the updater applies it on its next run (every minute). */
  funnel: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const on = String((await request.formData()).get('funnel')) === 'on';
    await setUpdaterControl({ ...(await updaterControl()), funnel: on ? 'on' : 'off' });
    console.log(`[settings] ${new Date().toISOString()} Claude connector turned ${on ? 'on' : 'off'}`);
    if (on) return { ok: t('Turning on: the updater publishes the address within a minute.') };
    const n = await removeAllConnections();
    const off = t('Turning off: the address goes offline within a minute.');
    return { ok: n ? `${off} ${t.n(n, '{n} connection removed.', '{n} connections removed.')}` : off };
  },

  remove: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const id = String((await request.formData()).get('id') ?? '');
    if (!(await removeConnection(id))) return fail(404, { error: t('That connection is gone already.') });
    return { ok: t('Connection removed: that client has to sign in again.') };
  }
};
