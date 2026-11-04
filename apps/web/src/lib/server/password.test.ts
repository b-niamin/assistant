import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('app password', () => {
  it('verifies the right password and rejects others', () => {
    const h = hashPassword('correct horse battery');
    expect(h).not.toContain('$');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
  it('rejects a missing or malformed hash', () => {
    expect(verifyPassword('x', undefined)).toBe(false);
    expect(verifyPassword('x', 'plain-text')).toBe(false);
  });
});
