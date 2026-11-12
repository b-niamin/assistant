/**
 * The files other processes leave for the app (audit R5): the updater's, the worker's and the backup
 * service's status, and the requests the app leaves for them. One way to read them (missing or garbled =
 * null, never an exception) and one way to write them (a temporary file renamed over the target, so a
 * reader never sees half a file).
 */
import { readFile, rename, writeFile } from 'node:fs/promises';

/** The file's text, '' when it is missing or unreadable. */
export const readText = (file: string): Promise<string> => readFile(file, 'utf8').catch(() => '');

/** A JSON object, or null when the text is not one. */
export function jsonObject(raw: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(raw);
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Reads a status file through its parser. */
export async function readStatus<T>(file: string, parse: (raw: string) => T | null): Promise<T | null> {
  return parse(await readText(file));
}

/** Replaces a file whole: written next to it, then renamed over it. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await writeFile(`${file}.tmp`, content, { mode: 0o644 });
  await rename(`${file}.tmp`, file);
}

/** A string field cut to `max`, '' when it is not a string. */
export const text = (v: unknown, max = 300): string => (typeof v === 'string' ? v.slice(0, max) : '');
