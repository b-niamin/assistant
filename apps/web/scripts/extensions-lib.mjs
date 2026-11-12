// @ts-nocheck: plain Node tooling shared with the ext CLI; covered by scripts/extensions-lib.test.ts
/**
 * Extension discovery, validation and route generation for the shell (spec 002).
 *
 * Shared by the web build (`npm run gen`, runs before every build and check) and by the `ext` CLI at
 * the repo root. Plain Node, no dependencies, so it runs in the bare node image of the `web` container.
 *
 * Layout on disk (EXTENSIONS_DIR, default <repo>/extensions, mounted at /extensions in `web`):
 *   installed.json            which extensions are installed, in nav order, and where they came from
 *   <id>/extension.json       the manifest
 *   <id>/web/routes/**        native: SvelteKit route files, mounted at /<id>/**
 *   <id>/<entry>.html         onefile: one self-contained HTML file, run in a sandboxed iframe
 *   <id>/db/migrations/*.sql  optional: applied by db/migrate.sh as "<id>/<file>"
 *   <id>/i18n/<lang>.json     optional: its texts in another language, English text -> translation (spec 007)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Bumped when the contract between the shell and extensions changes incompatibly. */
export const SHELL_API = 1;
/** First path segments the shell owns; an extension id can never take one. */
export const RESERVED_IDS = new Set([
  'api', 'app', 'apps', 'assets', 'dock', 'ext', 'extensions', 'favicon', 'healthz', 'login', 'logout', 'mcp',
  'profile', 'settings', 'setup', 'shell', 'static', 'x', '_app'
]);
export const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KINDS = ['native', 'onefile'];
const SCOPES = ['profile', 'shared'];
const FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'secret'];
/** Route files the generator mirrors from <id>/web/routes into src/routes/(extensions)/<id>. */
const ROUTE_FILES = new Set([
  '+page.svelte', '+page.server.ts', '+page.ts', '+layout.svelte', '+layout.server.ts', '+layout.ts',
  '+server.ts', '+error.svelte'
]);
const SAFE_ROUTE_PATH = /^(?:[A-Za-z0-9_\-()[\]=.+]+\/)*\+[a-z.]+$/;
const SERVER_EXPORTS = ['load', 'actions', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CONFIG_EXPORTS = ['prerender', 'ssr', 'csr', 'trailingSlash'];

export function extensionsDir() {
  return path.resolve(process.env.EXTENSIONS_DIR ?? path.join(WEB_ROOT, '..', '..', 'extensions'));
}

/** DB role an extension's server code runs as (`SET LOCAL ROLE`); also its default schema name. */
export const schemaOf = (id) => id.replace(/-/g, '_');
export const roleOf = (id) => `ext_${schemaOf(id)}`;

export function readRegistry(dir = extensionsDir()) {
  const file = path.join(dir, 'installed.json');
  // A fresh checkout has no installed.json (it is git-ignored, like the installed extensions): nothing on.
  if (!existsSync(file)) {
    if (!existsSync(dir))
      throw new Error(`extensions: ${dir} not found. The web container needs ./extensions mounted at /extensions.`);
    return { extensions: [] };
  }
  const reg = JSON.parse(readFileSync(file, 'utf8'));
  if (!reg || !Array.isArray(reg.extensions)) throw new Error(`extensions: ${file} must be {"extensions": [...]}`);
  return reg;
}

export function validateEntry(e) {
  const errors = [];
  if (!e || typeof e !== 'object') return ['entry must be an object'];
  if (!ID_RE.test(e.id ?? '')) errors.push(`invalid id "${e.id}"`);
  // `from`: where `ext install` copied it from (extensions repo link at a commit). Nothing reads it at runtime.
  if (e.from !== undefined && (typeof e.from !== 'string' || e.from.length > 300))
    errors.push(`${e.id}: from must be a link`);
  if (e.inspiredBy !== undefined && (typeof e.inspiredBy !== 'string' || e.inspiredBy.length > 300))
    errors.push(`${e.id}: inspiredBy must be a link or a short note`);
  if (e.profiles !== undefined && !(Array.isArray(e.profiles) && e.profiles.every((p) => typeof p === 'string')))
    errors.push(`${e.id}: profiles must be a list of profile ids`);
  return errors;
}

/** What Beni can wear (manifest "accessory"); the drawings are in src/lib/beni-accessories.ts. */
export const ACCESSORIES = [
  'none',
  'headband',
  'stethoscope',
  'book',
  'wrench',
  'glasses',
  'headphones',
  'chef-hat',
  'pencil',
  'bulb',
  'coin',
  'umbrella',
  'party-hat',
  'nightcap'
];

/** A secret name: lowercase, digits, underscores, e.g. "api_token". */
export const SECRET_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function validateManifest(m, dirName, root) {
  const errors = [];
  const req = (k, ok) => {
    if (!ok) errors.push(`${dirName}/extension.json: bad or missing "${k}"`);
  };
  if (!m || typeof m !== 'object') return [`${dirName}/extension.json is not an object`];
  req('id', ID_RE.test(m.id ?? '') && m.id === dirName);
  if (RESERVED_IDS.has(m.id)) errors.push(`${dirName}: id "${m.id}" is reserved by the shell`);
  req('name', typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 40);
  req('description', typeof m.description === 'string' && m.description.length <= 200);
  req('version', /^\d+\.\d+\.\d+$/.test(m.version ?? ''));
  req('kind', KINDS.includes(m.kind));
  req('scope', SCOPES.includes(m.scope));
  req('shell', m.shell === SHELL_API);
  // Secrets (spec 004) are settings fields of type "secret", not a list of their own.
  if (m.secrets !== undefined) errors.push(`${dirName}/extension.json: declare secrets as "settings" fields with "type": "secret"`);
  // Its settings panel in System settings (spec 002, "Settings"): fields the shell renders.
  if (m.settings !== undefined) errors.push(...settingsProblems(m.settings, m.kind, dirName));
  // What Beni wears on its pages; left out, the shell guesses from the id and name.
  if (m.accessory !== undefined && !ACCESSORIES.includes(m.accessory))
    errors.push(`${dirName}/extension.json: "accessory" must be one of ${ACCESSORIES.join(', ')}`);
  // Languages a onefile app's own UI speaks (it carries its translations inside the HTML; spec 007).
  if (m.languages !== undefined)
    req('languages', Array.isArray(m.languages) && m.languages.length <= 20 && m.languages.every((l) => LANG_RE.test(l)));
  if (m.kind === 'onefile') req('entry', typeof m.entry === 'string' && /^[A-Za-z0-9._-]+\.html$/.test(m.entry));
  // Background work for the worker: checked by `ext check` and `ext install` (they pass the folder); a slip
  // here never hides the extension's pages, the worker just refuses that unit and says why.
  if (root) errors.push(...workerProblems(m, dirName, root));
  return errors;
}

/**
 * What the worker container opens (docker/worker/access.json, the source of truth; a test keeps the two
 * equal): the host paths a unit may ask for ("host") and the worker-held values it may get ("keys").
 */
export const WORKER_HOST = ['proc', 'sys'];
export const WORKER_KEYS = ['TOKEN_ENCRYPTION_KEY', 'DEFAULT_PROFILE'];
const UNIT_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const WORKER_ENV = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TZ', 'DATABASE_URL', 'WORKER_DATA', 'EXT_ID', 'EXT_UNIT',
  'PYTHONUNBUFFERED', 'PYTHONDONTWRITEBYTECODE', 'HOST_PROC', 'HOST_SYS', ...WORKER_KEYS]);
const UNIT_FIELDS = new Set(['name', 'run', 'dir', 'host', 'keys', 'env', 'description', 'every', 'cron', 'timeout']);
const CRON_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

/** "30s", "5m", "2h", "1d" -> seconds (null when it is not one). */
export function durationSeconds(text) {
  const m = typeof text === 'string' ? /^(\d{1,5})([smhd])$/.exec(text) : null;
  return m ? Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : null;
}

/** Problems with a five-field cron line (the worker's dialect: *, n, a-b, *\/n, a-b/n, lists). */
export function cronProblem(text) {
  const parts = typeof text === 'string' ? text.trim().split(/\s+/) : [];
  if (parts.length !== 5) return 'a cron schedule has five fields: minute hour day month weekday';
  for (let i = 0; i < 5; i++) {
    const [lo, hi] = CRON_RANGES[i];
    for (const p of parts[i].split(',')) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(p);
      if (!m) return `cannot read '${p}'`;
      const [a, b] = m[1] === '*' ? [lo, hi] : m[1].includes('-') ? m[1].split('-').map(Number) : [Number(m[1]), m[2] ? hi : Number(m[1])];
      if (!(lo <= a && a <= b && b <= hi) || (m[2] !== undefined && Number(m[2]) < 1)) return `'${p}' is outside ${lo}-${hi}`;
    }
  }
  return null;
}

/**
 * Problems with a manifest's "services" and "jobs" for the worker (spec 002, "Background work"): the same
 * rules docker/worker/worker.py applies. Plain names in "services" are the older way (a compose.yml).
 */
export function workerProblems(m, dirName, root) {
  const errors = [];
  const names = new Set();
  for (const [key, kind] of [['services', 'service'], ['jobs', 'job']]) {
    const list = m[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${dirName}/extension.json: "${key}" must be a list`);
      continue;
    }
    for (const u of list) {
      if (kind === 'service' && typeof u === 'string') continue;
      const where = `${dirName}/extension.json: ${kind} "${u?.name}"`;
      if (!u || typeof u !== 'object' || Array.isArray(u)) {
        errors.push(`${dirName}/extension.json: every ${kind} is an object {"name", "run", ...}`);
        continue;
      }
      if (!UNIT_NAME_RE.test(u.name ?? '')) errors.push(`${where}: name must match ${UNIT_NAME_RE}`);
      else if (names.has(u.name)) errors.push(`${where}: two services or jobs have this name`);
      names.add(u.name);
      if (!(Array.isArray(u.run) && u.run.length && u.run.length <= 40 && u.run.every((a) => typeof a === 'string' && a && a.length <= 500)))
        errors.push(`${where}: run must be a list of strings, the command and its arguments`);
      const dir = u.dir ?? `services/${u.name}`;
      const abs = typeof dir === 'string' ? path.resolve(root, dir) : '';
      if (typeof dir !== 'string' || path.isAbsolute(dir) || !abs.startsWith(path.resolve(root) + path.sep))
        errors.push(`${where}: dir must be a folder inside the extension`);
      else if (!existsSync(abs) || !statSync(abs).isDirectory()) errors.push(`${where}: no folder ${dir}`);
      if (u.host !== undefined && !(Array.isArray(u.host) && u.host.every((h) => WORKER_HOST.includes(h))))
        errors.push(`${where}: host may only list what the worker opens (${WORKER_HOST.join(', ')}); anything else needs a change to the worker in the core`);
      if (u.keys !== undefined && !(Array.isArray(u.keys) && u.keys.every((k) => WORKER_KEYS.includes(k))))
        errors.push(`${where}: keys may only list ${WORKER_KEYS.join(', ')}`);
      if (u.env !== undefined) {
        const ok = u.env && typeof u.env === 'object' && !Array.isArray(u.env) && Object.keys(u.env).length <= 30 &&
          Object.entries(u.env).every(([k, v]) => ENV_RE.test(k) && !WORKER_ENV.has(k) && typeof v === 'string' && v.length <= 500);
        if (!ok) errors.push(`${where}: env maps NAMES to strings, without the names the worker sets (${[...WORKER_ENV].join(', ')})`);
      }
      if (u.description !== undefined && (typeof u.description !== 'string' || u.description.length > 160))
        errors.push(`${where}: description is at most 160 characters`);
      for (const k of Object.keys(u)) if (!UNIT_FIELDS.has(k)) errors.push(`${where}: unknown field "${k}" (the worker decides how a unit runs)`);
      if (kind === 'job') {
        if ((u.every === undefined) === (u.cron === undefined)) errors.push(`${where}: a job has either "every" (30s, 5m, 2h, 1d) or "cron" (five fields)`);
        else if (u.every !== undefined && !(durationSeconds(u.every) >= 10)) errors.push(`${where}: every must be like 30s, 5m, 2h or 1d, at least 10s`);
        else if (u.cron !== undefined && cronProblem(u.cron)) errors.push(`${where}: cron: ${cronProblem(u.cron)}`);
        const t = durationSeconds(u.timeout ?? '10m');
        if (!t || t > 6 * 3600) errors.push(`${where}: timeout must be like 30s, 10m or 2h, at most 6h`);
      } else {
        for (const k of ['every', 'cron', 'timeout']) if (u[k] !== undefined) errors.push(`${where}: a service runs all the time; "${k}" is for jobs`);
      }
    }
  }
  return errors;
}

/** Problems with a manifest's "settings" list (fields of the extension's settings panel). */
export function settingsProblems(list, kind, dirName) {
  if (!Array.isArray(list) || list.length > 30) return [`${dirName}/extension.json: "settings" must be a list of at most 30 fields`];
  const errors = [];
  const seen = new Set();
  for (const f of list) {
    const where = `${dirName}/extension.json: setting "${f?.name}"`;
    if (!f || typeof f !== 'object' || !SECRET_RE.test(f.name ?? '')) {
      errors.push(`${where}: name must match ${SECRET_RE}`);
      continue;
    }
    if (seen.has(f.name)) errors.push(`${where}: defined twice`);
    seen.add(f.name);
    if (!FIELD_TYPES.includes(f.type)) errors.push(`${where}: type must be one of ${FIELD_TYPES.join(', ')}`);
    if (typeof f.label !== 'string' || !f.label || f.label.length > 60) errors.push(`${where}: label (1-60 characters)`);
    if (f.help !== undefined && (typeof f.help !== 'string' || f.help.length > 300)) errors.push(`${where}: help is at most 300 characters`);
    if (f.type === 'select' && !(Array.isArray(f.options) && f.options.length && f.options.every((o) => typeof o === 'string')))
      errors.push(`${where}: a select needs options (a list of strings)`);
    if (f.type === 'secret' && kind !== 'native') errors.push(`${where}: only native extensions can have secrets`);
    if (f.type === 'secret' && f.default !== undefined) errors.push(`${where}: a secret has no default`);
    if (f.multiple !== undefined && (f.multiple !== true || f.type !== 'secret'))
      errors.push(`${where}: "multiple": true is for secrets only (a list of links or keys)`);
  }
  return errors;
}

/** A language code: ISO 639-1, two lowercase letters (en, pl, de, ...). */
export const LANG_RE = /^[a-z]{2}$/;
export const BASE_LANG = 'en';

/**
 * An extension's translations (spec 007): i18n/<lang>.json, each an object of English text -> text in
 * that language, or -> plural forms {"one": ..., "few": ..., "many": ..., "other": ...}. Returns
 * { messages: {lang: {...}}, errors }.
 */
export function readTranslations(root, id) {
  const messages = {};
  const errors = [];
  const dir = root ? path.join(root, 'i18n') : null;
  if (!dir || !existsSync(dir)) return { messages, errors };
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    const lang = f.slice(0, -5);
    if (!LANG_RE.test(lang)) {
      errors.push(`${id}/i18n/${f}: the file name must be a two-letter language code (pl.json)`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      errors.push(`${id}/i18n/${f}: ${e.message}`);
      continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      errors.push(`${id}/i18n/${f}: must be an object of "English text": "translation"`);
      continue;
    }
    const bad = Object.entries(data).filter(
      ([, v]) =>
        typeof v !== 'string' &&
        !(v && typeof v === 'object' && typeof v.other === 'string' && Object.values(v).every((x) => typeof x === 'string'))
    );
    if (bad.length) errors.push(`${id}/i18n/${f}: "${bad[0][0]}" must be a string or plural forms with "other"`);
    else if (lang !== BASE_LANG) messages[lang] = data;
  }
  return { messages, errors };
}

/** Languages an extension speaks: English, plus each i18n/<lang>.json (and, for onefile, its own UI's). */
export function languagesOf(manifest, root, messages = readTranslations(root, manifest.id).messages) {
  const files = Object.keys(messages);
  const own = manifest.kind === 'onefile' ? (Array.isArray(manifest.languages) ? manifest.languages : [BASE_LANG]) : null;
  const all = new Set([BASE_LANG, ...files.filter((l) => !own || own.includes(l))]);
  return [...all].sort((a, b) => (a === BASE_LANG ? -1 : b === BASE_LANG ? 1 : a.localeCompare(b)));
}

/** Settings fields of a manifest. */
export function settingsOf(manifest) {
  return Array.isArray(manifest.settings) ? manifest.settings.map((f) => ({ ...f })) : [];
}

/** Installed extensions in nav order, each with its manifest. Throws on any problem. */
export function loadExtensions(dir = extensionsDir()) {
  const reg = readRegistry(dir);
  const errors = [];
  const warnings = [];
  const out = [];
  const seen = new Set();
  for (const entry of reg.extensions) {
    const entryErrors = validateEntry(entry);
    if (entryErrors.length) {
      errors.push(...entryErrors);
      continue;
    }
    if (seen.has(entry.id)) errors.push(`${entry.id}: installed twice`);
    seen.add(entry.id);
    const root = path.join(dir, entry.id);
    const manifestFile = path.join(root, 'extension.json');
    if (!existsSync(manifestFile)) {
      // Extensions are part of this repo: missing means a broken checkout or mount, so fail the build
      // (the previous build keeps serving).
      errors.push(`${entry.id}: ${manifestFile} missing`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    } catch (e) {
      errors.push(`${entry.id}: extension.json: ${e.message}`);
      continue;
    }
    const mErrors = validateManifest(manifest, entry.id);
    if (manifest.kind === 'native' && !existsSync(path.join(root, 'web', 'routes')))
      mErrors.push(`${entry.id}: native extension without web/routes/`);
    if (manifest.kind === 'onefile' && manifest.entry && !existsSync(path.join(root, manifest.entry)))
      mErrors.push(`${entry.id}: entry ${manifest.entry} missing`);
    const tr = readTranslations(root, entry.id);
    mErrors.push(...tr.errors);
    errors.push(...mErrors);
    if (!mErrors.length) out.push({ entry, manifest, root, messages: tr.messages });
  }
  if (errors.length) throw new Error(`extensions: invalid setup\n  - ${errors.join('\n  - ')}`);
  for (const w of warnings) console.warn(`extensions: ${w}`);
  return out;
}

/** The serialisable view the shell uses at runtime (nav, access checks, onefile host). */
export function infoOf({ entry, manifest, root, messages }) {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    kind: manifest.kind,
    scope: manifest.scope,
    href: `/${manifest.id}`,
    entry: manifest.kind === 'onefile' ? manifest.entry : null,
    profiles: entry.profiles ?? null,
    inspiredBy: entry.inspiredBy ?? null,
    // Its own extra settings view at /<id>/settings, linked from its panel in System settings.
    settingsPage: !!root && existsSync(path.join(root, 'web', 'routes', 'settings', '+page.svelte')),
    settings: settingsOf(manifest),
    secrets: settingsOf(manifest).filter((f) => f.type === 'secret').map((f) => f.name),
    accessory: manifest.accessory ?? null,
    // Languages it has translations for (spec 007); System settings -> Language lists the gaps.
    languages: root ? languagesOf(manifest, root, messages ?? readTranslations(root, manifest.id).messages) : [BASE_LANG],
    enabled: true
  };
}

function walk(dir, base = dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) files.push(...walk(abs, base));
    else files.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return files;
}

/** Names a server/universal module exports, found by scanning its source (stubs re-export only those). */
export function exportedNames(source) {
  const names = new Set();
  const re = /export\s+(?:const|let|var|async\s+function|function)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(source))) names.add(m[1]);
  return [...names];
}

/** The stub that src/routes/(extensions)/<id>/<rel> gets for one extension route file. */
export function stubFor(id, rel, source) {
  const name = path.posix.basename(rel);
  const target = `$extensions/${id}/web/routes/${rel}`.replace(/\.ts$/, '');
  if (name.endsWith('.svelte')) {
    return (
      `<!-- generated by scripts/extensions-lib.mjs, do not edit -->\n` +
      `<script lang="ts">\n  import Component from '$extensions/${id}/web/routes/${rel}';\n  import { provideExtension } from '#lib/i18n/index.ts';\n\n` +
      `  // useT() in the pages below reads this extension's i18n/<lang>.json first (spec 007).\n` +
      `  provideExtension('${id}');\n  let props = $props();\n</script>\n\n` +
      `<Component {...props} />\n`
    );
  }
  const names = exportedNames(source);
  const lines = [`// generated by scripts/extensions-lib.mjs, do not edit`];
  if (name === '+page.ts' || name === '+layout.ts') {
    // Universal loads run in the browser too: no server context, plain re-export.
    const keep = names.filter((n) => n === 'load' || CONFIG_EXPORTS.includes(n));
    if (keep.length) lines.push(`export { ${keep.join(', ')} } from '${target}';`);
    return lines.join('\n') + '\n';
  }
  const wrapped = names.filter((n) => SERVER_EXPORTS.includes(n));
  const config = names.filter((n) => CONFIG_EXPORTS.includes(n));
  lines.push(`import * as m from '${target}';`);
  lines.push(`import { bind } from '#lib/extensions/runtime.server.ts';`);
  for (const n of wrapped) {
    const kind = n === 'load' ? 'load' : n === 'actions' ? 'actions' : 'handler';
    lines.push(`export const ${n} = bind.${kind}('${id}', m.${n});`);
  }
  if (config.length) lines.push(`export { ${config.join(', ')} } from '${target}';`);
  return lines.join('\n') + '\n';
}

function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

/** Remove generated files that no longer map to a source; never touches anything else. */
function prune(dir, keep) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) {
      prune(abs, keep);
      if (!readdirSync(abs).length) rmSync(abs, { recursive: true });
    } else if (!keep.has(abs)) rmSync(abs);
  }
}

/**
 * Generate route stubs and the runtime registry. Writes only files whose content changed, so the
 * live-reload poller does not see its own output as a new change.
 */
export function generate({ webRoot = WEB_ROOT, dir = extensionsDir(), log = () => {} } = {}) {
  const exts = loadExtensions(dir);
  const routesOut = path.join(webRoot, 'src', 'routes', '(extensions)');
  const registryFile = path.join(webRoot, 'src', 'lib', 'extensions', 'generated', 'registry.ts');
  const keep = new Set();
  let changed = 0;
  const emit = (file, content) => {
    keep.add(file);
    if (writeIfChanged(file, content)) changed++;
  };
  for (const ext of exts) {
    const { id } = ext.manifest;
    if (ext.manifest.kind === 'native') {
      const routesDir = path.join(ext.root, 'web', 'routes');
      for (const rel of walk(routesDir)) {
        const base = path.posix.basename(rel);
        if (!ROUTE_FILES.has(base)) continue; // components, helpers and tests live next to routes
        // The path is pasted into generated import statements: only SvelteKit-style segments.
        if (!SAFE_ROUTE_PATH.test(rel)) throw new Error(`extensions: ${id}: unsafe route path ${rel}`);
        const source = readFileSync(path.join(routesDir, rel), 'utf8');
        emit(path.join(routesOut, id, rel), stubFor(id, rel, source));
      }
    } else {
      emit(
        path.join(routesOut, id, '+page.svelte'),
        `<!-- generated by scripts/extensions-lib.mjs, do not edit -->\n<script lang="ts">\n` +
          `  import OnefileHost from '#lib/extensions/OnefileHost.svelte';\n</script>\n\n` +
          `<OnefileHost id="${id}" name={${JSON.stringify(ext.manifest.name)}} />\n`
      );
    }
  }
  const infos = exts.map(infoOf);
  emit(
    registryFile,
    `// generated by scripts/extensions-lib.mjs from ${path.basename(dir)}/installed.json, do not edit\n` +
      `import type { ExtensionInfo } from '../types';\n\n` +
      `export const EXTENSIONS: ExtensionInfo[] = ${JSON.stringify(infos, null, 2)};\n` +
      `export const EXTENSIONS_DIR = ${JSON.stringify(dir)};\n`
  );
  generateTiles({ webRoot, exts, emit });
  generateTools({ webRoot, exts, emit });
  generateSources({ webRoot, exts, emit });
  generateI18n({ webRoot, exts, emit });
  prune(routesOut, keep);
  log(`extensions: ${exts.map((e) => `${e.manifest.id} (${e.manifest.kind})`).join(', ') || 'none'}; ${changed} file(s) written`);
  return { extensions: infos, changed };
}

/**
 * Dashboard tiles (spec 003): a native extension may ship web/tiles.server.ts exporting
 * `tiles: ExtTile[]`. This writes src/lib/extensions/generated/tiles.server.ts, a map of lazy imports,
 * so the home page loads only the tile modules of extensions the profile can see.
 */
export function generateTiles({ webRoot = WEB_ROOT, exts, emit }) {
  const file = path.join(webRoot, 'src', 'lib', 'extensions', 'generated', 'tiles.server.ts');
  const ids = exts
    .filter((e) => e.manifest.kind === 'native' && existsSync(path.join(e.root, 'web', 'tiles.server.ts')))
    .map((e) => e.manifest.id);
  const lines = ids.map((id) => `  ${JSON.stringify(id)}: () => import('$extensions/${id}/web/tiles.server'),`);
  emit(
    file,
    `// generated by scripts/extensions-lib.mjs, do not edit\n` +
      `import type { ExtTile } from '../tiles';\n\n` +
      `export const TILE_MODULES: Record<string, () => Promise<{ tiles?: ExtTile[] }>> = {\n` +
      (lines.length ? lines.join('\n') + '\n' : '') +
      `};\n`
  );
  return ids;
}

/**
 * Tools for the AI (spec 005): every extension, native or onefile, ships web/tools.server.ts exporting
 * `tools: ExtTool[]`. Same lazy-import map as the tiles, in generated/tools.server.ts.
 */
export function generateTools({ webRoot = WEB_ROOT, exts, emit }) {
  const file = path.join(webRoot, 'src', 'lib', 'extensions', 'generated', 'tools.server.ts');
  const ids = exts
    .filter((e) => existsSync(path.join(e.root, 'web', 'tools.server.ts')))
    .map((e) => e.manifest.id);
  const lines = ids.map((id) => `  ${JSON.stringify(id)}: () => import('$extensions/${id}/web/tools.server'),`);
  emit(
    file,
    `// generated by scripts/extensions-lib.mjs, do not edit\n` +
      `import type { ExtTool } from '../tools';\n\n` +
      `export const TOOL_MODULES: Record<string, () => Promise<{ tools?: ExtTool[] }>> = {\n` +
      (lines.length ? lines.join('\n') + '\n' : '') +
      `};\n`
  );
  return ids;
}

/**
 * Connected accounts (spec 002): a native extension may ship web/sources.server.ts exporting
 * `sources: ExtSources`, shown in its System settings panel. Same lazy-import map, in generated/sources.server.ts.
 */
export function generateSources({ webRoot = WEB_ROOT, exts, emit }) {
  const file = path.join(webRoot, 'src', 'lib', 'extensions', 'generated', 'sources.server.ts');
  const ids = exts
    .filter((e) => e.manifest.kind === 'native' && existsSync(path.join(e.root, 'web', 'sources.server.ts')))
    .map((e) => e.manifest.id);
  const lines = ids.map((id) => `  ${JSON.stringify(id)}: () => import('$extensions/${id}/web/sources.server'),`);
  emit(
    file,
    `// generated by scripts/extensions-lib.mjs, do not edit\n` +
      `import type { ExtSources } from '../sources';\n\n` +
      `export const SOURCE_MODULES: Record<string, () => Promise<{ sources?: ExtSources }>> = {\n` +
      (lines.length ? lines.join('\n') + '\n' : '') +
      `};\n`
  );
  return ids;
}

/**
 * Translations (spec 007): every extension's i18n/<lang>.json, inlined into generated/i18n.ts so pages
 * (server and browser) and the shell (names, settings labels, tile titles) can use them.
 */
export function generateI18n({ webRoot = WEB_ROOT, exts, emit }) {
  const file = path.join(webRoot, 'src', 'lib', 'extensions', 'generated', 'i18n.ts');
  const all = {};
  for (const e of exts) if (e.messages && Object.keys(e.messages).length) all[e.manifest.id] = e.messages;
  emit(
    file,
    `// generated by scripts/extensions-lib.mjs from extensions/<id>/i18n/*.json, do not edit\n` +
      `import type { Messages } from '../../i18n/translate';\n\n` +
      `export const EXTENSION_MESSAGES: Record<string, Record<string, Messages>> = ${JSON.stringify(all, null, 2)};\n`
  );
}

/**
 * Every text a source file asks to translate (spec 007): the first argument of t('...') and the plural
 * form of t.n(count, '...', '...'), plus tile titles (`title: '...'`) when `titles` is set. Literal
 * strings only; a count with commas in it (t.n(f(a, b), ...)) is not recognised.
 */
export function keysIn(source, { titles = false } = {}) {
  const keys = new Set();
  const str = String.raw`(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\x60((?:[^\x60\\$]|\\.)*)\x60)`;
  const single = new RegExp(String.raw`(?<![\w$.])t\(\s*` + str, 'g');
  const plural = new RegExp(String.raw`(?<![\w$.])t\.n\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*` + str + String.raw`\s*,\s*` + str, 'g');
  const title = new RegExp(String.raw`\btitle:\s*` + str, 'g');
  const unescape = (s) => s.replace(/\\(['"\x60\\])/g, '$1').replace(/\\n/g, '\n');
  // Examples in comments are not texts of the app.
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
  let m;
  while ((m = single.exec(source))) keys.add(unescape(m[1] ?? m[2] ?? m[3]));
  while ((m = plural.exec(source))) keys.add(unescape(m[4] ?? m[5] ?? m[6]));
  if (titles) while ((m = title.exec(source))) keys.add(unescape(m[1] ?? m[2] ?? m[3]));
  return [...keys];
}

/** Texts of a manifest that the shell shows translated: name, description, settings labels and help. */
export function manifestKeys(manifest) {
  const keys = [manifest.name, manifest.description];
  for (const f of settingsOf(manifest)) keys.push(f.label, ...(f.help ? [f.help] : []));
  return keys.filter((k) => typeof k === 'string' && k);
}

/**
 * What an extension still needs to speak the given languages (spec 007), as warnings for `ext check`:
 * a missing i18n/<lang>.json, texts with no translation in it, a onefile UI without that language.
 */
export function translationWarnings(root, manifest, id, langs) {
  const warnings = [];
  const { messages } = readTranslations(root, id);
  let keys = manifestKeys(manifest);
  if (manifest.kind === 'native') {
    const web = path.join(root, 'web');
    const files = existsSync(web) ? walk(web).filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f)) : [];
    for (const f of files) keys.push(...keysIn(readFileSync(path.join(web, f), 'utf8'), { titles: f === 'tiles.server.ts' }));
  }
  keys = [...new Set(keys)];
  for (const lang of langs) {
    if (lang === BASE_LANG) continue;
    // Common words the shell already translates (Save, Cancel, ...) need no entry of their own.
    const shellFile = path.join(WEB_ROOT, 'src', 'lib', 'i18n', 'locales', `${lang}.json`);
    const shell = existsSync(shellFile) ? JSON.parse(readFileSync(shellFile, 'utf8')) : {};
    if (manifest.kind === 'onefile' && !(manifest.languages ?? []).includes(lang))
      warnings.push(`${id}: its UI is not in "${lang}" (translate the app, then add "${lang}" to "languages" in extension.json)`);
    const have = messages[lang];
    if (!have) {
      warnings.push(`${id}: no i18n/${lang}.json (${keys.filter((k) => !(k in shell)).length} texts to translate)`);
      continue;
    }
    const missing = keys.filter((k) => !(k in have) && !(k in shell));
    if (missing.length)
      warnings.push(`${id}: i18n/${lang}.json misses ${missing.length} text(s): ${missing.slice(0, 5).map((k) => JSON.stringify(k)).join(', ')}${missing.length > 5 ? ', ...' : ''}`);
  }
  return warnings;
}

/** Imports an extension may use. Everything else from the shell is private (see spec 002). */
const ALLOWED_SHELL_IMPORTS = /^(\$shell(\/.*)?|\$app\/.*|@sveltejs\/kit|svelte(\/.*)?)$/;

/**
 * Static lint: extension code imports only the SDK, SvelteKit, Svelte and its own files.
 * @param {string} root  @param {string} id  @returns {string[]}
 */
/**
 * The look every extension must have (spec 001, add-extension skill): the shell's layout and tokens, and
 * Beni woven in. Returned as warnings, not errors, so an older extension still builds; a new one must
 * come out of `ext check` without any.
 */
export function lookWarnings(root, manifest, id) {
  const warnings = [];
  if (manifest.kind === 'onefile') {
    const file = manifest.entry && path.join(root, manifest.entry);
    const html = file && existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!/<assistant-beni\b|createElement\(\s*['"]assistant-beni['"]/.test(html))
      warnings.push(`${id}: Beni is missing (use <assistant-beni mood="..."> in its header or empty states)`);
    if (!/var\(--(page|surface|ink|accent)\b/.test(html))
      warnings.push(`${id}: does not use the shell tokens (var(--page), var(--surface), var(--ink), var(--accent), ...)`);
  } else {
    const web = path.join(root, 'web');
    const files = existsSync(web) ? walk(web).filter((/** @type {string} */ f) => /\.(svelte|ts)$/.test(f)) : [];
    const src = files.map((f) => readFileSync(path.join(web, f), 'utf8')).join('\n');
    if (!/import\s*\{[^}]*\bMascot\b[^}]*\}\s*from\s*['"]\$shell\/ui['"]/.test(src))
      warnings.push(`${id}: Beni is missing (import { Mascot } from '$shell/ui' for its header or empty states)`);
    const pages = files.filter((f) => f.endsWith('.svelte')).map((f) => readFileSync(path.join(web, f), 'utf8')).join('\n');
    if (/#[0-9a-fA-F]{6}\b/.test(pages))
      warnings.push(`${id}: raw hex colours in its pages (use the shell tokens: --ink, --accent, --hue-*, ...)`);
    // The type scale (app.css): sizes and weights from tokens, so pages do not drift apart.
    const sizes = (pages.match(/font-size:\s*\d+(\.\d+)?(px|rem|em)/g) ?? []).length;
    const weights = (pages.match(/font-weight:\s*(?!400|500|600|var)\d{3}/g) ?? []).length;
    if (sizes) warnings.push(`${id}: ${sizes} raw font size(s) in its pages (use var(--text-xs) ... var(--text-2xl))`);
    if (weights) warnings.push(`${id}: ${weights} font weight(s) other than 400, 500, 600 (var(--weight-*))`);
  }
  return warnings;
}

/**
 * The tools contract (spec 005), checked from the source: web/tools.server.ts with a read-only `overview`,
 * and every tool saying whether it only reads. Warnings, like the look: older extensions keep working.
 * @param {string} root
 * @param {string} id
 */
export function toolWarnings(root, id) {
  const file = path.join(root, 'web', 'tools.server.ts');
  if (!existsSync(file)) return [`${id}: no web/tools.server.ts (export const tools: ExtTool[], with a read-only overview)`];
  const src = readFileSync(file, 'utf8');
  const warnings = [];
  if (!/name:\s*['"]overview['"]/.test(src)) warnings.push(`${id}: no \`overview\` tool (one call that sums up what the app holds now)`);
  const names = (src.match(/name:\s*['"][a-z][a-z0-9_]*['"]/g) ?? []).length;
  const declared = (src.match(/readOnly:\s*(true|false)/g) ?? []).length;
  if (declared < names) warnings.push(`${id}: say readOnly: true or false on every tool (${declared} of ${names} do)`);
  return warnings;
}

export function lintExtension(root, id) {
  const problems = [];
  const files = existsSync(root) ? walk(root).filter((/** @type {string} */ f) => /\.(ts|js|svelte)$/.test(f) && !f.includes('node_modules/')) : [];
  for (const rel of files) {
    const src = readFileSync(path.join(root, rel), 'utf8');
    const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(path.join(root, rel)), spec);
        if (!resolved.startsWith(root + path.sep)) problems.push(`${id}/${rel}: imports outside the extension: ${spec}`);
        continue;
      }
      if (/^[$#]/.test(spec) && !ALLOWED_SHELL_IMPORTS.test(spec))
        problems.push(`${id}/${rel}: imports shell internals: ${spec} (use $shell)`);
    }
    if (/\bcore\.(sessions|extension_kv|schema_migrations)\b/.test(src))
      problems.push(`${id}/${rel}: touches shell tables directly`);
  }
  const migDir = path.join(root, 'db', 'migrations');
  if (existsSync(migDir)) {
    for (const f of readdirSync(migDir)) {
      if (!/^[A-Za-z0-9_.-]+\.sql$/.test(f)) problems.push(`${id}/db/migrations/${f}: unsafe file name`);
      const sql = readFileSync(path.join(migDir, f), 'utf8').replace(/--.*$/gm, '');
      if (/\b(DROP|TRUNCATE)\b/i.test(sql)) problems.push(`${id}/db/migrations/${f}: DROP/TRUNCATE (migrations are additive)`);
      if (/\b(COPY\s+[^;]*\bPROGRAM\b|ALTER\s+SYSTEM|CREATE\s+(ROLE|USER|EXTENSION)|GRANT\b|SET\s+ROLE|SECURITY\s+DEFINER)/i.test(sql))
        problems.push(`${id}/db/migrations/${f}: privileged statement (roles, grants, COPY PROGRAM, ...) not allowed in an extension`);
      const touchesOther = [...sql.matchAll(/\b(?:TABLE|INDEX|VIEW|SCHEMA|ON|INTO|FROM|UPDATE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([a-z_][a-z0-9_]*)\./gi)]
        .map((m) => m[1].toLowerCase())
        .filter((s) => s !== id.replace(/-/g, '_') && !(s === 'core' && /core\.profiles/i.test(sql)));
      if (touchesOther.length) problems.push(`${id}/db/migrations/${f}: touches other schemas: ${[...new Set(touchesOther)].join(', ')}`);
    }
  }
  return problems;
}
