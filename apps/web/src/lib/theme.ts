/**
 * Light, dark or the system's choice, remembered per browser in the `theme` cookie. The server writes
 * it as `data-theme` on <html> (hooks.server.ts), so the page never flashes the other theme.
 */
export type Theme = 'light' | 'dark' | 'system';
export const THEME_COOKIE = 'theme';
/** "Reduce motion" from the user menu (`motion=reduce`): on top of the system's setting, per browser. */
export const MOTION_COOKIE = 'motion';

export function parseTheme(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The <html> tag for a theme and language; `system` leaves it to `prefers-color-scheme`. */
export function htmlTag(theme: Theme, lang = 'en', reduceMotion = false): string {
  const code = /^[a-z]{2}$/.test(lang) ? lang : 'en';
  const attrs = `lang="${code}"${theme === 'system' ? '' : ` data-theme="${theme}"`}${reduceMotion ? ' data-motion="reduce"' : ''}`;
  return `<html ${attrs}>`;
}
