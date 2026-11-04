import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: () => { throw new Error('no db in unit tests'); } }));
vi.mock('./generated/registry', () => ({ EXTENSIONS: [] }));

const { mergeExtensions, visibleTo } = await import('./registry.server');
import type { ExtensionInfo } from './types';

const health: ExtensionInfo = {
  id: 'health', name: 'Training & Health', description: '', version: '0.2.0', kind: 'native', scope: 'profile',
  href: '/health', entry: null, profiles: null, inspiredBy: null, settingsPage: false, settings: [], secrets: [], enabled: true
};

describe('mergeExtensions', () => {
  it('applies the switches from settings', () => {
    const [h] = mergeExtensions([health], [{ extension_id: 'health', enabled: true, profiles: ['alex'] }]);
    expect(visibleTo(h, 'alex')).toBe(true);
    expect(visibleTo(h, 'sam')).toBe(false);
    const [off] = mergeExtensions([health], [{ extension_id: 'health', enabled: false, profiles: null }]);
    expect(visibleTo(off, 'alex')).toBe(false);
  });
});
