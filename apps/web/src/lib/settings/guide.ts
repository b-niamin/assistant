/**
 * Pure helpers behind the guided flows in System settings: adding a profile (name -> id) and adding an
 * extension (a few answers -> a ready prompt for Claude in the terminal). Unit-tested; no I/O here.
 */

/** Profile ids: lowercase letters, digits and dashes, starting with a letter, up to 32 characters. */
export const PROFILE_ID_RE = /^[a-z][a-z0-9-]*$/;

/** "Anna Łucja" -> "anna-lucja". Empty when nothing usable is left (e.g. only digits or symbols). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return PROFILE_ID_RE.test(s) ? s : '';
}

/** A free id for a new profile: the slug, or slug-2, slug-3... when taken. */
export function uniqueProfileId(name: string, taken: Iterable<string>): string {
  const base = slugify(name) || 'profile';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 32 - String(n).length - 1)}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** One or two letters for a profile's avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0] ?? '';
  const second = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + second).toUpperCase();
}

const HUES = ['--hue-orange', '--hue-blue', '--hue-green', '--hue-violet', '--hue-aqua', '--hue-magenta', '--hue-yellow', '--hue-red'];

/** A stable colour per id (same id, same colour everywhere). */
export function hueFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(${HUES[h % HUES.length]})`;
}

/**
 * Which profiles see each extension after a new profile is created with a chosen set of apps.
 * `null` keeps "everyone"; an array is the explicit list. Only extensions whose list changes are returned.
 */
export function visibilityAfterAdd(
  extensions: { id: string; profiles: string[] | null }[],
  existingProfiles: string[],
  newProfile: string,
  chosen: Set<string>
): { id: string; profiles: string[] | null }[] {
  const out: { id: string; profiles: string[] | null }[] = [];
  for (const e of extensions) {
    const wants = chosen.has(e.id);
    if (e.profiles === null) {
      // Everyone sees it today, and so would the new profile: only an opt-out needs an explicit list.
      if (!wants) out.push({ id: e.id, profiles: existingProfiles.filter((p) => p !== newProfile) });
    } else if (wants && !e.profiles.includes(newProfile)) {
      out.push({ id: e.id, profiles: [...e.profiles, newProfile] });
    }
  }
  return out;
}

export type Scope = 'profile' | 'shared';

export interface Template {
  id: string;
  name: string;
  blurb: string;
  /** What `ext.mjs new` gets, or null for "Claude picks". */
  from: string | null;
  scope: Scope | null;
}

/** Starting points offered by the "Add an app" flow; the others are inspirations/<id> in the extensions repo. */
export const TEMPLATES: Template[] = [
  { id: 'auto', name: 'Let Claude pick', blurb: 'Claude chooses the best starting point for the idea.', from: null, scope: null },
  {
    id: 'home-assistant',
    name: 'Connected service',
    blurb: 'Like the Home example: an address and a token in its settings, data fetched on the server.',
    from: 'inspiration:home-assistant',
    scope: 'shared'
  },
  {
    id: 'calendar',
    name: 'Shared board',
    blurb: 'Like the Calendar example: one data set for the whole household, with dashboard tiles.',
    from: 'inspiration:calendar',
    scope: 'shared'
  },
  {
    id: 'learning',
    name: 'Personal tracker',
    blurb: 'Like the Learning example: each profile keeps its own data, streaks on the dashboard.',
    from: 'inspiration:learning',
    scope: 'profile'
  },
  {
    id: 'onefile',
    name: 'Simple one-file app',
    blurb: 'A single page with key-value storage, from onefile-apps. Best for logs, lists and habits.',
    from: 'onefile',
    scope: 'profile'
  }
];

/** Ideas shown as one-tap chips to get started. */
export const IDEAS: { label: string; text: string; template: string; scope: Scope }[] = [
  { label: 'Smart home', text: 'Show my Home Assistant rooms, temperatures and today\'s energy use.', template: 'home-assistant', scope: 'shared' },
  { label: 'Family calendar', text: 'A shared calendar with upcoming events for the whole family.', template: 'calendar', scope: 'shared' },
  { label: 'Habits', text: 'A daily habit tracker with streaks (water, stretching, reading).', template: 'onefile', scope: 'profile' },
  { label: 'Flashcards', text: 'Spaced-repetition flashcards for learning a language, with a daily streak.', template: 'learning', scope: 'profile' },
  { label: 'Budget', text: 'Track monthly expenses by category and show what is left this month.', template: 'auto', scope: 'shared' }
];

export interface ExtensionRequest {
  idea: string;
  inspiration?: string;
  scope: Scope;
  template: string;
  /** Overrides the template's starting point, e.g. `inspiration:<id>` from the catalog. */
  from?: string;
}

/** The prompt Claude gets in the terminal. One line, so it types cleanly into the shell. */
export function buildPrompt(r: ExtensionRequest): string {
  const idea = oneLine(r.idea) || 'a new app';
  const found = TEMPLATES.find((x) => x.id === r.template) ?? TEMPLATES[0];
  const t = r.from ? { ...found, from: r.from } : found;
  const parts = [
    `Use the add-extension skill to add a new extension to this assistant: ${idea.replace(/[.!?]?$/, '.')}`,
    r.inspiration?.trim() ? `Use ${oneLine(r.inspiration)} as inspiration only; build it fresh in extensions/.` : '',
    r.scope === 'shared' ? 'Data is shared by all profiles (scope shared).' : 'Each profile keeps its own data (scope profile).',
    t.from === 'onefile'
      ? 'Make it a onefile app (start from a fitting app in onefile-apps).'
      : t.from
        ? `Start from ${t.from} (inspirations/ in the extensions repo; node scripts/ext.mjs available lists ready-made apps).`
        : 'Pick the kind and starting point yourself (node scripts/ext.mjs available lists ready-made apps; skeletons are in inspirations/ of the extensions repo).',
    'Use our design system and Beni the mascot, add a settings panel and dashboard tile if useful, run the checks.'
  ];
  return parts.filter(Boolean).join(' ');
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Quote a string for a POSIX shell: 'it'"'"'s' style. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/** The command the terminal types: start Claude Code with the prompt as its first message. */
export const claudeCommand = (prompt: string): string => `claude ${shellQuote(oneLine(prompt))}`;

/** sessionStorage key: "Extend the system" leaves a task here for the terminal page. */
export const PENDING_PROMPT_KEY = 'terminal.pendingPrompt';

/** What the terminal runs for "Extend the system": a request to an AI CLI, or a plain command. */
export interface PendingTask {
  tool: 'claude' | 'codex' | 'shell';
  text: string;
  title: string;
  /** Claude: continue the last conversation in the repo (`claude -c`) instead of a new one. */
  resume?: boolean;
  /** Extensions installed when the task was started: the terminal page links the new one when it appears. */
  before?: string[];
}

/** Stored as JSON; a plain string (older pages) is a request for Claude. */
export function parsePending(raw: string | null): PendingTask | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Partial<PendingTask>;
    if (t && typeof t.text === 'string' && ['claude', 'codex', 'shell'].includes(t.tool ?? ''))
      return {
        tool: t.tool as PendingTask['tool'],
        text: t.text,
        title: typeof t.title === 'string' ? t.title : 'Ready',
        ...(t.resume === true ? { resume: true } : {}),
        ...(Array.isArray(t.before) ? { before: t.before.filter((x) => typeof x === 'string') } : {})
      };
  } catch {
    /* not JSON: an older plain prompt */
  }
  return { tool: 'claude', text: raw, title: 'Ready to build your app' };
}

/** The command line the terminal types for a task. */
export function pendingCommand(t: PendingTask): string {
  if (t.tool === 'shell') return oneLine(t.text);
  return `${t.tool}${t.tool === 'claude' && t.resume ? ' -c' : ''} ${shellQuote(oneLine(t.text))}`;
}

/** Install ready-made extensions from the extensions repo (the same CLI Claude uses). */
export const installCommand = (id: string): string => `node scripts/ext.mjs install ${id}`;

/** The request for building an extension from one of the extensions repo's inspirations. */
export const inspirationPrompt = (i: { id: string; idea: string; scope: Scope }, extra = ''): string =>
  buildPrompt({ idea: [i.idea, extra].filter((s) => s.trim()).join(' '), scope: i.scope, template: i.id, from: `inspiration:${i.id}` });

/** The prompt for changing an installed extension (its panel's "Ask Claude to change it"). */
export function buildChangePrompt(id: string, name: string, change: string): string {
  return `Change the ${name} extension (extensions/${id}, new-extension skill): ${oneLine(change).replace(/[.!?]?$/, '.')} Keep our design system and Beni, run the checks.`;
}

/** The first message for a new app described in your own words. */
export function newAppPrompt(text: string): string {
  return `Use the add-extension skill to add a new extension to this assistant: ${oneLine(text).replace(/[.!?]?$/, '.')} Ask me if something important is unclear. Use our design system and Beni the mascot, add settings and a dashboard tile if useful, run the checks.`;
}
