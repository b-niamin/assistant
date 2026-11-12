import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonObject, readStatus, writeAtomic } from './status-files';

describe('status files', () => {
  it('reads only JSON objects', () => {
    expect(jsonObject('{"a":1}')).toEqual({ a: 1 });
    for (const bad of ['', 'nope', '[1]', 'null', '3']) expect(jsonObject(bad)).toBeNull();
  });
  it('writes whole files and reads them back', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'status-'));
    const file = path.join(dir, 's.json');
    expect(await readStatus(file, jsonObject)).toBeNull();
    await writeAtomic(file, '{"status":"ok"}');
    expect(readFileSync(file, 'utf8')).toBe('{"status":"ok"}');
    expect(readdirSync(dir)).toEqual(['s.json']);
    expect(await readStatus(file, jsonObject)).toEqual({ status: 'ok' });
  });
});
