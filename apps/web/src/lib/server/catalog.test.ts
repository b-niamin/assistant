import { describe, expect, it } from 'vitest';
import { parseCatalog } from './catalog';

describe('extensions catalog', () => {
  it('keeps well-formed entries only and trims the rest', () => {
    const c = parseCatalog({
      extensions: [{ id: 'gym', name: 'Gym', kind: 'onefile', service: 'yes' }, { id: '../x' }, null],
      inspirations: [{ id: 'calendar', name: 'Cal', scope: 'shared', description: 'd' }]
    });
    expect(c.extensions).toEqual([{ id: 'gym', name: 'Gym', description: '', kind: 'onefile', scope: 'profile', service: false }]);
    expect(c.inspirations[0]).toMatchObject({ id: 'calendar', scope: 'shared', idea: 'd' });
    expect(parseCatalog('nope')).toEqual({ extensions: [], inspirations: [] });
  });
});
