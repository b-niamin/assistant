// Run: node --test docker/terminal
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { bashReason, reason } from './beni-guard.mjs';

// A repo on a feature branch, so a bare `git push` there is not a push to main.
const repo = mkdtempSync(path.join(tmpdir(), 'guard-'));
const main = mkdtempSync(path.join(tmpdir(), 'guard-main-'));
for (const [dir, branch] of [[repo, 'feature'], [main, 'main']]) {
  spawnSync('git', ['init', '-q', '-b', branch, dir]);
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: dir });
}

const asks = (cmd, cwd = repo) => assert.ok(bashReason(cmd, cwd), `should ask: ${cmd}`);
const passes = (cmd, cwd = repo) => assert.equal(bashReason(cmd, cwd), null, `should pass: ${cmd}`);

test('pushes: main, force and deletes ask; other branches pass', () => {
  asks('git push origin main');
  asks('git push origin HEAD:main');
  asks('git push origin feature:refs/heads/main');
  asks('cd /workspace && git push -u origin main');
  asks('git -C /x push origin main');
  asks('git push --force origin feature');
  asks('git push origin +feature');
  asks('git push origin :old-branch');
  asks('git push origin --delete old');
  asks('git push', main);
  asks('git push origin HEAD', main);
  passes('git push');
  passes('git push -u origin feature');
  passes('git push origin HEAD:claude/fix-x');
  passes('git status && git log --oneline -5');
});

test('git history and work: hard resets, cleans, branch -D ask', () => {
  asks('git reset --hard origin/main');
  asks('git clean -fdx');
  asks('git branch -D feature');
  asks('git stash drop');
  asks('git checkout -- .');
  asks('git filter-branch --tree-filter x');
  passes('git reset HEAD~1');
  passes('git commit -m "drop the old table from the docs"');
  passes('git branch -d merged');
});

test('database: deleting data or changing schema/roles asks; reads and writes pass', () => {
  asks(`psql "$AGENT_DATABASE_URL" -c "DELETE FROM gym.sets WHERE id = 3"`);
  asks(`beni-db --write -c 'truncate health.daily'`);
  asks(`beni-db --write <<'SQL'\nALTER TABLE core.profiles ADD COLUMN x int;\nSQL`);
  asks(`psql "$AGENT_DATABASE_URL" -c "drop table gym.sets"`);
  asks(`python3 -c "import psycopg; psycopg.connect(u).execute('DELETE FROM x')"`);
  asks('dropdb assistant');
  passes(`beni-db -c "SELECT count(*) FROM gym.sets"`);
  passes(`beni-db --write -c "UPDATE gym.sets SET reps = 8 WHERE id = 3"`);
  passes(`beni-db --write -c "INSERT INTO health.journal (note) VALUES ('ok')"`);
  passes('grep -rn "DELETE FROM" apps/web/src');
});

test('files: rm -r outside scratch asks; build folders and /tmp pass', () => {
  asks('rm -rf extensions/gym');
  asks('rm -r /workspace');
  asks('rm -rf ~');
  asks('rm -rf /tmp/../workspace');
  passes('rm -rf /tmp/x apps/web/node_modules apps/web/.svelte-kit');
  passes('rm extensions/gym/old.txt');
  asks('node scripts/ext.mjs remove gym');
  passes('node scripts/ext.mjs install gym');
});

test('GitHub: merging a PR or deleting asks', () => {
  asks('gh pr merge 12 --squash');
  asks('gh repo delete b-niamin/x --yes');
  asks('gh api -X DELETE repos/a/b/git/refs/heads/x');
  passes('gh pr create --fill');
  passes('gh api repos/a/b/pulls');
});

test("the agents' own permissions: edits and shell writes ask", () => {
  assert.ok(reason('Edit', { file_path: '/home/claude/.claude/settings.json' }));
  assert.ok(reason('Write', { file_path: '.claude/settings.local.json' }, '/workspace'));
  assert.ok(reason('Write', { file_path: '/home/claude/.codex/rules/default.rules' }));
  assert.ok(reason('Bash', { command: `sed -i 's/on-request/never/' ~/.codex/config.toml` }));
  assert.ok(reason('Bash', { command: 'echo {} > /home/claude/.claude/settings.json' }));
  assert.equal(reason('Bash', { command: 'cat ~/.codex/config.toml' }), null);
  assert.equal(reason('Edit', { file_path: '/workspace/apps/web/src/app.css' }), null);
  assert.equal(reason('Edit', { file_path: '/workspace/docker-compose.yml' }), null);
  assert.equal(reason('Read', { file_path: '/workspace/.claude/settings.json' }), null);
});

test('hook protocol: ask JSON for a critical call, nothing otherwise, ask on garbage', () => {
  const run = (input) =>
    spawnSync('node', [new URL('./beni-guard.mjs', import.meta.url).pathname], { input, encoding: 'utf8' }).stdout;
  const out = JSON.parse(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: repo })));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /main/);
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: repo })), '');
  assert.equal(JSON.parse(run('not json')).hookSpecificOutput.permissionDecision, 'ask');
});
