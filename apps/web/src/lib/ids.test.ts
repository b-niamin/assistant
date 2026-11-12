import { describe, expect, it } from 'vitest';
import { EXTENSION_ID_RE, inputPattern, PROFILE_ID_RE } from './ids.js';

describe('ids', () => {
  it('extension ids', () => {
    for (const ok of ['health', 'my-notes', 'a1']) expect(EXTENSION_ID_RE.test(ok)).toBe(true);
    for (const bad of ['a--b', 'a-', '1a', 'A', 'a_b']) expect(EXTENSION_ID_RE.test(bad)).toBe(false);
  });
  it('profile ids', () => {
    expect(PROFILE_ID_RE.test('piotr')).toBe(true);
    expect(PROFILE_ID_RE.test('a'.repeat(33))).toBe(false);
  });
  it('gives a pattern the browser accepts with the v flag', () => {
    const p = inputPattern(PROFILE_ID_RE);
    expect(p).toBe('[a-z][a-z0-9\\-]{0,31}');
    expect(() => new RegExp(`^(?:${p})$`, 'v')).not.toThrow();
    expect(new RegExp(`^(?:${p})$`, 'v').test('ola-2')).toBe(true);
  });
});
