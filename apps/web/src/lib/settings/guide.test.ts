import { describe, expect, it } from 'vitest';
import {
  buildChangePrompt,
  buildPrompt,
  claudeCommand,
  inspirationPrompt,
  installCommand,
  parsePending,
  pendingCommand,
  hueFor,
  IDEAS,
  initials,
  PROFILE_ID_RE,
  shellQuote,
  slugify,
  TEMPLATES,
  uniqueProfileId,
  visibilityAfterAdd
} from './guide';

describe('slugify', () => {
  it('turns names into profile ids', () => {
    expect(slugify('Anna')).toBe('anna');
    expect(slugify('Anna Łucja Żółć')).toBe('anna-lucja-zolc');
    expect(slugify('  Kid #2 ')).toBe('kid-2');
    expect(slugify('42')).toBe('');
    expect(slugify('x'.repeat(50))).toHaveLength(32);
  });
  it('always yields a valid id or nothing', () => {
    for (const n of ['Ö', '-a-', 'a--b', '9lives', 'Zoë & Co']) {
      const s = slugify(n);
      if (s) expect(PROFILE_ID_RE.test(s)).toBe(true);
    }
  });
});

describe('uniqueProfileId', () => {
  it('adds a number when taken', () => {
    expect(uniqueProfileId('Anna', [])).toBe('anna');
    expect(uniqueProfileId('Anna', ['anna'])).toBe('anna-2');
    expect(uniqueProfileId('Anna', ['anna', 'anna-2'])).toBe('anna-3');
    expect(uniqueProfileId('123', [])).toBe('profile');
    expect(uniqueProfileId('x'.repeat(40), ['x'.repeat(32)]).length).toBeLessThanOrEqual(32);
  });
});

describe('initials and hue', () => {
  it('works for one and many words', () => {
    expect(initials('alex')).toBe('A');
    expect(initials('Anna Maria Nowak')).toBe('AN');
    expect(initials(' ')).toBe('?');
  });
  it('is stable', () => {
    expect(hueFor('alex')).toBe(hueFor('alex'));
    expect(hueFor('alex')).toMatch(/^var\(--hue-/);
  });
});

describe('visibilityAfterAdd', () => {
  const exts = [
    { id: 'health', profiles: null },
    { id: 'gym', profiles: ['alex'] },
    { id: 'home', profiles: null }
  ];
  it('opts out of everyone-apps by listing the others, opts in to restricted ones', () => {
    expect(visibilityAfterAdd(exts, ['alex', 'anna'], 'anna', new Set(['health', 'gym']))).toEqual([
      { id: 'gym', profiles: ['alex', 'anna'] },
      { id: 'home', profiles: ['alex'] }
    ]);
  });
  it('changes nothing when the defaults are kept', () => {
    expect(visibilityAfterAdd(exts, ['alex', 'anna'], 'anna', new Set(['health', 'home']))).toEqual([]);
  });
});

describe('add-extension prompt', () => {
  it('names the skill, the scope and the starting point', () => {
    const p = buildPrompt({ idea: 'Show my\nHome Assistant rooms', inspiration: 'https://github.com/x/y', scope: 'shared', template: 'home-assistant' });
    expect(p).toContain('add-extension skill');
    expect(p).toContain('Show my Home Assistant rooms.');
    expect(p).toContain('https://github.com/x/y as inspiration only');
    expect(p).toContain('scope shared');
    expect(p).toContain('inspiration:home-assistant');
    expect(p).not.toContain('\n');
  });
  it('lets Claude pick by default', () => {
    expect(buildPrompt({ idea: '', scope: 'profile', template: 'nope' })).toContain('Pick the kind');
  });
  it('every inspiration template names one and every idea has a template', () => {
    // They live in the extensions repo (inspirations/<name>); `ext new --from inspiration:<name>` fetches them.
    for (const t of TEMPLATES) if (t.from?.startsWith('inspiration:')) expect(t.from).toMatch(/^inspiration:[a-z][a-z0-9-]*$/);
    for (const i of IDEAS) expect(TEMPLATES.map((t) => t.id)).toContain(i.template);
  });
});

describe('shell quoting', () => {
  it('survives quotes and substitutions', () => {
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
    expect(claudeCommand('a $(rm -rf /) `x`\nb')).toBe("claude 'a $(rm -rf /) `x` b'");
  });
});

describe('change prompt', () => {
  it('names the extension folder', () => {
    expect(buildChangePrompt('gym', 'Gym', 'add a rest timer')).toBe(
      'Change the Gym extension (extensions/gym, new-extension skill): add a rest timer. Keep our design system and Beni, run the checks.'
    );
  });
});

describe('pending tasks for the terminal', () => {
  it('reads JSON tasks and older plain prompts', () => {
    expect(parsePending(JSON.stringify({ tool: 'shell', text: 'node scripts/ext.mjs install gym', title: 'Install' })))
      .toEqual({ tool: 'shell', text: 'node scripts/ext.mjs install gym', title: 'Install' });
    expect(parsePending('build me a thing')?.tool).toBe('claude');
    expect(parsePending(null)).toBeNull();
  });
  it('quotes AI requests and runs install commands as they are', () => {
    expect(pendingCommand({ tool: 'codex', text: "it's", title: '' })).toBe(`codex 'it'"'"'s'`);
    expect(pendingCommand({ tool: 'shell', text: installCommand('gym'), title: '' })).toBe('node scripts/ext.mjs install gym');
    expect(pendingCommand({ tool: 'claude', text: 'more', title: '', resume: true })).toBe("claude -c 'more'");
  });
  it('builds an inspiration request from the catalog', () => {
    const p = inspirationPrompt({ id: 'calendar', idea: 'A family calendar.', scope: 'shared' });
    expect(p).toContain('inspiration:calendar');
    expect(p).toContain('scope shared');
  });
});
