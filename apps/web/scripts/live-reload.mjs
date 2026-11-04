#!/usr/bin/env node
/**
 * Live-reload supervisor for the bind-mounted stack.
 *
 * Deploying is "commit to the checkout". This process:
 *   1. installs deps (only when package.json / package-lock.json differ from what node_modules was
 *      installed from), builds into build-next/, swaps it into build/ and starts the server,
 *   2. polls the source for changes (polling: bind mounts on a NAS do not deliver fs events),
 *   3. on a change: reinstalls if the manifest's content changed, builds into build-next/ again, and only if that
 *      build succeeds swaps it in and restarts the server.
 *
 * The running server is never touched by a failed build: the build writes to a staging directory,
 * so a broken edit leaves the previous good build serving and the failure in the log. Dependencies are
 * staged the same way: `npm ci` runs in .deps-next/ and its node_modules is swapped in only on success,
 * so a failed install (network, disk) never leaves the running server without its packages.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const POLL_MS = Number(process.env.LIVE_RELOAD_POLL_MS ?? 5000);
// Installed extensions (spec 002) are watched too: an edit in /extensions/<id> rebuilds the shell.
const EXTENSIONS_DIR = path.resolve(process.env.EXTENSIONS_DIR ?? path.join(ROOT, '..', '..', 'extensions'));
const WATCH = ['src', 'static', 'scripts', 'vite.config.ts', 'svelte.config.js', 'server.mjs', 'package.json', 'package-lock.json', EXTENSIONS_DIR];
// `(extensions)` and `generated` are written by the build itself (npm run gen): never a trigger.
const SKIP = new Set(['node_modules', '.svelte-kit', 'build', 'build-next', 'build-prev', '.git', '(extensions)', 'generated', '.trash', '.deps-next', 'node_modules.prev']);
const BUILD = path.join(ROOT, 'build');
const NEXT = path.join(ROOT, 'build-next');
const PREV = path.join(ROOT, 'build-prev');
const MODULES = path.join(ROOT, 'node_modules');
const DEPS_NEXT = path.join(ROOT, '.deps-next');
const MODULES_PREV = path.join(ROOT, 'node_modules.prev');
// Hash of the manifest node_modules was installed from (written after a successful install).
const STAMP = '.lock-sha256';

const log = (msg) => console.log(`[live-reload] ${new Date().toISOString()} ${msg}`);

function scan() {
  let newest = 0;
  let count = 0;
  const visit = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      if (SKIP.has(path.basename(p))) return;
      for (const e of readdirSync(p)) visit(path.join(p, e));
      return;
    }
    count++;
    if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  for (const rel of WATCH) {
    const abs = path.resolve(ROOT, rel);
    if (existsSync(abs)) visit(abs);
  }
  return `${newest}:${count}`;
}

/** Content hash of package.json + package-lock.json (mtimes lie after a checkout or a copy). */
function lockHash() {
  const h = createHash('sha256');
  for (const f of ['package.json', 'package-lock.json']) {
    try {
      h.update(readFileSync(path.join(ROOT, f)));
    } catch {
      h.update(`missing ${f}`);
    }
  }
  return h.digest('hex');
}

function depsCurrent() {
  try {
    return readFileSync(path.join(MODULES, STAMP), 'utf8').trim() === lockHash();
  } catch {
    return false;
  }
}

const run = (cmd, args, env = {}, cwd = ROOT) =>
  spawnSync(cmd, args, { stdio: 'inherit', cwd, env: { ...process.env, ...env } }).status === 0;

/** `npm ci` into .deps-next/, then swap its node_modules in. The old node_modules stays on failure. */
function installDeps() {
  const want = lockHash();
  rmSync(DEPS_NEXT, { recursive: true, force: true });
  mkdirSync(DEPS_NEXT);
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(path.join(ROOT, f), path.join(DEPS_NEXT, f));
  log('dependencies changed, npm ci into .deps-next/ ...');
  // --include=dev: NODE_ENV=production would otherwise skip the build toolchain.
  if (!run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], {}, DEPS_NEXT)) {
    rmSync(DEPS_NEXT, { recursive: true, force: true });
    return false;
  }
  writeFileSync(path.join(DEPS_NEXT, 'node_modules', STAMP), `${want}\n`);
  // A rename in the same directory needs no permission on node_modules itself, so this works even when
  // the old tree belongs to another uid (an `npm ci` once run as root); deleting it then may not.
  const old = `${MODULES_PREV}-${Date.now()}`;
  try {
    if (existsSync(MODULES)) renameSync(MODULES, old);
    renameSync(path.join(DEPS_NEXT, 'node_modules'), MODULES);
  } catch (e) {
    log(`could not swap node_modules in: ${e.message}`);
    if (!existsSync(MODULES) && existsSync(old)) renameSync(old, MODULES);
    return false;
  }
  rmSync(DEPS_NEXT, { recursive: true, force: true });
  removeOldModules();
  log('dependencies installed');
  return true;
}

/** Best effort: old node_modules trees we could not delete (not ours) are left for a human. */
function removeOldModules() {
  for (const e of readdirSync(ROOT)) {
    if (!e.startsWith('node_modules.prev')) continue;
    try {
      rmSync(path.join(ROOT, e), { recursive: true, force: true });
    } catch (err) {
      log(`cannot remove ${e} (${err.code}); delete it as root: rm -rf apps/web/${e}`);
    }
  }
}

/** Never throws: a permission problem in the checkout is logged and the current build keeps serving. */
function build() {
  try {
    return buildOnce();
  } catch (e) {
    log(`build step failed: ${e.message}; keeping the current build serving`);
    return false;
  }
}

function buildOnce() {
  if (!depsCurrent() && !installDeps()) {
    log('install FAILED, keeping the current dependencies and build');
    return false;
  }
  rmSync(NEXT, { recursive: true, force: true });
  log('building into build-next/ ...');
  if (!run('npm', ['run', 'build'], { BUILD_OUT: 'build-next' })) {
    log('build FAILED, keeping the current build serving');
    return false;
  }
  rmSync(PREV, { recursive: true, force: true });
  if (existsSync(BUILD)) renameSync(BUILD, PREV);
  renameSync(NEXT, BUILD);
  log('build ok, swapped in');
  return true;
}

let server = null;

function startServer() {
  const child = spawn('node', ['server.mjs'], { stdio: 'inherit', cwd: ROOT });
  server = child;
  child.on('exit', (code, signal) => {
    // Only the CURRENT server may trigger a revive, and never one we stopped for a reload
    // (adapter-node can exit non-zero on SIGTERM).
    if (child !== server || child.stopping) return;
    server = null;
    log(`server exited (code ${code}, signal ${signal}), restarting in 5s`);
    setTimeout(() => {
      if (!server) startServer();
    }, 5000);
  });
  log(`server started (pid ${child.pid})`);
}

/** Stop the current server and wait until its process is gone (so the port is free). */
function stopServer() {
  const child = server;
  server = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.stopping = true;
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
  });
}

async function restartServer() {
  await stopServer();
  startServer();
}

// boot: a previous good build can serve even if this first build fails.
const builtNow = build();
if (!builtNow && !existsSync(path.join(BUILD, 'index.js'))) {
  log('initial build failed and there is no previous build, exiting');
  process.exit(1);
}
startServer();

let signature = scan();
let building = false;
log(`watching for changes every ${POLL_MS}ms`);

setInterval(async () => {
  if (building) return;
  const now = scan();
  if (now === signature) return;
  building = true; // before any await: one change, one build
  try {
    // Let a burst of writes (a commit touching many files) settle before building.
    await new Promise((r) => setTimeout(r, 2000));
    const settled = scan();
    if (settled !== now) return; // still changing; the next tick picks it up
    signature = settled;
    if (build()) await restartServer();
  } finally {
    building = false;
  }
}, POLL_MS);
