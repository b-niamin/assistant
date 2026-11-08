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
    expect(lib.validateManifest(manifest({ shell: 2 }), 'notes').join()).toMatch(/"shell"/);
  });
  it('needs an html entry for onefile', () =>
    expect(lib.validateManifest(manifest({ kind: 'onefile' }), 'notes').join()).toMatch(/"entry"/));
  it('accepts declared secret names on native extensions only (spec 004)', () => {
    expect(lib.validateManifest(manifest({ secrets: ['url', 'api_token'] }), 'notes')).toEqual([]);
    expect(lib.validateManifest(manifest({ secrets: ['Bad-Name'] }), 'notes').join()).toMatch(/"secrets"/);
    expect(lib.validateManifest(manifest({ secrets: 'token' }), 'notes').join()).toMatch(/"secrets"/);
    const onefile = manifest({ kind: 'onefile', entry: 'index.html', secrets: ['token'] });
    expect(lib.validateManifest(onefile, 'notes').join()).toMatch(/only native/);
  });
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
      'notes/web/routes/Helper.svelte': '<p></p>'
    });
    const web = mkdtempSync(path.join(os.tmpdir(), 'web-'));
    const first = lib.generate({ webRoot: web, dir });
    expect(first.extensions[0]).toMatchObject({ id: 'notes', href: '/notes', profiles: ['alex'], kind: 'native' });
    const reg = readFileSync(path.join(web, 'src/lib/extensions/generated/registry.ts'), 'utf8');
    expect(reg).toContain('"id": "notes"');
    expect(first.changed).toBe(5); // page, server, registry, tiles and tools maps; Helper.svelte is not a route file
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
  it('accepts the field types and folds old secrets in', () => {
    const settings = [
      { name: 'url', label: 'Address', type: 'text' },
      { name: 'token', label: 'Token', type: 'secret' },
      { name: 'every', label: 'Refresh', type: 'select', options: ['1 min', '5 min'], default: '5 min' },
      { name: 'energy', label: 'Energy', type: 'boolean', default: true }
    ];
    expect(lib.validateManifest({ ...base, settings }, 'home')).toEqual([]);
    expect(lib.settingsOf({ ...base, secrets: ['api_key'] })).toEqual([{ name: 'api_key', label: 'api key', type: 'secret' }]);
  });
  it('rejects bad fields', () => {
    const bad = [
      { name: 'Bad Name', label: 'x', type: 'text' },
      { name: 'pick', label: 'Pick', type: 'select' },
      { name: 'kind', label: 'Kind', type: 'color' }
    ];
    expect(lib.validateManifest({ ...base, settings: bad }, 'home')).toHaveLength(3);
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
