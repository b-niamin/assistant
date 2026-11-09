import type { LayoutServerLoad } from './$types';
import { extensionsFor } from '#lib/extensions/registry.server.ts';
import { listProfiles } from '#lib/server/session.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.authenticated) return { authenticated: false, profiles: [], profileId: locals.profileId, theme: locals.theme, extensions: [] };
  return {
    authenticated: true,
    profiles: await listProfiles(),
    profileId: locals.profileId,
    theme: locals.theme,
    extensions: await extensionsFor(locals.profileId)
  };
};
