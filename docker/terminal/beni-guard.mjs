#!/usr/bin/env node
/**
 * The agents in the terminal may do anything, except that a critical change waits for the owner's approval.
 * This is Claude Code's PreToolUse hook (managed-settings.json, root-owned in the image, so the agent cannot
 * switch it off): it answers "ask" for those changes and stays silent for everything else, which the
 * managed allow list lets through without a prompt. Codex gets the same list as execpolicy rules
 * (codex-config.mjs). Critical:
 *
 * - a push that reaches main (the host's updater deploys main as root), a force push, deleting a branch,
 *   merging a PR on GitHub, deleting a repo or release
 * - throwing work or history away: git reset --hard, git clean -f, git branch -D, git stash drop/clear,
 *   git checkout/restore of everything, history rewrites
 * - deleting data: DELETE/DROP/TRUNCATE/ALTER/GRANT/REVOKE in SQL, dropdb, pg_restore
 * - rm -r outside scratch and build folders, removing an extension
 * - changing the agents' own permission settings (Claude's and Codex's config, this hook)
 *
 * The database role (agent_rw) and the updater are the hard limits behind this: no DDL, no secrets, and
 * nothing from the checkout runs as root or as the database superuser.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const MAIN = /^(refs\/heads\/)?(main|master)$/;
const SCRATCH = /^(\/tmp\/|\/var\/tmp\/)|(^|\/)(node_modules|\.svelte-kit|build|build-next|dist|__pycache__|\.pytest_cache|\.venv|coverage)(\/|$)/;
const GUARDED_FILES =
  /(^|\/)\.claude\/settings(\.local)?\.json$|(^|\/)\.claude\.json$|(^|\/)\.codex\/(config\.toml|hooks\.json|rules\/)|^\/etc\/(claude-code|codex)\/|beni-guard\.mjs$/;
const SQL_CONTEXT = /\b(psql|beni-db|pg_dump|pg_restore|dropdb|psycopg2?|asyncpg|sqlalchemy)\b|DATABASE_URL|\.sql\b|sql`/i;
const SQL_DESTRUCTIVE =
  /\b(DROP\s+(TABLE|SCHEMA|DATABASE|ROLE|USER|VIEW|INDEX|FUNCTION|TYPE|EXTENSION|SEQUENCE|MATERIALIZED|OWNED)|TRUNCATE|DELETE\s+FROM|ALTER\s+(TABLE|SCHEMA|ROLE|USER|DATABASE|SYSTEM|DEFAULT)|GRANT|REVOKE|CREATE\s+(ROLE|USER|DATABASE|EXTENSION)|COPY\b[^;]*\bPROGRAM)\b/i;

/** Shell words of one simple command (quotes removed; good enough for flags and refspecs). */
const words = (segment) =>
  (segment.match(/'[^']*'|"(?:\\.|[^"\\])*"|[^\s]+/g) ?? []).map((w) => w.replace(/^(['"])([\s\S]*)\1$/, '$2'));

/** Simple commands of a command line: split at ; && || | and newlines (not inside quotes). */
export function segments(command) {
  const out = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"') cur += command[i++];
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(words).map(stripPrefix).filter((w) => w.length);
}

/** Drops `env A=b`, `A=b`, `sudo`, `command`, `exec`, `time`, `nohup` in front of the real command. */
function stripPrefix(w) {
  let i = 0;
  while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]) || ['env', 'sudo', 'command', 'exec', 'time', 'nohup', 'xargs'].includes(w[i]))) i++;
  return w.slice(i);
}

/** git's subcommand and its arguments, after global options (-C <dir>, -c k=v, --git-dir=...). */
function gitArgs(w) {
  if (path.basename(w[0] ?? '') !== 'git') return null;
  let i = 1;
  let dir = '';
  while (i < w.length && w[i].startsWith('-')) {
    if (w[i] === '-C') dir = w[i + 1] ?? '';
    i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(w[i]) ? 2 : 1;
  }
  return { sub: w[i], args: w.slice(i + 1), dir };
}

const currentBranch = (cwd) => {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

function pushReason(args, cwd) {
  if (args.some((a) => /^(-f|--force|--force-with-lease.*|--force-if-includes|-d|--delete|--mirror|--all|--prune)$/.test(a)))
    return 'a force push, a branch deletion or a push of every branch';
  const pos = args.filter((a) => !a.startsWith('-'));
  const refs = pos.slice(1);
  if (!refs.length) {
    const b = currentBranch(cwd);
    return !b || MAIN.test(b) || b === 'HEAD' ? `a push of the current branch (${b || 'unknown'}), which the updater deploys` : null;
  }
  for (const r of refs) {
    if (r.startsWith('+') || r.startsWith(':')) return `a forced push or deletion (${r})`;
    const [src, dst] = r.includes(':') ? r.split(':', 2) : [r, r];
    const target = dst === 'HEAD' || (!r.includes(':') && src === 'HEAD') ? currentBranch(cwd) : dst;
    if (!target || target === 'HEAD' || MAIN.test(target)) return `a push to ${target || 'an unknown branch'}, which the host's updater may deploy as root`;
  }
  return null;
}

/** Why a shell command needs the owner's approval, or null. */
export function bashReason(command, cwd = process.cwd()) {
  for (const w of segments(command)) {
    const git = gitArgs(w);
    if (git) {
      const { sub, args } = git;
      const at = git.dir ? path.resolve(cwd, git.dir) : cwd;
      if (sub === 'push') {
        const r = pushReason(args, at);
        if (r) return r;
      }
      if (sub === 'reset' && args.includes('--hard')) return 'git reset --hard throws uncommitted work away';
      if (sub === 'clean' && args.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--force')) return 'git clean deletes untracked files';
      if (sub === 'branch' && args.some((a) => a === '-D' || (a === '--delete' && args.includes('--force')))) return 'deleting an unmerged branch';
      if (sub === 'stash' && ['drop', 'clear'].includes(args[0])) return 'dropping stashed work';
      if ((sub === 'checkout' || sub === 'restore') && args.some((a) => a === '.' || a === ':/')) return 'discarding every uncommitted change';
      if (sub === 'filter-branch' || sub === 'filter-repo' || (sub === 'update-ref' && args.includes('-d'))) return 'rewriting history';
      continue;
    }
    const cmd = path.basename(w[0]);
    if (cmd === 'gh') {
      const line = w.slice(1).join(' ');
      if (/^pr merge\b/.test(line)) return 'merging a pull request (main is deployed by the updater)';
      if (/^(repo|release) delete\b/.test(line)) return `gh ${w[1]} delete`;
      if (/^api\b/.test(line) && /(-X|--method)[ =]?(DELETE|PUT)\b/i.test(line)) return 'a DELETE/PUT call to the GitHub API';
    }
    if (cmd === 'rm' && w.slice(1).some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive')) {
      const targets = w.slice(1).filter((a) => !a.startsWith('-'));
      // As written: /tmp/... or a build folder; `..` never counts as scratch.
      const risky = targets.filter((t) => !SCRATCH.test(t) || t.split('/').includes('..'));
      if (!targets.length || risky.length) return `rm -r of ${risky.join(' ') || 'its arguments'}`;
    }
    if (cmd === 'dropdb' || cmd === 'pg_restore') return `${cmd} replaces or deletes database data`;
    if (cmd === 'node' && /(^|\/)ext\.mjs$/.test(w[1] ?? '') && w[2] === 'remove') return 'removing an extension';
  }
  if (SQL_CONTEXT.test(command) && SQL_DESTRUCTIVE.test(command)) {
    return `SQL that deletes data or changes the schema or roles (${command.match(SQL_DESTRUCTIVE)[0].toUpperCase()})`;
  }
  const touchesGuard = (command.match(/[^\s'"=<>|;&]+/g) ?? []).some((t) => GUARDED_FILES.test(t));
  if (touchesGuard && /(>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\bchmod\b|\bln\b|\btruncate\b|\bperl\s+-[a-z]*i|writeFile|open\()/.test(command)) {
    return "changing the agents' own permission settings";
  }
  return null;
}

/** Why this tool call needs the owner's approval, or null. */
export function reason(tool, input = {}, cwd = process.cwd()) {
  if (tool === 'Bash') return bashReason(String(input.command ?? ''), cwd);
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const file = path.resolve(cwd, String(input.file_path ?? input.notebook_path ?? ''));
    if (GUARDED_FILES.test(file)) return "changing the agents' own permission settings";
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    let why;
    try {
      const e = JSON.parse(raw);
      why = reason(e.tool_name, e.tool_input, e.cwd || process.cwd());
    } catch (err) {
      // Fail closed: a guard that cannot read the call asks rather than waves it through.
      why = `the approval guard could not check this call (${err.message})`;
    }
    if (why) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `Needs the owner's approval: ${why}.`
          }
        })
      );
    }
  });
}
