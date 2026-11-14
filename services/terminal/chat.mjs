/**
 * The app's chat with Claude Code (spec 004): the real `claude` CLI, headless, signed in with the terminal's
 * own login (no API key). Each chat is one Claude Code conversation, run as
 *
 *   claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio
 *
 * in /workspace, the same as in the terminal: same managed settings, same beni-guard. What the guard answers
 * "ask" for (a critical change) comes back here as a `can_use_tool` request, and the chat shows it as a card
 * the owner allows or denies. AskUserQuestion comes the same way, as questions with options.
 *
 * A chat's process stays up between messages and quits after IDLE_MS; the next message resumes the same
 * Claude session (`--resume`). The chat list and each chat's events live in ~/.beni/chats (agent-home volume).
 *
 * HTTP (only with a valid single-use "chat" ticket in x-ticket, minted by the web app for a session):
 *   GET    /chat                      -> {chats: [...]}
 *   POST   /chat {text}               -> {id}            new chat, its first message
 *   GET    /chat/<id>                 -> {chat, events, busy}
 *   GET    /chat/<id>/stream?from=<n> -> text/event-stream: events from n on, then live (and `delta` text)
 *   POST   /chat/<id>/send {text}
 *   POST   /chat/<id>/answer {rid, allow, answers?}
 *   POST   /chat/<id>/stop            interrupts the running turn
 *   DELETE /chat/<id>
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const IDLE_MS = 20 * 60 * 1000;
const MAX_RUNNING = 4;
const MAX_TEXT = 100_000;
const ID_RE = /^[a-f0-9]{16}$/;

const SYSTEM = [
  'You are running inside the Beni Assistant app, in its chat window (not a terminal).',
  'The owner reads your replies as chat messages rendered from Markdown; keep them short and plain.',
  'A critical change you try (see AGENTS.md) shows the owner an Allow/Deny card in the chat and waits for it.'
].join(' ');

/** A short, readable line for a tool call. */
export function toolSummary(name, input = {}) {
  const s = (v) => (typeof v === 'string' ? v : '');
  const pick =
    s(input.command) || s(input.file_path) || s(input.notebook_path) || s(input.pattern) || s(input.url) || s(input.query) || s(input.description) || s(input.prompt);
  const line = pick || (Object.keys(input).length ? JSON.stringify(input) : '');
  return line.length > 400 ? `${line.slice(0, 400)}…` : line;
}

const clip = (text, max = 4000) => (text.length > max ? `${text.slice(0, max)}\n…` : text);

/** The text of a tool result's content (string or blocks). */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b?.type === 'text' ? b.text : b?.type ? `[${b.type}]` : '')).join('\n');
  return '';
}

/**
 * One line of Claude Code's stream-json output -> the chat's own events. Pure, for the tests.
 * Returns {events, delta, session, done}.
 */
export function translate(msg) {
  const out = { events: [], delta: '', session: '', done: false };
  if (!msg || typeof msg !== 'object') return out;
  if (msg.type === 'system' && msg.subtype === 'init') out.session = String(msg.session_id ?? '');
  else if (msg.type === 'stream_event') {
    const e = msg.event;
    if (!msg.parent_tool_use_id && e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') out.delta = e.delta.text ?? '';
  } else if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    // Sub-agents' steps (parent_tool_use_id) stay out of the chat: their Task call and result show.
    if (msg.parent_tool_use_id) return out;
    for (const b of msg.message.content) {
      if (b.type === 'text' && b.text?.trim()) out.events.push({ t: 'text', text: b.text });
      else if (b.type === 'tool_use') out.events.push({ t: 'tool', id: b.id, name: b.name, summary: toolSummary(b.name, b.input) });
    }
  } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
    if (msg.parent_tool_use_id) return out;
    for (const b of msg.message.content)
      if (b.type === 'tool_result') out.events.push({ t: 'result', id: b.tool_use_id, error: !!b.is_error, text: clip(resultText(b.content)) });
  } else if (msg.type === 'result') {
    out.done = true;
    if (msg.is_error || (msg.subtype && msg.subtype !== 'success'))
      out.events.push({ t: 'error', text: String(msg.result || msg.subtype || 'error') });
    out.events.push({ t: 'done', cost: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null, ms: msg.duration_ms ?? null });
  } else if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
    const r = msg.request;
    const ask = { t: 'ask', rid: String(msg.request_id), tool: r.tool_name, summary: toolSummary(r.tool_name, r.input), reason: r.decision_reason ?? r.description ?? '' };
    if (r.tool_name === 'AskUserQuestion' && Array.isArray(r.input?.questions))
      ask.questions = r.input.questions.map((q) => ({
        question: String(q.question ?? ''),
        header: String(q.header ?? ''),
        multi: !!q.multiSelect,
        options: (q.options ?? []).map((o) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') }))
      }));
    out.events.push(ask);
  }
  return out;
}

/** The control_response that answers a can_use_tool request. */
export function permissionReply(rid, input, { allow, answers }) {
  const response = allow
    ? { behavior: 'allow', updatedInput: answers ? { ...input, answers } : input }
    : { behavior: 'deny', message: 'The owner denied this in the chat.' };
  return { type: 'control_response', response: { subtype: 'success', request_id: rid, response } };
}

export function createChats({ dir, cwd, env, command = 'claude', log = () => {} }) {
  mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  /** @type {Map<string, any>} loaded chats: {meta, events, subs, proc, pending, busy, idle} */
  const loaded = new Map();

  const readIndex = () => {
    try {
      const list = JSON.parse(readFileSync(indexFile, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (list) => {
    writeFileSync(`${indexFile}.tmp`, JSON.stringify(list, null, 1));
    renameSync(`${indexFile}.tmp`, indexFile);
  };
  const saveMeta = (meta) => writeIndex([meta, ...readIndex().filter((m) => m.id !== meta.id)]);

  function load(id) {
    if (!ID_RE.test(id)) return null;
    if (loaded.has(id)) return loaded.get(id);
    const meta = readIndex().find((m) => m.id === id);
    if (!meta) return null;
    let events = [];
    try {
      events = readFileSync(path.join(dir, `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      /* no events yet */
    }
    // Questions from a process that is gone cannot be answered any more.
    const open = new Set();
    for (const e of events) if (e.t === 'ask') open.add(e.rid);
    else if (e.t === 'answer' || e.t === 'expired') open.delete(e.rid);
    const chat = { meta, events, subs: new Set(), proc: null, pending: new Map(), busy: false, idle: null };
    loaded.set(id, chat);
    for (const rid of open) emit(chat, { t: 'expired', rid });
    return chat;
  }

  function emit(chat, event, persist = true) {
    if (persist) {
      event = { ...event, n: chat.events.length, at: Date.now() };
      chat.events.push(event);
      appendFileSync(path.join(dir, `${chat.meta.id}.jsonl`), `${JSON.stringify(event)}\n`);
    }
    for (const sub of chat.subs) sub(event);
  }

  function setBusy(chat, busy) {
    if (chat.busy === busy) return;
    chat.busy = busy;
    emit(chat, { t: 'state', busy }, false);
  }

  const running = () => [...loaded.values()].filter((c) => c.proc);

  function stopProc(chat) {
    chat.proc?.kill('SIGTERM');
  }

  function armIdle(chat) {
    clearTimeout(chat.idle);
    chat.idle = setTimeout(() => !chat.busy && stopProc(chat), IDLE_MS);
  }

  function start(chat) {
    // Too many conversations at once: the longest idle one quits (it resumes on its next message).
    const others = running().filter((c) => c !== chat && !c.busy);
    if (running().length >= MAX_RUNNING && others.length) stopProc(others[0]);
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    args.push('--permission-prompt-tool', 'stdio', '--append-system-prompt', SYSTEM);
    if (chat.meta.session) args.push('--resume', chat.meta.session);
    const proc = spawn(command, args, { cwd, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
    chat.proc = proc;
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    proc.stdin.on('error', () => {});
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const { events, delta, session, done } = translate(msg);
      if (session && session !== chat.meta.session) {
        chat.meta.session = session;
        saveMeta(chat.meta);
      }
      if (delta) emit(chat, { t: 'delta', text: delta }, false);
      for (const e of events) {
        if (e.t === 'ask') chat.pending.set(e.rid, msg.request.input ?? {});
        emit(chat, e);
      }
      if (done) {
        setBusy(chat, false);
        chat.meta.updated = Date.now();
        saveMeta(chat.meta);
        armIdle(chat);
      }
    });
    proc.on('error', (err) => emit(chat, { t: 'error', text: `claude: ${err.message}` }));
    proc.on('exit', (code, signal) => {
      clearTimeout(chat.idle);
      if (chat.proc === proc) chat.proc = null;
      for (const rid of chat.pending.keys()) emit(chat, { t: 'expired', rid });
      chat.pending.clear();
      if (chat.busy) {
        const why = stderr.trim().split('\n').slice(-3).join('\n');
        emit(chat, { t: 'error', text: `Claude Code stopped (${signal ?? `exit ${code}`})${why ? `: ${why}` : ''}` });
        setBusy(chat, false);
      }
      log(`chat ${chat.meta.id} process ended (${signal ?? code})`);
    });
    log(`chat ${chat.meta.id} process started${chat.meta.session ? ' (resumed)' : ''}`);
  }

  function send(chat, text) {
    emit(chat, { t: 'user', text });
    if (!chat.proc) start(chat);
    clearTimeout(chat.idle);
    setBusy(chat, true);
    chat.proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
  }

  return {
    list: () => readIndex().map((m) => ({ ...m, busy: !!loaded.get(m.id)?.busy })),
    get(id) {
      const chat = load(id);
      return chat && { chat: chat.meta, events: chat.events, busy: chat.busy, open: [...chat.pending.keys()] };
    },
    create(text) {
      const now = Date.now();
      const meta = { id: randomBytes(8).toString('hex'), title: text.replace(/\s+/g, ' ').trim().slice(0, 80), agent: 'claude', session: '', created: now, updated: now };
      saveMeta(meta);
      const chat = load(meta.id);
      send(chat, text);
      return meta.id;
    },
    send(id, text) {
      const chat = load(id);
      if (!chat) return false;
      send(chat, text);
      return true;
    },
    answer(id, rid, choice) {
      const chat = load(id);
      const input = chat?.pending.get(rid);
      if (!chat?.proc || !input) return false;
      chat.pending.delete(rid);
      chat.proc.stdin.write(`${JSON.stringify(permissionReply(rid, input, choice))}\n`);
      emit(chat, { t: 'answer', rid, allow: !!choice.allow, ...(choice.answers ? { answers: choice.answers } : {}) });
      return true;
    },
    stop(id) {
      const chat = load(id);
      if (!chat?.proc || !chat.busy) return false;
      chat.proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } })}\n`);
      return true;
    },
    remove(id) {
      const chat = load(id);
      if (!chat) return false;
      stopProc(chat);
      loaded.delete(id);
      writeIndex(readIndex().filter((m) => m.id !== id));
      rmSync(path.join(dir, `${id}.jsonl`), { force: true });
      return true;
    },
    subscribe(id, from, fn) {
      const chat = load(id);
      if (!chat) return null;
      for (const e of chat.events.slice(Math.max(0, from))) fn(e);
      fn({ t: 'state', busy: chat.busy });
      chat.subs.add(fn);
      return () => chat.subs.delete(fn);
    },
    /** Stops every process (server shutdown, tests). */
    close() {
      for (const c of loaded.values()) stopProc(c);
    }
  };
}

const readJson = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > MAX_TEXT * 2) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });

/** Handles /chat requests; returns false for other paths. `allowed(req)` checks the ticket. */
export async function handleChat(chats, req, res, allowed) {
  const url = new URL(req.url ?? '/', 'http://terminal');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'chat') return false;
  const reply = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (!allowed(req)) return reply(403, { error: 'forbidden' }), true;
  const [, id, action] = parts;
  const text = (v) => (typeof v === 'string' && v.trim() && v.length <= MAX_TEXT ? v : '');
  if (!id) {
    if (req.method === 'GET') return reply(200, { chats: chats.list() }), true;
    if (req.method === 'POST') {
      const t = text((await readJson(req)).text);
      return t ? reply(200, { id: chats.create(t) }) : reply(400, { error: 'text' }), true;
    }
    return reply(405, { error: 'method' }), true;
  }
  if (!ID_RE.test(id)) return reply(404, { error: 'not found' }), true;
  if (!action && req.method === 'GET') {
    const c = chats.get(id);
    return c ? reply(200, c) : reply(404, { error: 'not found' }), true;
  }
  if (!action && req.method === 'DELETE') return reply(chats.remove(id) ? 200 : 404, {}), true;
  if (action === 'stream' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const off = chats.subscribe(id, Number(url.searchParams.get('from')) || 0, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    if (!off) return res.end(), true;
    const beat = setInterval(() => res.write(': beat\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(beat);
      off();
    });
    return true;
  }
  if (req.method !== 'POST') return reply(405, { error: 'method' }), true;
  const body = await readJson(req);
  if (action === 'send') {
    const t = text(body.text);
    return reply(t && chats.send(id, t) ? 200 : 400, {}), true;
  }
  if (action === 'answer') {
    const answers = body.answers && typeof body.answers === 'object' ? Object.fromEntries(Object.entries(body.answers).map(([k, v]) => [String(k), String(v)])) : undefined;
    return reply(chats.answer(id, String(body.rid ?? ''), { allow: body.allow === true, answers }) ? 200 : 409, {}), true;
  }
  if (action === 'stop') return reply(chats.stop(id) ? 200 : 409, {}), true;
  return reply(404, { error: 'not found' }), true;
}

export const chatsDir = (home) => path.join(home, '.beni', 'chats');
