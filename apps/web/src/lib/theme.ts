/**
 * Light, dark or the system's choice, remembered per browser in the `theme` cookie. The server writes
 * it as `data-theme` on <html> (hooks.server.ts), so the page never flashes the other theme.
 */
export type Theme = 'light' | 'dark' | 'system';
export const THEME_COOKIE = 'theme';

export function parseTheme(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The <html> tag for a theme; `system` leaves it to `prefers-color-scheme`. */
export function htmlTag(theme: Theme): string {
  return theme === 'system' ? '<html lang="en">' : `<html lang="en" data-theme="${theme}">`;
}
