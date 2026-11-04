/**
 * Look of the in-app terminal (System settings → Terminal). The terminal is a dark window in both app
 * themes, like a code block: its ANSI colours are the app's categorical hues (specs/001-design.md),
 * lifted where needed so text stays readable on the dark background.
 */
export const TERMINAL_FONT =
  "'JetBrains Mono Variable', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

export const TERMINAL_BG = '#141413';

export const TERMINAL_THEME = {
  background: TERMINAL_BG,
  foreground: '#e8e6df',
  cursor: '#eb6834', // --hue-orange, Pip's colour
  cursorAccent: TERMINAL_BG,
  selectionBackground: 'rgba(57, 135, 229, 0.38)',
  selectionInactiveBackground: 'rgba(57, 135, 229, 0.2)',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.12)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.22)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.3)',
  black: '#262624',
  red: '#e66767',
  green: '#4cbf5c',
  yellow: '#e5ac2e',
  blue: '#4f95ea',
  magenta: '#de6f9a',
  cyan: '#2bbf8a',
  white: '#c3c2b7',
  brightBlack: '#6e6d68',
  brightRed: '#f08f8f',
  brightGreen: '#7ad788',
  brightYellow: '#f2c867',
  brightBlue: '#86b6ef',
  brightMagenta: '#f0a1c0',
  brightCyan: '#6fdbb4',
  brightWhite: '#f7f6f2'
};

/** Font size steps (px) for the A−/A+ buttons. */
export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18];
export const defaultFontSize = (narrow: boolean): number => (narrow ? 12 : 14);

export function stepFontSize(current: number, dir: 1 | -1): number {
  const i = FONT_SIZES.findIndex((s) => s >= current);
  const at = i === -1 ? FONT_SIZES.length - 1 : i;
  return FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, at + dir))];
}
