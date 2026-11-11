import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { injectShim, inlineJson, KV_MESSAGE, shimScript } from './onefile';

function runShim(data: Record<string, string>, versions: Record<string, number> = {}) {
  const all: { msg: Record<string, unknown>; origin: string }[] = [];
  const window: Record<string, unknown> = {};
  window.parent = { postMessage: (msg: Record<string, unknown>, origin: string) => all.push({ msg, origin }) };
  runInNewContext(shimScript(data, 'https://nas.example', versions), { window, Object, Proxy, String });
  // The first message hands the host the versions the data was loaded at; the rest are the writes.
  const hello = all.shift();
  return { ls: window.localStorage as Storage, ss: window.sessionStorage as Storage, posted: all, hello };
}

describe('storage shim', () => {
  it('tells the host the versions its data was loaded at', () => {
    const { hello } = runShim({ a: '1' }, { a: 4 });
    expect(hello).toMatchObject({ origin: 'https://nas.example', msg: { op: 'hello', versions: { a: 4 }, [KV_MESSAGE]: 1 } });
  });
  it('starts from the stored data and posts every write to the shell origin', () => {
    const { ls, posted } = runShim({ a: '1' });
    expect(ls.getItem('a')).toBe('1');
    expect(ls.getItem('missing')).toBeNull();
    ls.setItem('b', '2');
    ls.removeItem('a');
    expect(ls.length).toBe(1);
    expect(ls.key(0)).toBe('b');
    expect(posted.map((p) => p.msg.op)).toEqual(['set', 'remove']);
    expect(posted[0]).toMatchObject({ origin: 'https://nas.example', msg: { key: 'b', value: '2', [KV_MESSAGE]: 1 } });
  });
  it('supports property access like real Storage', () => {
    const { ls, posted } = runShim({});
    (ls as unknown as Record<string, string>).x = 'y';
    expect(ls.getItem('x')).toBe('y');
    expect(Object.keys(ls)).toEqual(['x']);
    ls.clear();
    expect(ls.length).toBe(0);
    expect(posted.map((p) => p.msg.op)).toEqual(['set', 'clear']);
  });
  it('keeps sessionStorage in memory only', () => {
    const { ss, posted } = runShim({});
    ss.setItem('t', '1');
    expect(ss.getItem('t')).toBe('1');
    expect(posted).toEqual([]);
  });
});

describe('injection', () => {
  it('cannot be broken out of with </script> in stored data', () => {
    const json = inlineJson({ k: '</script><script>alert(1)</script>' });
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json)).toEqual({ k: '</script><script>alert(1)</script>' });
  });
  it('puts the shim first in <head>', () => {
    const out = injectShim('<!doctype html><html><head><meta charset="utf-8"><script>app()</script></head></html>', {}, 'o');
    expect(out.indexOf('Object.defineProperty(window')).toBeLessThan(out.indexOf('app()'));
    expect(out.startsWith('<!doctype html><html><head><script>')).toBe(true);
  });
});
