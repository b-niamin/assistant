import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: () => { throw new Error('no db in unit tests'); } }));
const { coerce } = await import('./config.server');
import { injectShim } from './onefile';

describe('settings values', () => {
  it('coerces form input to the field type', () => {
    expect(coerce({ name: 'n', label: 'N', type: 'number' }, '2,5')).toBe(2.5);
    expect(coerce({ name: 'b', label: 'B', type: 'boolean' }, 'on')).toBe(true);
    expect(coerce({ name: 'b', label: 'B', type: 'boolean' }, null)).toBe(false);
    expect(coerce({ name: 't', label: 'T', type: 'text' }, '  ')).toBeNull();
    expect(coerce({ name: 's', label: 'S', type: 'select', options: ['a', 'b'] }, 'b')).toBe('b');
  });
  it('rejects bad input', () => {
    expect(() => coerce({ name: 'n', label: 'N', type: 'number' }, 'abc')).toThrow(/number/);
    expect(() => coerce({ name: 's', label: 'S', type: 'select', options: ['a'] }, 'z')).toThrow(/options/);
  });
  it('gives a onefile app its settings as a frozen global', () => {
    const html = injectShim('<html><head></head></html>', {}, 'o', { unit: 'kg', '</script>': 1 });
    expect(html).toContain('window.assistantSettings = Object.freeze(');
    expect(html).not.toContain('</script>":');
  });
});
