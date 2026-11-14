// Run: node --test services/terminal
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createChats, permissionReply, toolSummary, translate } from './chat.mjs';

test('translate: text, tools, results, questions and the end of a turn', () => {
  assert.equal(translate({ type: 'system', subtype: 'init', session_id: 's1' }).session, 's1');
  assert.equal(translate({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } }).delta, 'Hi');
  const a = translate({ type: 'assistant', message: { content: [{ type: 'text', text: 'Sure.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } });
  assert.deepEqual(a.events, [{ t: 'text', text: 'Sure.' }, { t: 'tool', id: 't1', name: 'Bash', summary: 'ls' }]);
  assert.deepEqual(translate({ type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'sub' }] } }).events, []);
  const r = translate({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a\nb' }] }] } });
  assert.deepEqual(r.events, [{ t: 'result', id: 't1', error: false, text: 'a\nb' }]);
  const q = translate({
    type: 'control_request',
    request_id: 'r1',
    request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }] }] } }
  });
  assert.equal(q.events[0].t, 'ask');
  assert.deepEqual(q.events[0].questions, [{ question: 'Which?', header: 'Pick', multi: false, options: [{ label: 'A', description: '' }] }]);
  const done = translate({ type: 'result', subtype: 'success', total_cost_usd: 0.01, duration_ms: 5 });
  assert.ok(done.done);
  assert.deepEqual(done.events, [{ t: 'done', cost: 0.01, ms: 5 }]);
  assert.equal(translate({ type: 'result', subtype: 'error_during_execution', is_error: true }).events[0].t, 'error');
});

test('permissionReply and toolSummary', () => {
  assert.deepEqual(permissionReply('r', { command: 'x' }, { allow: true }).response.response, { behavior: 'allow', updatedInput: { command: 'x' } });
  assert.deepEqual(permissionReply('r', { q: 1 }, { allow: true, answers: { Which: 'A' } }).response.response.updatedInput, { q: 1, answers: { Which: 'A' } });
  assert.equal(permissionReply('r', {}, { allow: false }).response.response.behavior, 'deny');
  assert.equal(toolSummary('Edit', { file_path: '/a', old_string: 'x' }), '/a');
  assert.equal(toolSummary('X', {}), '');
});

// A stand-in for `claude -p` in stream-json mode: answers each message, asks before "rm".
const FAKE = `#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const resumed = process.argv.includes('--resume');
out({ type: 'system', subtype: 'init', session_id: 'sess-1' });
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.type === 'user') {
    const text = m.message.content;
    if (text === 'rm') return out({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -r x' } } });
    out({ type: 'assistant', message: { content: [{ type: 'text', text: (resumed ? 'again: ' : 'echo: ') + text }] } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0 });
  } else if (m.type === 'control_response') {
    out({ type: 'assistant', message: { content: [{ type: 'text', text: m.response.response.behavior }] } });
    out({ type: 'result', subtype: 'success' });
  }
});
`;

const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('timed out');
};

test('chats: a conversation with an approval, kept on disk and resumed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chat-'));
  const bin = path.join(dir, 'fake-claude');
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  const opts = { dir: path.join(dir, 'chats'), cwd: dir, env: () => ({ PATH: process.env.PATH }), command: bin };
  const chats = createChats(opts);
  const id = chats.create('hello');
  const texts = () => chats.get(id).events.filter((e) => e.t === 'text').map((e) => e.text);
  await until(() => texts().includes('echo: hello'));
  assert.equal(chats.list()[0].title, 'hello');
  await until(() => chats.list()[0].session === 'sess-1');

  const seen = [];
  const off = chats.subscribe(id, 0, (e) => seen.push(e));
  chats.send(id, 'rm');
  const ask = await until(() => chats.get(id).events.find((e) => e.t === 'ask'));
  assert.equal(ask.summary, 'rm -r x');
  assert.deepEqual(chats.get(id).open, ['r1']);
  assert.equal(chats.answer(id, 'nope', { allow: true }), false);
  assert.ok(chats.answer(id, 'r1', { allow: false }));
  await until(() => texts().includes('deny'));
  assert.ok(seen.some((e) => e.t === 'answer' && e.allow === false));
  off();
  chats.close();

  // A new server (restart): the chat is read back and the next message resumes the session.
  await new Promise((r) => setTimeout(r, 100));
  const again = createChats(opts);
  assert.equal(again.get(id).events.filter((e) => e.t === 'user').length, 2);
  again.send(id, 'more');
  await until(() => again.get(id).events.some((e) => e.text === 'again: more'));
  again.close();
  assert.ok(again.remove(id));
  assert.equal(again.get(id), null);
});
