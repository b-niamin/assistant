/**
 * The touch key bar under the terminal: keys a phone keyboard lacks. Each key is the byte sequence a
 * real terminal would send; Ctrl is sticky and applies to the next typed character.
 */
export type Arrow = 'up' | 'down' | 'right' | 'left';

export type BarKey =
  | { kind: 'seq'; label: string; title: string; seq: string }
  | { kind: 'arrow'; label: string; title: string; dir: Arrow }
  | { kind: 'ctrl'; label: string; title: string };

const ARROW_CODE: Record<Arrow, string> = { up: 'A', down: 'B', right: 'C', left: 'D' };

/** Arrow keys: CSI in normal mode, SS3 when the app turned on application cursor keys (vim, tmux copy mode). */
export const arrowSeq = (dir: Arrow, applicationMode: boolean): string =>
  (applicationMode ? '\x1bO' : '\x1b[') + ARROW_CODE[dir];

/** What Ctrl+<ch> sends, or null when Ctrl does not change that character. */
export function ctrlOf(ch: string): string | null {
  if (ch.length !== 1) return null;
  const c = ch.toLowerCase().charCodeAt(0);
  if (c >= 97 && c <= 122) return String.fromCharCode(c - 96); // a..z -> 0x01..0x1a
  const special: Record<string, string> = { ' ': '\x00', '@': '\x00', '[': '\x1b', '\\': '\x1c', ']': '\x1d', '^': '\x1e', _: '\x1f', '?': '\x7f' };
  return special[ch] ?? null;
}

export const BAR_KEYS: BarKey[] = [
  { kind: 'seq', label: 'Esc', title: 'Escape', seq: '\x1b' },
  { kind: 'seq', label: 'Tab', title: 'Tab', seq: '\t' },
  { kind: 'seq', label: '⇧Tab', title: 'Shift+Tab (Claude Code: switch mode)', seq: '\x1b[Z' },
  { kind: 'ctrl', label: 'Ctrl', title: 'Ctrl: applies to the next key' },
  { kind: 'seq', label: '^C', title: 'Ctrl+C (interrupt)', seq: '\x03' },
  { kind: 'arrow', label: '←', title: 'Left', dir: 'left' },
  { kind: 'arrow', label: '↑', title: 'Up', dir: 'up' },
  { kind: 'arrow', label: '↓', title: 'Down', dir: 'down' },
  { kind: 'arrow', label: '→', title: 'Right', dir: 'right' },
  { kind: 'seq', label: '/', title: 'Slash', seq: '/' },
  { kind: 'seq', label: '|', title: 'Pipe', seq: '|' },
  { kind: 'seq', label: '~', title: 'Tilde', seq: '~' },
  { kind: 'seq', label: '-', title: 'Dash', seq: '-' }
];
