import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('after login', () => {
  it('stays on this site', () => {
    expect(safeNext('/health?metric=hrv')).toBe('/health?metric=hrv');
    expect(safeNext(null)).toBe('/');
    for (const bad of ['//evil.com', '/\\evil.com', '/\\/evil.com', 'https://evil.com', 'evil.com', '/%5Cevil.com\\x'])
      expect(safeNext(bad)).toBe('/');
  });
});
