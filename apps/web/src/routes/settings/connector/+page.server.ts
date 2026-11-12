/**
 * System settings -> MCP on the internet (spec 005): whether the assistant's MCP server answers on the
 * internet at all. On: the host's updater runs Tailscale Funnel for the public MCP listener (within a
 * minute). Here: the switch and the state the updater reports. Each profile's addresses, approvals,
 * connections and tool calls are its own MCP connector (/settings/mcp).
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { removeAllConnections } from '#lib/mcp/oauth.server.ts';
import { tFor } from '#lib/i18n/index.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { funnelStatus, isStale, setUpdaterControl, updaterControl, updaterStatus } from '#lib/server/updater.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=connector');
  const [control, funnel, updater] = await Promise.all([updaterControl(), funnelStatus(), updaterStatus()]);
  return {
    want: control.funnel ?? 'off',
    funnel,
    updaterInstalled: !!updater,
    // The updater applies the switch: when it has stopped ticking, "Turning on…" would wait forever.
    updaterStale: !!updater && isStale(updater),
    updaterSeen: updater ? updater.checkedAt || updater.at : ''
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
    console.log(`[settings] ${new Date().toISOString()} MCP on the internet turned ${on ? 'on' : 'off'}`);
    if (on) return { ok: t('Turning on: the updater publishes the address within a minute.') };
    const n = await removeAllConnections();
    const off = t('Turning off: the address goes offline within a minute.');
    return { ok: n ? `${off} ${t.n(n, '{n} connection removed.', '{n} connections removed.')}` : off };
  },

};
