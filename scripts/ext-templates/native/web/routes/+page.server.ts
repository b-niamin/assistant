import { fail, type ExtActions, type ExtLoad } from '$shell';
import { addItem, listItems } from '../lib/items.server';
import { cleanTitle } from '../lib/validate';

export const load = (async (_event, ctx) => ({
  items: await ctx.db((sql) => listItems(sql, ctx.dataProfileId))
})) satisfies ExtLoad;

// Annotated (not inferred): SvelteKit's tooling would otherwise type it against a ./$types that
// only exists for routes inside apps/web.
export const actions: ExtActions = {
  add: async ({ request }, ctx) => {
    const title = cleanTitle((await request.formData()).get('title'));
    if (!title) return fail(400, { error: ctx.t('Title is 1 to 200 characters.') });
    await ctx.db((sql) => addItem(sql, ctx.dataProfileId, title));
    return { ok: true };
  }
};
