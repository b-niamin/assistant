/**
 * The settings shell: whether this session is unlocked (the sidebar shows only then; hooks.server.ts
 * sends locked visits below /settings to the unlock on /settings) and the sidebar's attention dots.
 */
import type { LayoutServerLoad } from './$types';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { settingsStatus } from '#lib/server/settings-status.ts';

export const load: LayoutServerLoad = async ({ cookies, depends }) => {
  depends('app:updates');
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return { unlocked: false as const, status: null };
  return { unlocked: true as const, status: await settingsStatus() };
};
