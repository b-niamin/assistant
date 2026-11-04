import { describe, expect, it } from 'vitest';
import { applyLayout, parseLayout } from './layout';

const tiles = ['a:x', 'b:y', 'c:z', 'd:new'].map((key) => ({ key }));

describe('dashboard layout', () => {
  it('keeps the default order without rows', () => {
    expect(applyLayout(tiles, []).map((t) => t.key)).toEqual(['a:x', 'b:y', 'c:z', 'd:new']);
  });
  it('sorts by saved position, puts unplaced tiles last, flags hidden ones', () => {
    const out = applyLayout(tiles, [
      { tile_key: 'c:z', position: 0, hidden: false },
      { tile_key: 'a:x', position: 1, hidden: true },
      { tile_key: 'b:y', position: 2, hidden: false }
    ]);
    expect(out.map((t) => t.key)).toEqual(['c:z', 'a:x', 'b:y', 'd:new']);
    expect(out.find((t) => t.key === 'a:x')?.hidden).toBe(true);
  });
  it('parses the editor form, dropping bad and duplicate keys', () => {
    expect(parseLayout(['b:y', 'bad key', 'a:x', 'b:y'], ['a:x', 'zzz'])).toEqual([
      { tile_key: 'b:y', position: 0, hidden: false },
      { tile_key: 'a:x', position: 1, hidden: true }
    ]);
  });
});
