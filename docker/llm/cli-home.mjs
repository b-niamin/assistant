#!/usr/bin/env node
/**
 * Moves the agent CLIs (Claude Code, Codex) into a home-owned npm prefix, so they can update themselves.
 *
 * The image installs them as root into /usr/local, which the `claude` user cannot write: Claude Code's
 * auto-update failed with "no write permission to npm prefix" and Codex's "Update now" with EACCES. The
 * image sets NPM_CONFIG_PREFIX=~/.npm-global, so `npm install -g` (what both updaters run) writes into the
 * home volume, and ~/.npm-global/bin comes first on PATH. An update made in llm is the one the terminal uses
 * too (same volume), and it survives container restarts and image rebuilds.
 *
 * On every start of llm this copies each CLI from the image into ~/.npm-global when the home copy is missing
 * or older than the image's (a rebuild with a newer version). A newer home copy, from a self-update, stays.
 * Offline: it copies files, it does not download anything.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const PACKAGES = ['@anthropic-ai/claude-code', '@openai/codex'];
const IMAGE = '/usr/local/lib/node_modules';
const HOME = process.env.HOME ?? '/home/claude';
const prefix = process.env.NPM_CONFIG_PREFIX || path.join(HOME, '.npm-global');
const lib = path.join(prefix, 'lib', 'node_modules');
const bin = path.join(prefix, 'bin');

const manifest = (dir) => {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};

/** a > b for x.y.z versions; a pre-release counts as lower than its release. */
export const newer = (a, b) => {
  const parse = (v) => {
    const [core, pre] = String(v).split('-', 2);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre > y.pre;
};

const bins = (pkg) => {
  const m = manifest(path.join(lib, pkg));
  if (!m?.bin) return {};
  return typeof m.bin === 'string' ? { [m.name.split('/').pop()]: m.bin } : m.bin;
};

const link = (pkg) => {
  mkdirSync(bin, { recursive: true });
  for (const [name, rel] of Object.entries(bins(pkg))) {
    const target = path.relative(bin, path.join(lib, pkg, rel));
    const at = path.join(bin, name);
    try {
      lstatSync(at);
      unlinkSync(at);
    } catch {}
    symlinkSync(target, at);
  }
};

export const seed = (pkg) => {
  const src = path.join(IMAGE, pkg);
  const dst = path.join(lib, pkg);
  const image = manifest(src);
  if (!image) return `${pkg}: not in the image`;
  const home = manifest(dst);
  if (home && !newer(image.version, home.version)) {
    // Repair a missing bin link (e.g. a half-finished update), nothing else.
    if (Object.keys(bins(pkg)).some((name) => !existsSync(path.join(bin, name)))) link(pkg);
    return `${pkg}: ${home.version} in ~/.npm-global (image ${image.version})`;
  }
  // Copy next to it, then swap: a crash midway never leaves a half-copied CLI on PATH.
  const tmp = `${dst}.beni-tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, tmp, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  rmSync(dst, { recursive: true, force: true });
  renameSync(tmp, dst);
  link(pkg);
  return `${pkg}: ${home ? `${home.version} -> ` : ''}${image.version} copied to ~/.npm-global`;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const pkg of PACKAGES) {
    try {
      console.log(`[cli-home] ${seed(pkg)}`);
    } catch (e) {
      // The image's copy in /usr/local/bin stays on PATH, so the agents still start (without updates).
      console.log(`[cli-home] ${pkg}: ${e.message}`);
    }
  }
}
