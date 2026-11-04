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
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Bumped when the contract between the shell and extensions changes incompatibly. */
export const SHELL_API = 1;
/** First path segments the shell owns; an extension id can never take one. */
export const RESERVED_IDS = new Set([
  'api', 'app', 'apps', 'assets', 'ext', 'extensions', 'favicon', 'healthz', 'login', 'logout', 'profile',
  'settings', 'shell', 'static', 'x', '_app'
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

/** A secret name: lowercase, digits, underscores, e.g. "api_token". */
export const SECRET_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function validateManifest(m, dirName) {
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
  // Secrets the extension asks for (spec 004): names only; values are set by an admin in System settings.
  if (m.secrets !== undefined) {
    req('secrets', Array.isArray(m.secrets) && m.secrets.length <= 10 && m.secrets.every((n) => SECRET_RE.test(n)));
    if (m.kind !== 'native' && m.secrets?.length) errors.push(`${dirName}: only native extensions can have secrets`);
  }
  // Its settings panel in System settings (spec 002, "Settings"): fields the shell renders.
  if (m.settings !== undefined) errors.push(...settingsProblems(m.settings, m.kind, dirName));
  if (m.kind === 'onefile') req('entry', typeof m.entry === 'string' && /^[A-Za-z0-9._-]+\.html$/.test(m.entry));
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
  }
  return errors;
}

/** Settings fields of a manifest, with the older "secrets" list folded in as secret fields. */
export function settingsOf(manifest) {
  const fields = Array.isArray(manifest.settings) ? manifest.settings.map((f) => ({ ...f })) : [];
  const names = new Set(fields.map((f) => f.name));
  if (manifest.kind === 'native' && Array.isArray(manifest.secrets))
    for (const n of manifest.secrets) if (!names.has(n)) fields.push({ name: n, label: n.replace(/_/g, ' '), type: 'secret' });
  return fields;
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
    errors.push(...mErrors);
    if (!mErrors.length) out.push({ entry, manifest, root });
  }
  if (errors.length) throw new Error(`extensions: invalid setup\n  - ${errors.join('\n  - ')}`);
  for (const w of warnings) console.warn(`extensions: ${w}`);
  return out;
}

/** The serialisable view the shell uses at runtime (nav, access checks, onefile host). */
export function infoOf({ entry, manifest, root }) {
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
      `<script lang="ts">\n  import Component from '$extensions/${id}/web/routes/${rel}';\n  let props = $props();\n</script>\n\n` +
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
  lines.push(`import { bind } from '$lib/extensions/runtime.server';`);
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
          `  import OnefileHost from '$lib/extensions/OnefileHost.svelte';\n</script>\n\n` +
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
 * Tools for Claude (spec 005): a native extension may ship web/tools.server.ts exporting
 * `tools: ExtTool[]`. Same lazy-import map as the tiles, in generated/tools.server.ts.
 */
export function generateTools({ webRoot = WEB_ROOT, exts, emit }) {
  const file = path.join(webRoot, 'src', 'lib', 'extensions', 'generated', 'tools.server.ts');
  const ids = exts
    .filter((e) => e.manifest.kind === 'native' && existsSync(path.join(e.root, 'web', 'tools.server.ts')))
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

/** Imports an extension may use. Everything else from the shell is private (see spec 002). */
const ALLOWED_SHELL_IMPORTS = /^(\$shell(\/.*)?|\$app\/.*|@sveltejs\/kit|svelte(\/.*)?)$/;

/**
 * Static lint: extension code imports only the SDK, SvelteKit, Svelte and its own files.
 * @param {string} root  @param {string} id  @returns {string[]}
 */
/**
 * The look every extension must have (spec 001, add-extension skill): the shell's layout and tokens, and
 * Pip woven in. Returned as warnings, not errors, so an older extension still builds; a new one must
 * come out of `ext check` without any.
 */
export function lookWarnings(root, manifest, id) {
  const warnings = [];
  if (manifest.kind === 'onefile') {
    const file = manifest.entry && path.join(root, manifest.entry);
    const html = file && existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (!/<assistant-pip\b|createElement\(\s*['"]assistant-pip['"]/.test(html))
      warnings.push(`${id}: Pip is missing (use <assistant-pip mood="..."> in its header or empty states)`);
    if (!/var\(--(page|surface|ink|accent)\b/.test(html))
      warnings.push(`${id}: does not use the shell tokens (var(--page), var(--surface), var(--ink), var(--accent), ...)`);
  } else {
    const web = path.join(root, 'web');
    const files = existsSync(web) ? walk(web).filter((/** @type {string} */ f) => /\.(svelte|ts)$/.test(f)) : [];
    const src = files.map((f) => readFileSync(path.join(web, f), 'utf8')).join('\n');
    if (!/import\s*\{[^}]*\bMascot\b[^}]*\}\s*from\s*['"]\$shell\/ui['"]/.test(src))
      warnings.push(`${id}: Pip is missing (import { Mascot } from '$shell/ui' for its header or empty states)`);
    if (/#[0-9a-fA-F]{6}\b/.test(files.filter((f) => f.endsWith('.svelte')).map((f) => readFileSync(path.join(web, f), 'utf8')).join('\n')))
      warnings.push(`${id}: raw hex colours in its pages (use the shell tokens: --ink, --accent, --hue-*, ...)`);
  }
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
      if (spec.startsWith('$') && !ALLOWED_SHELL_IMPORTS.test(spec))
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
