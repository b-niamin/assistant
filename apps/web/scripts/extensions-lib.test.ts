import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import * as lib from './extensions-lib.mjs';
import { ACCESSORY_IDS } from '../src/lib/beni-accessories';

const manifest = (over = {}) => ({
  id: 'notes',
  name: 'Notes',
  description: 'Short notes',
  version: '0.1.0',
  kind: 'native',
  scope: 'profile',
  shell: 1,
  ...over
});

function fixture(entries: object[], files: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ext-'));
  writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ extensions: entries }));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

describe('manifest validation', () => {
  it('accepts a good manifest', () => expect(lib.validateManifest(manifest(), 'notes')).toEqual([]));
  it('rejects reserved ids, a dir mismatch, bad kind/scope and another shell API', () => {
    expect(lib.validateManifest(manifest({ id: 'login' }), 'login').join()).toMatch(/reserved/);
    expect(lib.validateManifest(manifest(), 'other').join()).toMatch(/"id"/);
    expect(lib.validateManifest(manifest({ kind: 'plugin' }), 'notes').join()).toMatch(/"kind"/);
    expect(lib.validateManifest(manifest({ scope: 'user' }), 'notes').join()).toMatch(/"scope"/);
    expect(lib.validateManifest(manifest({ shell: lib.SHELL_API + 1 }), 'notes').join()).toMatch(/update the assistant first/);
    expect(lib.validateManifest(manifest({ shell: 0 }), 'notes').join()).toMatch(/"shell"/);
    expect(lib.validateManifest(manifest({ shell: 1 }), 'notes')).toEqual([]);
  });
  it('needs an html entry for onefile', () =>
    expect(lib.validateManifest(manifest({ kind: 'onefile' }), 'notes').join()).toMatch(/"entry"/));
  it('wants secrets as settings fields (spec 004)', () =>
    expect(lib.validateManifest(manifest({ secrets: ['token'] }), 'notes').join()).toMatch(/"type": "secret"/));
  it('checks what Beni wears against the drawings the shell has', () => {
    expect(lib.ACCESSORIES).toEqual([...ACCESSORY_IDS]);
    expect(lib.validateManifest(manifest({ accessory: 'book' }), 'notes')).toEqual([]);
    expect(lib.validateManifest(manifest({ accessory: 'cape' }), 'notes').join()).toMatch(/"accessory"/);
    expect(lib.infoOf({ entry: { id: 'notes' }, manifest: manifest({ accessory: 'pencil' }), root: null }).accessory).toBe('pencil');
  });
});

describe('stubs', () => {
  it('wraps server exports with the extension context and passes config through', () => {
    const src = `export const load = async () => ({});\nexport const actions = {};\nexport const prerender = false;`;
    const stub = lib.stubFor('notes', 'x/[id]/+page.server.ts', src);
    expect(stub).toContain(`import * as m from '$extensions/notes/web/routes/x/[id]/+page.server';`);
    expect(stub).toContain(`export const load = bind.load('notes', m.load);`);
    expect(stub).toContain(`export const actions = bind.actions('notes', m.actions);`);
    expect(stub).toContain(`export { prerender } from`);
  });
  it('wraps +server.ts handlers', () => {
    const stub = lib.stubFor('notes', 'api/+server.ts', 'export async function GET() {}\nexport const POST = () => 1;');
    expect(stub).toContain(`export const GET = bind.handler('notes', m.GET);`);
    expect(stub).toContain(`export const POST = bind.handler('notes', m.POST);`);
  });
  it('renders svelte components with all props', () =>
    expect(lib.stubFor('notes', '+page.svelte', '')).toContain(`<Component {...props} />`));
});

describe('generate', () => {
  it('generates routes and the registry, and is idempotent', () => {
    const dir = fixture([{ id: 'notes', profiles: ['alex'] }], {
      'notes/extension.json': JSON.stringify(manifest()),
      'notes/web/routes/+page.svelte': '<h1>x</h1>',
      'notes/web/routes/+page.server.ts': 'export const load = () => ({});',
      'notes/web/routes/Helper.svelte': '<p></p>',
      'notes/web/calendar.server.ts': 'export const calendar = { entries: () => [] };'
    });
    const web = mkdtempSync(path.join(os.tmpdir(), 'web-'));
    const first = lib.generate({ webRoot: web, dir });
    expect(first.extensions[0]).toMatchObject({ id: 'notes', href: '/notes', profiles: ['alex'], kind: 'native' });
    const reg = readFileSync(path.join(web, 'src/lib/extensions/generated/registry.ts'), 'utf8');
    expect(reg).toContain('"id": "notes"');
    expect(first.changed).toBe(8); // page, server, registry, tiles, sources, tools, calendar and i18n maps; Helper.svelte is not a route file
    expect(readFileSync(path.join(web, 'src/lib/extensions/generated/calendar.server.ts'), 'utf8')).toContain(
      `"notes": () => import('$extensions/notes/web/calendar.server'),`
    );
    expect(lib.generate({ webRoot: web, dir }).changed).toBe(0);
  });
  it('fails on a missing extension folder and on a bad `from`', () => {
    expect(() => lib.generate({ webRoot: os.tmpdir(), dir: fixture([{ id: 'health' }], {}) })).toThrow(/missing/);
    expect(lib.validateEntry({ id: 'gym', from: 42 }).join()).toMatch(/from must be a link/);
    expect(lib.validateEntry({ id: 'gym', from: 'https://github.com/b-niamin/assistant-extensions/tree/abc/gym' })).toEqual([]);
    expect(lib.validateEntry({ id: 'gym', inspiredBy: 'https://github.com/b-niamin/onefile-apps' })).toEqual([]);
  });
  it('fails without the extensions folder (web container without the mount)', () =>
    expect(() => lib.readRegistry(path.join(os.tmpdir(), 'nope-' + Date.now()))).toThrow(/mounted/));
  it('treats a missing installed.json as no extensions (fresh checkout)', () =>
    expect(lib.readRegistry(mkdtempSync(path.join(os.tmpdir(), 'ext-empty-')))).toEqual({ extensions: [] }));
});

describe('settings fields', () => {
  const base = { id: 'home', name: 'Home', description: '', version: '1.0.0', kind: 'native', scope: 'shared', shell: lib.SHELL_API };
  it('accepts the field types', () => {
    const settings = [
      { name: 'url', label: 'Address', type: 'text' },
      { name: 'token', label: 'Token', type: 'secret' },
      { name: 'every', label: 'Refresh', type: 'select', options: ['1 min', '5 min'], default: '5 min' },
      { name: 'energy', label: 'Energy', type: 'boolean', default: true },
      { name: 'links', label: 'Links', type: 'secret', multiple: true }
    ];
    expect(lib.validateManifest({ ...base, settings }, 'home')).toEqual([]);
  });
  it('rejects bad fields', () => {
    const bad = [
      { name: 'Bad Name', label: 'x', type: 'text' },
      { name: 'pick', label: 'Pick', type: 'select' },
      { name: 'kind', label: 'Kind', type: 'color' },
      { name: 'many', label: 'Many', type: 'text', multiple: true }
    ];
    expect(lib.validateManifest({ ...base, settings: bad }, 'home')).toHaveLength(4);
    expect(lib.validateManifest({ ...base, kind: 'onefile', entry: 'app.html', settings: [{ name: 't', label: 'T', type: 'secret' }] }, 'home').join()).toMatch(/only native/);
  });
});

describe('lint', () => {
  it('allows the SDK and own files, flags shell internals and other extensions', () => {
    const dir = fixture([], {
      'notes/web/routes/+page.server.ts': `import { fail } from '$shell';\nimport x from '../lib/x';\nimport { db } from '$lib/server/db';\nimport { session } from '#lib/server/session.ts';\nimport y from '../../../health/web/lib/y';`
    });
    const problems = lib.lintExtension(path.join(dir, 'notes'), 'notes');
    expect(problems).toHaveLength(3);
    expect(problems.join()).toMatch(/\$lib\/server\/db/);
    expect(problems.join()).toMatch(/#lib\/server\/session/);
    expect(problems.join()).toMatch(/outside the extension/);
  });
});

describe('tools contract', () => {
  it('warns about a missing tools file, overview, or undeclared reads', () => {
    const dir = fixture([], {
      'good/web/tools.server.ts': `export const tools = [{ name: 'overview', readOnly: true, description: 'x', run: () => 1 }];`,
      'half/web/tools.server.ts': `export const tools = [{ name: 'log_set', description: 'x', run: () => 1 }];`,
      'none/extension.json': '{}'
    });
    expect(lib.toolWarnings(path.join(dir, 'good'), 'good')).toEqual([]);
    expect(lib.toolWarnings(path.join(dir, 'half'), 'half').join()).toMatch(/no `overview`.*readOnly/);
    expect(lib.toolWarnings(path.join(dir, 'none'), 'none').join()).toMatch(/no web\/tools.server.ts/);
  });
});

describe('tile codegen', () => {
  it('maps only native extensions that ship web/tiles.server.ts', () => {
    const dir = fixture(
      [{ id: 'notes' }, { id: 'bare' }],
      {
        'notes/extension.json': JSON.stringify(manifest()),
        'notes/web/routes/+page.svelte': '<h1>x</h1>',
        'notes/web/tiles.server.ts': 'export const tiles = [];',
        'bare/extension.json': JSON.stringify(manifest({ id: 'bare', name: 'Bare' })),
        'bare/web/routes/+page.svelte': '<h1>x</h1>'
      }
    );
    const out: Record<string, string> = {};
    const ids = lib.generateTiles({ webRoot: '/w', exts: lib.loadExtensions(dir), emit: (f: string, c: string) => (out[f] = c) });
    expect(ids).toEqual(['notes']);
    const src = out['/w/src/lib/extensions/generated/tiles.server.ts'];
    expect(src).toContain(`"notes": () => import('$extensions/notes/web/tiles.server')`);
    expect(src).not.toContain('bare');
  });
});

describe('look', () => {
  const ext = (files: Record<string, string>) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'look-'));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
    return root;
  };

  it('asks a native extension for Beni and tokens, not hex', () => {
    const bare = ext({ 'web/routes/+page.svelte': '<h1 style="color:#123456">Hi</h1>' });
    expect(lib.lookWarnings(bare, { kind: 'native' }, 'x')).toEqual([
      expect.stringMatching(/Beni is missing/),
      expect.stringMatching(/raw hex/)
    ]);
    const ours = ext({
      'web/routes/+page.svelte': "<script>import { Mascot, countUp } from '$shell/ui';</script><Mascot /><p style=\"color: var(--ink)\">Hi</p>"
    });
    expect(lib.lookWarnings(ours, { kind: 'native' }, 'x')).toEqual([]);
  });

  it('asks a onefile app for <assistant-beni> and the shell tokens', () => {
    const bare = ext({ 'app.html': '<style>body{color:#000}</style>' });
    expect(lib.lookWarnings(bare, { kind: 'onefile', entry: 'app.html' }, 'x')).toHaveLength(2);
    const ours = ext({ 'app.html': '<style>body{background:var(--page,#fff)}</style><assistant-beni mood="idle"></assistant-beni>' });
    expect(lib.lookWarnings(ours, { kind: 'onefile', entry: 'app.html' }, 'x')).toEqual([]);
  });
});

describe('translations (spec 007)', () => {
  it('reads i18n/<lang>.json, inlines them and lists the languages', () => {
    const dir = fixture([{ id: 'notes' }], {
      'notes/extension.json': JSON.stringify(manifest()),
      'notes/web/routes/+page.svelte': "<h1>{t('Notes')}</h1>",
      'notes/i18n/pl.json': JSON.stringify({ Notes: 'Notatki', '{n} notes': { one: '{n} notatka', other: '{n} notatki' } })
    });
    const web = mkdtempSync(path.join(os.tmpdir(), 'web-'));
    const { extensions } = lib.generate({ webRoot: web, dir });
    expect(extensions[0].languages).toEqual(['en', 'pl']);
    const gen = readFileSync(path.join(web, 'src/lib/extensions/generated/i18n.ts'), 'utf8');
    expect(gen).toContain('"Notes": "Notatki"');
    // The page stub tells useT() which extension it belongs to.
    expect(readFileSync(path.join(web, 'src/routes/(extensions)/notes/+page.svelte'), 'utf8')).toContain("provideExtension('notes')");
  });
  it('rejects a bad translation file', () => {
    const dir = fixture([{ id: 'notes' }], {
      'notes/extension.json': JSON.stringify(manifest()),
      'notes/web/routes/+page.svelte': '<h1>x</h1>',
      'notes/i18n/pl.json': JSON.stringify({ Notes: 3 })
    });
    expect(() => lib.generate({ webRoot: mkdtempSync(path.join(os.tmpdir(), 'web-')), dir })).toThrow(/must be a string/);
  });
  it('finds the texts of t(), t.n() and tile titles, not those in comments', () => {
    const src = `/** t('In a comment') */ const a = t('Save'); t("It's {n}", { n }); t.n(count, '{n} set', '{n} sets'); x.t('no'); title: 'Sleep'`;
    expect(lib.keysIn(src)).toEqual(['Save', "It's {n}", '{n} sets']);
    expect(lib.keysIn(src, { titles: true })).toContain('Sleep');
  });
  it('warns about missing files and texts, and a onefile UI without the language', () => {
    const dir = fixture([], {
      'notes/web/routes/+page.svelte': "{t('Notes')} {t('Add')}",
      'notes/i18n/pl.json': JSON.stringify({ Notes: 'Notatki' })
    });
    const w = lib.translationWarnings(path.join(dir, 'notes'), manifest(), 'notes', ['en', 'pl', 'de']);
    // "Add" is one of the shell's own words: no entry needed.
    expect(w.join('\n')).toMatch(/pl\.json misses 1 text\(s\): "Short notes"$/m);
    expect(w.join('\n')).toMatch(/no i18n\/de\.json \(3 texts/);
    const app = manifest({ kind: 'onefile', entry: 'app.html', languages: ['en'] });
    expect(lib.translationWarnings(path.join(dir, 'notes'), app, 'notes', ['en', 'pl']).join()).toMatch(/UI is not in "pl"/);
  });
  it('validates "languages" in the manifest', () => {
    expect(lib.validateManifest(manifest({ languages: ['en', 'pl'] }), 'notes')).toEqual([]);
    expect(lib.validateManifest(manifest({ languages: ['polish'] }), 'notes').join()).toMatch(/"languages"/);
  });
});

describe('background work for the worker', () => {
  const root = () => fixture([], { 'notes/services/sync/main.py': '' }) + '/notes';
  const service = (over = {}) => ({ name: 'sync', run: ['python', 'main.py'], ...over });

  it('accepts services and jobs, and names of compose services', () => {
    const m = manifest({
      services: [service({ host: ['proc', 'sys'], keys: ['TOKEN_ENCRYPTION_KEY'], env: { INTERVAL: '30' } }), 'old-sync'],
      jobs: [
        { name: 'prune', dir: 'services/sync', run: ['python', 'main.py', 'prune'], cron: '15 3 * * 1-5' },
        { name: 'ping', dir: 'services/sync', run: ['true'], every: '5m', timeout: '30s' }
      ]
    });
    expect(lib.validateManifest(m, 'notes', root())).toEqual([]);
    // Without the folder (the shell's own build) only the manifest's own fields are checked.
    expect(lib.validateManifest(manifest({ services: [service({ host: ['docker'] })] }), 'notes')).toEqual([]);
  });

  it('refuses what the worker does not open or set', () => {
    const problems = (u: object, key = 'services') => lib.workerProblems({ [key]: [u] }, 'notes', root()).join('\n');
    expect(problems(service({ host: ['proc', 'docker.sock'] }))).toMatch(/host may only list/);
    expect(problems(service({ keys: ['POSTGRES_PASSWORD'] }))).toMatch(/keys may only list/);
    expect(problems(service({ env: { DATABASE_URL: 'x' } }))).toMatch(/env maps/);
    expect(problems(service({ dir: '../../etc' }))).toMatch(/inside the extension/);
    expect(problems(service({ dir: 'services/none' }))).toMatch(/no folder/);
    expect(problems(service({ privileged: true }))).toMatch(/unknown field "privileged"/);
    expect(problems(service({ every: '5m' }))).toMatch(/runs all the time/);
    expect(problems(service({ run: 'python main.py' }))).toMatch(/run must be a list/);
    expect(problems({ name: 'j', dir: 'services/sync', run: ['true'] }, 'jobs')).toMatch(/either "every"/);
    expect(problems({ name: 'j', dir: 'services/sync', run: ['true'], every: '5s' }, 'jobs')).toMatch(/at least 10s/);
    expect(problems({ name: 'j', dir: 'services/sync', run: ['true'], cron: '61 * * * *' }, 'jobs')).toMatch(/outside 0-59/);
    expect(problems({ name: 'j', dir: 'services/sync', run: ['true'], every: '1h', timeout: '7h' }, 'jobs')).toMatch(/at most 6h/);
  });

  it('opens what docker/worker/access.json opens', () => {
    const access = JSON.parse(readFileSync(path.join(lib.WEB_ROOT, '../../docker/worker/access.json'), 'utf8'));
    expect(Object.keys(access.host)).toEqual(lib.WORKER_HOST);
    expect(Object.keys(access.keys)).toEqual(lib.WORKER_KEYS);
  });

  it('reads cron lines and durations like the worker', () => {
    expect(['* * * * *', '*/15 2-4 1,15 * 0-6', '0 9 * * 7'].map(lib.cronProblem)).toEqual([null, null, null]);
    expect(lib.cronProblem('* * * *')).toMatch(/five fields/);
    expect(lib.cronProblem('*/0 * * * *')).toMatch(/outside/);
    expect(['30s', '5m', '2h', '1d', '5', 5].map(lib.durationSeconds)).toEqual([30, 300, 7200, 86400, null, null]);
  });
});

describe('bareHovers', () => {
  it('counts hover rules outside a hover media query', () => {
    const page = (css: string) => `<p>x</p><style>${css}</style>`;
    expect(lib.bareHovers(page('a:hover { color: red; } b { color: blue; }'))).toBe(1);
    expect(lib.bareHovers(page('@media (hover: hover) { a:hover { color: red; } }'))).toBe(0);
    expect(lib.bareHovers(page('@media (prefers-reduced-motion: no-preference) { @media (hover: hover) { a:hover, b:hover { x: y; } } c:hover { x: y; } }'))).toBe(1);
  });
});

describe('worker units', () => {
  it('give the same verdicts as docker/worker/worker.py (unit-cases.json)', () => {
    const cases = JSON.parse(readFileSync(new URL('../../../docker/worker/unit-cases.json', import.meta.url), 'utf8')).cases;
    for (const c of cases) {
      const root = mkdtempSync(path.join(os.tmpdir(), 'units-'));
      const dir = typeof c.unit.dir === 'string' && !/^(\/|\.\.)/.test(c.unit.dir) ? c.unit.dir : `services/${c.unit.name}`;
      mkdirSync(path.join(root, dir), { recursive: true });
      const problems = lib.workerProblems({ [c.kind === 'job' ? 'jobs' : 'services']: [c.unit] }, 'demo', root);
      expect(problems.length === 0, `${JSON.stringify(c)}: ${problems.join('; ')}`).toBe(c.ok);
    }
  });
});

