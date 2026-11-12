/**
 * Profile settings (the menu under the avatar): what belongs to the profile in use: its name, how the app
 * looks in this browser (cookies, no server side) and Claude and MCP (spec 005). The profile's MCP addresses to paste into Claude (the built-in one with every app, and
 * its own: a name, the apps ticked, may change data or not), the connections waiting for approval, its
 * connections and its latest tool calls. Needs the unlocked session, like System settings: approving a
 * connection lets the internet in.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db.ts';
import { extensionsFor, invalidate } from '#lib/extensions/registry.server.ts';
import { localizeExtension, tFor } from '#lib/i18n/index.ts';
import { cleanName, createEndpoint, deleteEndpoint, listEndpoints, updateEndpoint } from '#lib/mcp/endpoints.server.ts';
import { decideRequest, listConnections, pendingRequests, recentToolCalls, removeConnection } from '#lib/mcp/oauth.server.ts';
import { isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';
import { funnelStatus, updaterControl } from '#lib/server/updater.ts';

const guard = async (cookies: { get(n: string): string | undefined }) => isElevated(cookies.get(SESSION_COOKIE));

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await guard(cookies))) throw redirect(303, '/settings?next=profile');
  const profileId = locals.profileId;
  const [profiles, endpoints, exts, pending, connections, calls, funnel, control] = await Promise.all([
    listProfiles(),
    listEndpoints(profileId),
    extensionsFor(profileId),
    pendingRequests(),
    listConnections(profileId),
    recentToolCalls(30, profileId),
    funnelStatus(),
    updaterControl()
  ]);
  // The public base the addresses live under: the Funnel URL without its /mcp.
  const base = funnel?.state === 'on' && funnel.url ? funnel.url.replace(/\/mcp\/?$/, '') : null;
  return {
    profile: profiles.find((p) => p.id === profileId) ?? { id: profileId, name: profileId },
    connectorOn: control.funnel === 'on',
    base,
    endpoints,
    apps: exts.filter((e) => e.enabled).map((e) => localizeExtension(e, locals.lang)).map((e) => ({ id: e.id, name: e.name, shared: e.scope === 'shared' })),
    pending,
    connections,
    calls
  };
};

async function readForm(request: Request, profileId: string) {
  const f = await request.formData();
  const known = new Set((await extensionsFor(profileId)).map((e) => e.id));
  return {
    f,
    id: String(f.get('id') ?? ''),
    name: cleanName(f.get('name')),
    apps: f.getAll('apps').map(String).filter((x) => known.has(x)),
    write: f.get('write') === 'on'
  };
}

export const actions: Actions = {
  /** The profile's own name (the id stays: data hangs on it). */
  rename: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const name = String((await request.formData()).get('name') ?? '').trim();
    if (!name || name.length > 40) return fail(400, { error: t('Name: 1 to 40 characters.') });
    await db()`UPDATE core.profiles SET name = ${name} WHERE id = ${locals.profileId}`;
    invalidate();
    return { ok: t('Renamed to {name}.', { name }) };
  },

  create: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const { name, apps, write } = await readForm(request, locals.profileId);
    if (!name) return fail(400, { error: t('Give it a name.') });
    if (!apps.length) return fail(400, { error: t('Pick at least one app.') });
    await createEndpoint(locals.profileId, name, apps, write);
    return { ok: t('Address added. Copy it into Claude as a new custom connector.') };
  },

  update: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const { id, name, apps, write } = await readForm(request, locals.profileId);
    if (!name) return fail(400, { error: t('Give it a name.') });
    if (!apps.length) return fail(400, { error: t('Pick at least one app.') });
    if (!(await updateEndpoint(locals.profileId, id, name, apps, write))) return fail(404, { error: t('That address is gone.') });
    return { ok: t('Saved. Its connections see the change at their next call.') };
  },

  delete: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const { id } = await readForm(request, locals.profileId);
    if (!(await deleteEndpoint(locals.profileId, id))) return fail(404, { error: t('That address is gone.') });
    return { ok: t('Address removed, with its connections.') };
  },

  /** A connection waiting on the public page: approve it on one of this profile's addresses, or deny it. */
  decide: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const { f, id } = await readForm(request, locals.profileId);
    if (f.get('decision') !== 'allow') {
      await decideRequest(id, { allow: false });
      return { ok: t('Denied.') };
    }
    const endpointId = String(f.get('endpoint') ?? '');
    if (!(await listEndpoints(locals.profileId)).some((e) => e.id === endpointId)) return fail(400, { error: t('Pick an address.') });
    if (!(await decideRequest(id, { allow: true, endpointId })))
      return fail(404, { error: t('That request has ended. Connect again from Claude.') });
    return { ok: t('Approved: Claude finishes connecting within a few seconds.') };
  },

  remove: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const { id } = await readForm(request, locals.profileId);
    if (!(await removeConnection(id, locals.profileId))) return fail(404, { error: t('That connection is gone already.') });
    return { ok: t('Connection removed: that client has to sign in again.') };
  }
};
