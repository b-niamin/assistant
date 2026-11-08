import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { dashboardFor } from '#lib/extensions/dashboard.server.ts';
import { applyLayout, parseLayout, type LayoutRow } from '#lib/dashboard/layout.ts';
import { db } from '#lib/server/db.ts';

export const load: PageServerLoad = async ({ locals }) => {
  const [tiles, rows] = await Promise.all([
    dashboardFor(locals),
    db()<LayoutRow[]>`SELECT tile_key, position, hidden FROM core.dashboard_layout WHERE profile_id = ${locals.profileId}`
  ]);
  const laid = applyLayout(tiles, rows);
  return {
    // Tile data are promises: SvelteKit streams each one, so the grid paints before slow tiles finish.
    tiles: laid.filter((t) => !t.hidden),
    // For the "Arrange" editor: every tile, in order, without its data.
    layout: laid.map((t) => ({ key: t.key, title: t.title, source: t.extensionName, hidden: t.hidden }))
  };
};

export const actions: Actions = {
  /** Save this profile's tile order and hidden tiles. Not a setting for everyone: no unlock needed. */
  layout: async ({ request, locals }) => {
    const f = await request.formData();
    const rows = parseLayout(f.getAll('order').map(String), f.getAll('hidden').map(String));
    if (!rows.length) return fail(400, { error: 'Nothing to save.' });
    await db().begin(async (sql) => {
      await sql`DELETE FROM core.dashboard_layout WHERE profile_id = ${locals.profileId}`;
      await sql`INSERT INTO core.dashboard_layout ${sql(rows.map((r) => ({ profile_id: locals.profileId, ...r })))}`;
    });
    return { ok: true };
  }
};
