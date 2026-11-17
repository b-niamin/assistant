/**
 * How the assistant looks for everyone (System settings -> Appearance, spec 001): the mascot's name and
 * kind, and the accent colour of the theme. Pure: the defaults and the check of what is stored or posted.
 */
export const MASCOT_KINDS = ['penguin', 'bean'] as const;
export type MascotKind = (typeof MASCOT_KINDS)[number];
/** Accent themes; each has validated light and dark steps in app.css (`html[data-accent]`). */
export const ACCENTS = ['lagoon', 'iris', 'plum', 'forest'] as const;
export type Accent = (typeof ACCENTS)[number];

export interface Appearance {
  /** What the mascot is called in the app's texts ("{name} says ..."). */
  name: string;
  kind: MascotKind;
  accent: Accent;
}

export const DEFAULT_APPEARANCE: Appearance = { name: 'Pingo', kind: 'penguin', accent: 'lagoon' };

/** A stored or posted value as a valid Appearance; anything odd falls back to the default. */
export function normalizeAppearance(raw: unknown): Appearance {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) : '';
  return {
    name: name || DEFAULT_APPEARANCE.name,
    kind: MASCOT_KINDS.includes(v.kind as MascotKind) ? (v.kind as MascotKind) : DEFAULT_APPEARANCE.kind,
    accent: ACCENTS.includes(v.accent as Accent) ? (v.accent as Accent) : DEFAULT_APPEARANCE.accent
  };
}
