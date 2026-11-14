/**
 * This browser's own choices (cookies, read by hooks.server.ts and the root layout): theme, language,
 * reduced motion and whether the terminal's bar shows. Shared
 * by the avatar menu and Profile settings -> Appearance.
 */
import { MOTION_COOKIE, THEME_COOKIE, type Theme } from '#lib/theme.ts';
import { LANG_COOKIE } from '#lib/i18n/index.ts';
import { dock } from '#lib/dock/dock.svelte.ts';

/** `terminal=on`: the terminal's bar at the bottom shows (off by default: the chat is the main way in). */
export const TERMINAL_COOKIE = 'terminal';

const YEAR = 365 * 24 * 3600;
const cookie = (name: string, value: string, maxAge: number) => {
  document.cookie = `${name}=${value};path=/;max-age=${maxAge};samesite=lax${location.protocol === 'https:' ? ';secure' : ''}`;
};

/** Applies at once (data-theme on <html>), and is remembered; System forgets the cookie. */
export function setTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  cookie(THEME_COOKIE, theme, theme === 'system' ? 0 : YEAR);
}

/** Remembered in this browser (spec 007); the page reloads so every text, app and date follows. */
export function setLanguage(code: string) {
  cookie(LANG_COOKIE, code, YEAR);
  location.reload();
}

export const motionReduced = () => typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce';

export function setMotionReduced(calm: boolean) {
  if (calm) document.documentElement.dataset.motion = 'reduce';
  else delete document.documentElement.dataset.motion;
  cookie(MOTION_COOKIE, 'reduce', calm ? YEAR : 0);
}

export function setTerminal(on: boolean) {
  dock.enabled = on;
  if (!on && !dock.started) dock.wanted = false;
  cookie(TERMINAL_COOKIE, 'on', on ? YEAR : 0);
}
