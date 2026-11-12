/**
 * The app's logs in one place (System settings -> Logs): every *.log in the shared `logs` volume (web,
 * updater, extension migrations and services), the tail of each, and all of them merged by time.
 */
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface LogLine {
  file: string;
  /** ms since epoch, from the line or the last timestamped line above it; 0 when none yet. */
  at: number;
  text: string;
}

const TAIL_BYTES = 128 * 1024;
const TS = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,](\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** The time a log line names: ISO (`2026-11-09T13:38:45.128Z`) or Python's `2026-11-09 12:56:07,448` (local). */
export function lineTime(line: string): number {
  const m = TS.exec(line);
  if (!m) return 0;
  const ms = m[3] ? `.${m[3].padEnd(3, '0').slice(0, 3)}` : '';
  return Date.parse(`${m[1]}T${m[2]}${ms}${m[4] ?? ''}`) || 0;
}

/** Lines of one log's tail: a line without its own time takes the one above it. */
export function parseLog(file: string, text: string): LogLine[] {
  let at = 0;
  const out: LogLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(ANSI, '').replace(/\r/g, '').trimEnd();
    if (!line) continue;
    at = lineTime(line) || at;
    out.push({ file, at, text: line });
  }
  return out;
}

/** All logs merged by time (stable: lines of one file keep their order), the newest `limit`. */
export function mergeLogs(logs: LogLine[][], limit: number): LogLine[] {
  const all = logs.flatMap((lines) => lines.map((l, i) => ({ l, i })));
  all.sort((a, b) => a.l.at - b.l.at || (a.l.file === b.l.file ? a.i - b.i : 0));
  return all.slice(-limit).map((x) => x.l);
}

async function tail(file: string): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    // Drop the first, probably cut, line when this is not the start of the file.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await fh.close();
  }
}

/** Every *.log of the shared `logs` volume, and the worker's (one per extension service or job, `<ext>.<unit>.log`). */
export async function readLogs(
  dir = process.env.LOGS_DIR ?? '/logs',
  workerDir = path.join(process.env.WORKER_DIR ?? '/worker', 'logs')
): Promise<{ files: string[]; lines: Record<string, LogLine[]> }> {
  const list = async (d: string) => (await readdir(d).catch(() => [] as string[])).filter((n) => n.endsWith('.log')).map((n): [string, string] => [n, path.join(d, n)]);
  const found = new Map([...(await list(workerDir)), ...(await list(dir))]);
  const names = [...found.keys()].sort();
  const lines: Record<string, LogLine[]> = {};
  for (const n of names) lines[n] = parseLog(n, await tail(found.get(n)!).catch(() => ''));
  return { files: names, lines };
}
