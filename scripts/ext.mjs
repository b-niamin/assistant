#!/usr/bin/env node
/**
 * ext: manage the assistant's extensions (spec 002). Run from the repo root, e.g. in the terminal container.
 * Installed extensions live in extensions/<id>/ (git-ignored in the core repo). Ready-made ones come from
 * the extensions repo (EXTENSIONS_REPO); new ones Claude builds, taking any source only as inspiration
 * (the add-extension skill). Nothing is fetched at runtime, only by these commands.
 *
 *   node scripts/ext.mjs list
 *   node scripts/ext.mjs available                       what the extensions repo offers
 *   node scripts/ext.mjs install <id>... [--ref <branch|tag>] [--profiles a,b]
 *   node scripts/ext.mjs update <id>... [--ref <branch|tag>]   replace with the repo's version (old one to .trash/)
 *   node scripts/ext.mjs check [id] [--languages pl,de]  manifests, imports, route generation, translations
 *   node scripts/ext.mjs languages                       the app's languages and what each extension lacks
 *   node scripts/ext.mjs new <id> [--kind native|onefile] [--scope profile|shared] [--name "..."]
 *                                [--from onefile:<appType>/<variant> | --from inspiration:<name>]
 *                                [--inspired-by <link or note>] [--profiles a,b]
 *   node scripts/ext.mjs profiles <id> [a,b | all]       who sees it (System settings can override)
 *   node scripts/ext.mjs remove <id>                     the folder moves to extensions/.trash/; data stays
 *
 * An extension with a background service (compose.yml) needs ./install.sh on the host once to start it.
 * Plain Node, no dependencies. git is the only external tool (install, update, --from).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extensionsDir,
  generate,
  ID_RE,
  lintExtension,
  lookWarnings,
  translationWarnings,
  toolWarnings,
  readRegistry,
  RESERVED_IDS,
  SHELL_API,
  validateManifest
} from '../apps/web/scripts/extensions-lib.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(REPO, 'scripts', 'ext-templates');
const ONEFILE_REPO = process.env.ONEFILE_APPS_REPO ?? 'https://github.com/b-niamin/onefile-apps';
const EXTENSIONS_REPO = process.env.EXTENSIONS_REPO || 'https://github.com/b-niamin/assistant-extensions';
const DIR = extensionsDir();
const ASSISTANT_URL = (process.env.ASSISTANT_URL || 'http://web:3000').replace(/\/$/, '');
const REGISTRY = path.join(DIR, 'installed.json');

const die = (msg) => {
  console.error(`ext: ${msg}`);
  process.exit(1);
};
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else opts[key] = argv[++i];
    } else pos.push(a);
  }
  return { pos, opts };
}

const loadReg = () => readRegistry(DIR);

/**
 * The languages the app offers (System settings -> Language, spec 007): --languages pl,de, else asked
 * from the running app (the `extensions` tool of its MCP server /mcp, CLAUDE_TOOLS_TOKEN), else null when it
 * cannot be reached.
 */
async function appLanguages(opts = {}) {
  if (typeof opts.languages === 'string') return ['en', ...opts.languages.split(',').map((s) => s.trim()).filter((s) => /^[a-z]{2}$/.test(s))];
  try {
    const res = await fetch(`${ASSISTANT_URL}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CLAUDE_TOOLS_TOKEN ?? ''}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'extensions', arguments: {} } }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const body = (await res.json())?.result?.structuredContent;
    return Array.isArray(body?.languages?.enabled) ? body.languages.enabled : null;
  } catch {
    return null;
  }
}

/** Print what the given extensions lack in the app's languages; returns the warnings. */
async function translationReport(ids, opts) {
  const langs = await appLanguages(opts);
  if (!langs) {
    console.warn(`ext: i18n: could not ask the app (${ASSISTANT_URL}) for its languages; pass --languages pl to check translations`);
    return [];
  }
  const warnings = [];
  for (const id of ids) {
    const root = path.join(DIR, id);
    try {
      const manifest = JSON.parse(readFileSync(path.join(root, 'extension.json'), 'utf8'));
      warnings.push(...translationWarnings(root, manifest, id, langs));
    } catch {
      /* a broken manifest is reported by check itself */
    }
  }
  for (const w of warnings) console.warn(`ext: i18n: ${w}`);
  return warnings;
}
const translateNote = (warnings) => {
  if (warnings.length)
    console.log(
      '     Translate it before handing it over: i18n/<lang>.json for each missing language (add-extension skill,\n' +
        '     "Translate"), then `node scripts/ext.mjs check <id>` must print no i18n: warnings.'
    );
};
/** Never rm -rf: a removed or rejected checkout goes to extensions/.trash/. */
function moveToTrash(id) {
  const dest = path.join(DIR, id);
  if (!existsSync(dest)) return;
  const trash = path.join(DIR, '.trash');
  mkdirSync(trash, { recursive: true });
  renameSync(dest, path.join(trash, `${id}-${Date.now()}`));
}
function saveReg(reg) {
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
}
function entryOf(reg, id) {
  const e = reg.extensions.find((x) => x.id === id);
  if (!e) die(`${id} is not installed`);
  return e;
}
function checkNewId(id) {
  if (!ID_RE.test(id ?? '')) die(`id must be lowercase letters, digits and dashes, starting with a letter: "${id}"`);
  if (RESERVED_IDS.has(id)) die(`id "${id}" is reserved by the shell`);
  if (loadReg().extensions.some((e) => e.id === id)) die(`${id} is already installed`);
  if (existsSync(path.join(DIR, id))) die(`extensions/${id} already exists; pick another id or remove it`);
}
const profilesOpt = (v) => (typeof v === 'string' && v !== 'all' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

function regenerate() {
  // Same generation the web build runs; fails loudly on a bad manifest before anything is committed.
  const { extensions } = generate({ webRoot: path.join(REPO, 'apps', 'web'), dir: DIR });
  return extensions;
}

/** Copy a template folder, replacing {{key}} in every text file. */
function copyTemplate(name, dest, vars) {
  const src = path.join(TEMPLATES, name);
  const visit = (from, to) => {
    for (const f of readdirSync(from)) {
      const a = path.join(from, f);
      const b = path.join(to, f.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k]));
      if (statSync(a).isDirectory()) {
        mkdirSync(b, { recursive: true });
        visit(a, b);
      } else {
        writeFileSync(b, readFileSync(a, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)));
      }
    }
  };
  mkdirSync(dest, { recursive: true });
  visit(src, dest);
}

/** Shallow-clone a source repo into a temp folder (once per run); returns [folder, commit]. */
const fetched = new Map();
function fetchRepo(url, name, ref) {
  const key = `${url}#${ref ?? ''}`;
  if (!fetched.has(key)) {
    const tmp = path.join(os.tmpdir(), `${name}-${process.pid}-${fetched.size}`);
    git(['clone', '--quiet', '--depth', '1', ...(ref ? ['--branch', ref] : []), url, tmp]);
    fetched.set(key, [tmp, git(['rev-parse', 'HEAD'], tmp)]);
  }
  return fetched.get(key);
}
const fetchExtensionsRepo = (ref) => fetchRepo(EXTENSIONS_REPO, 'assistant-extensions', ref);
/** Ready-made extensions: folders under extensions/ in the extensions repo with an extension.json. */
const READY = 'extensions';
const readyMade = (repoDir) =>
  existsSync(path.join(repoDir, READY))
    ? readdirSync(path.join(repoDir, READY)).filter((f) => ID_RE.test(f) && existsSync(path.join(repoDir, READY, f, 'extension.json')))
    : [];

/** Copy extensions-repo/extensions/<id> into extensions/<id> and check its manifest; returns the manifest. */
function copyFromRepo(repoDir, id) {
  const src = path.join(repoDir, READY, id);
  if (!existsSync(path.join(src, 'extension.json')))
    die(`no extension "${id}" in ${EXTENSIONS_REPO}; available: ${readyMade(repoDir).join(', ') || 'none'}`);
  const manifest = JSON.parse(readFileSync(path.join(src, 'extension.json'), 'utf8'));
  const problems = validateManifest(manifest, id);
  if (problems.length) die(`problems:\n  - ${problems.join('\n  - ')}`);
  cpSync(src, path.join(DIR, id), { recursive: true, filter: (f) => path.basename(f) !== '.git' });
  return manifest;
}
const servicesNote = (ids) => {
  const withServices = ids.filter((id) => existsSync(path.join(DIR, id, 'compose.yml')));
  if (withServices.length)
    console.log(`     ${withServices.join(', ')} bring(s) a background service: run ./install.sh on the host to start it`);
};

/** Turn one onefile-apps variant into a onefile extension folder. */
function onefileFromRepo(repoDir, appPath, dest, id, extra = {}) {
  const variantDir = path.join(repoDir, 'apps', appPath);
  const mf = path.join(variantDir, 'manifest.json');
  if (!existsSync(mf)) die(`onefile app ${appPath} not found in ${ONEFILE_REPO}`);
  const app = JSON.parse(readFileSync(mf, 'utf8'));
  mkdirSync(dest, { recursive: true });
  cpSync(path.join(variantDir, app.entry), path.join(dest, 'app.html'));
  for (const f of ['README.md', 'CHANGELOG.md', 'manifest.json']) {
    if (existsSync(path.join(variantDir, f))) cpSync(path.join(variantDir, f), path.join(dest, f === 'manifest.json' ? 'onefile.manifest.json' : f));
  }
  const manifest = {
    id,
    name: extra.name ?? app.name?.en ?? id,
    description: (app.description?.en ?? '').slice(0, 200),
    version: app.version ?? '1.0.0',
    kind: 'onefile',
    scope: extra.scope ?? 'profile',
    shell: SHELL_API,
    entry: 'app.html',
    // onefile-apps name every language they speak ({"en": ..., "pl": ...}): the app's UI has them all.
    languages: app.name && typeof app.name === 'object' ? Object.keys(app.name).filter((l) => /^[a-z]{2}$/.test(l)) : ['en']
  };
  writeFileSync(path.join(dest, 'extension.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Its name and description in those languages, for the shell's menus (spec 007).
  for (const lang of manifest.languages.filter((l) => l !== 'en')) {
    const texts = {};
    if (typeof app.name?.[lang] === 'string' && !extra.name) texts[manifest.name] = app.name[lang];
    if (typeof app.description?.[lang] === 'string' && manifest.description) texts[manifest.description] = app.description[lang].slice(0, 200);
    if (!Object.keys(texts).length) continue;
    mkdirSync(path.join(dest, 'i18n'), { recursive: true });
    writeFileSync(path.join(dest, 'i18n', `${lang}.json`), JSON.stringify(texts, null, 2) + '\n');
  }
}

const commands = {
  available({ opts }) {
    const [repoDir, commit] = fetchExtensionsRepo(typeof opts.ref === 'string' ? opts.ref : undefined);
    const installed = new Set(loadReg().extensions.map((e) => e.id));
    console.log(`${EXTENSIONS_REPO} @ ${commit.slice(0, 7)}`);
    for (const id of readyMade(repoDir)) {
      const m = JSON.parse(readFileSync(path.join(repoDir, READY, id, 'extension.json'), 'utf8'));
      console.log(`${id.padEnd(16)} ${String(m.kind ?? '?').padEnd(8)} ${String(m.version ?? '').padEnd(8)} ${installed.has(id) ? 'installed ' : '          '}${m.name}: ${m.description ?? ''}`);
    }
  },

  async install({ pos, opts }) {
    if (!pos.length) die('install <id>...; see `available`');
    const ref = typeof opts.ref === 'string' ? opts.ref : undefined;
    const [repoDir, commit] = fetchExtensionsRepo(ref);
    const reg = loadReg();
    const done = [];
    for (const id of pos) {
      if (reg.extensions.some((e) => e.id === id)) {
        console.log(`ext: ${id} is already installed (update it with: ext update ${id})`);
        continue;
      }
      checkNewId(id);
      copyFromRepo(repoDir, id);
      reg.extensions.push({
        id,
        from: `${EXTENSIONS_REPO}/tree/${commit}/${READY}/${id}`,
        ...(profilesOpt(opts.profiles) ? { profiles: profilesOpt(opts.profiles) } : {})
      });
      done.push(id);
    }
    saveReg(reg);
    regenerate();
    if (done.length) console.log(`ext: installed ${done.join(', ')} from ${EXTENSIONS_REPO} @ ${commit.slice(0, 7)}`);
    servicesNote(done);
    // Every extension speaks every language of the app (spec 007): name the gaps for Claude to fill.
    translateNote(await translationReport(done, opts));
  },

  async update({ pos, opts }) {
    const reg = loadReg();
    const ids = pos.length ? pos : reg.extensions.filter((e) => e.from?.startsWith(EXTENSIONS_REPO)).map((e) => e.id);
    const [repoDir, commit] = fetchExtensionsRepo(typeof opts.ref === 'string' ? opts.ref : undefined);
    for (const id of ids) {
      const e = entryOf(reg, id);
      moveToTrash(id);
      copyFromRepo(repoDir, id);
      e.from = `${EXTENSIONS_REPO}/tree/${commit}/${READY}/${id}`;
    }
    saveReg(reg);
    regenerate();
    console.log(`ext: updated ${ids.join(', ') || 'nothing'} to ${commit.slice(0, 7)}`);
    servicesNote(ids);
    translateNote(await translationReport(ids, opts));
  },

  list() {
    const reg = loadReg();
    for (const e of reg.extensions) {
      let m = {};
      try {
        m = JSON.parse(readFileSync(path.join(DIR, e.id, 'extension.json'), 'utf8'));
      } catch {
        m = { name: '(extension.json missing)' };
      }
      const who = e.profiles ? e.profiles.join(',') : 'all profiles';
      console.log(`${e.id.padEnd(16)} ${String(m.kind ?? '?').padEnd(8)} ${String(m.scope ?? '?').padEnd(8)} ${String(m.version ?? '').padEnd(8)} ${who.padEnd(14)} ${m.name}${e.inspiredBy ? `  (inspired by ${e.inspiredBy})` : ''}`);
    }
  },

  async check({ pos, opts }) {
    const reg = loadReg();
    const ids = pos.length ? pos : reg.extensions.map((e) => e.id);
    const problems = [];
    const look = [];
    const tools = [];
    for (const id of ids) {
      const root = path.join(DIR, id);
      try {
        const manifest = JSON.parse(readFileSync(path.join(root, 'extension.json'), 'utf8'));
        problems.push(...validateManifest(manifest, id));
        look.push(...lookWarnings(root, manifest, id));
        tools.push(...toolWarnings(root, id));
      } catch (e) {
        problems.push(`${id}: ${e.message}`);
      }
      problems.push(...lintExtension(root, id));
    }
    // Our look is required for every new extension (add-extension skill); older ones only get a warning.
    for (const w of look) console.warn(`ext: look: ${w}`);
    for (const w of tools) console.warn(`ext: tools: ${w}`);
    // Translations into the app's languages: warnings, like the look (spec 007).
    await translationReport(ids, opts);
    try {
      regenerate();
    } catch (e) {
      problems.push(e.message);
    }
    if (problems.length) die(`problems:\n  - ${problems.join('\n  - ')}`);
    console.log(`ext: ${ids.join(', ')} ok`);
  },

  async languages({ opts }) {
    const langs = await appLanguages(opts);
    if (!langs) die(`could not ask the app (${ASSISTANT_URL}) for its languages; is the web container up?`);
    console.log(`languages: ${langs.join(', ')}`);
    const warnings = await translationReport(loadReg().extensions.map((e) => e.id), { languages: langs.filter((l) => l !== 'en').join(',') });
    if (!warnings.length) console.log('ext: every extension speaks every language');
  },

  async new({ pos, opts }) {
    const id = pos[0];
    checkNewId(id);
    const example = typeof opts.from === 'string' ? /^(?:inspiration|example):([a-z0-9-]+)$/.exec(opts.from) : null;
    // Skeletons to start from live in the extensions repo under inspirations/<name> (`example:` = old name).
    const [exRepo, exCommit] = example ? fetchExtensionsRepo() : [];
    const src = example ? path.join(exRepo, 'inspirations', example[1]) : null;
    if (example && !existsSync(path.join(src, 'extension.json'))) die(`no inspirations/${example[1]} in ${EXTENSIONS_REPO}`);
    const ex = example ? JSON.parse(readFileSync(path.join(src, 'extension.json'), 'utf8')) : {};
    const kind = opts.kind ?? ex.kind ?? (opts.from ? 'onefile' : 'native');
    const scope = opts.scope ?? ex.scope ?? 'profile';
    if (!['native', 'onefile'].includes(kind)) die('--kind is native or onefile');
    if (!['profile', 'shared'].includes(scope)) die('--scope is profile or shared');
    const dest = path.join(DIR, id);
    const name = typeof opts.name === 'string' ? opts.name : id.replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());
    let inspiredBy = typeof opts['inspired-by'] === 'string' ? opts['inspired-by'] : undefined;
    if (example) {
      // A starting point copied from inspirations/<name>, renamed to the new id; adapt it from there.
      cpSync(src, dest, { recursive: true });
      const mf = path.join(dest, 'extension.json');
      const m = JSON.parse(readFileSync(mf, 'utf8'));
      writeFileSync(mf, JSON.stringify({ ...m, id, name: opts.name ?? m.name, scope }, null, 2) + '\n');
      inspiredBy ??= `${EXTENSIONS_REPO}/tree/${exCommit}/inspirations/${example[1]}`;
    } else if (typeof opts.from === 'string') {
      const m = /^onefile:(.+\/.+)$/.exec(opts.from);
      if (!m) die('--from takes onefile:<appType>/<variant> or inspiration:<name>');
      const [tmp, commit] = fetchRepo(ONEFILE_REPO, 'onefile-apps');
      onefileFromRepo(tmp, m[1], dest, id, { name: opts.name, scope });
      copyTemplate('onefile-docs', dest, { id, name, scope });
      inspiredBy ??= `${ONEFILE_REPO}/tree/${commit}/apps/${m[1]}`;
    } else {
      const schema = id.replace(/-/g, '_');
      const profileCol =
        scope === 'profile'
          ? `  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,\n`
          : '';
      copyTemplate(kind, dest, { id, name, scope, schema, profileCol, shell: String(SHELL_API) });
    }
    const reg = loadReg();
    reg.extensions.push({
      id,
      ...(inspiredBy ? { inspiredBy } : {}),
      ...(profilesOpt(opts.profiles) ? { profiles: profilesOpt(opts.profiles) } : {})
    });
    saveReg(reg);
    regenerate();
    console.log(`ext: created extensions/${id} (${kind}, ${scope}); build it, then check it with: ext check ${id}`);
    const langs = (await appLanguages(opts))?.filter((l) => l !== 'en') ?? [];
    if (langs.length) console.log(`     the app's languages also include ${langs.join(', ')}: ship i18n/<lang>.json for each (spec 007)`);
    if (kind === 'native') console.log('     its db/migrations apply within ~15 s (ext-migrate service)');
  },

  profiles({ pos }) {
    const reg = loadReg();
    const e = entryOf(reg, pos[0]);
    if (!pos[1]) return console.log(e.profiles ? e.profiles.join(',') : 'all');
    const p = profilesOpt(pos[1]);
    if (p) e.profiles = p;
    else delete e.profiles;
    saveReg(reg);
    regenerate();
  },

  remove({ pos }) {
    const reg = loadReg();
    const e = entryOf(reg, pos[0]);
    reg.extensions = reg.extensions.filter((x) => x !== e);
    saveReg(reg);
    moveToTrash(e.id);
    regenerate();
    console.log(`ext: removed ${e.id}. Its data stays in the database (schema / core.extension_kv).`);
  }
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !commands[cmd]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 22).join('\n').replace(/^ \* ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
try {
  await commands[cmd](parseArgs(rest));
} catch (e) {
  die(e.message ?? String(e));
}
