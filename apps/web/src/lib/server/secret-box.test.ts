import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ SECRETS_KEY: undefined }));
const { decrypt, encrypt, secretsAvailable } = await import('./secret-box');

describe('secret encryption', () => {
  const k = randomBytes(32);
  it('round-trips and uses a fresh IV every time', () => {
    const a = encrypt('sk-test-123', '', k);
    expect(a).not.toBe(encrypt('sk-test-123', '', k));
    expect(decrypt(a, '', k)).toBe('sk-test-123');
  });
  it('rejects a tampered ciphertext or another key', () => {
    const blob = Buffer.from(encrypt('sk-test-123', '', k), 'base64');
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob.toString('base64'), '', k)).toThrow();
    expect(() => decrypt(encrypt('x', '', k), '', randomBytes(32))).toThrow();
  });
  it('binds a value to its extension and name', () => {
    const v = encrypt('token', 'home:token', k);
    expect(v.startsWith('v2:')).toBe(true);
    expect(decrypt(v, 'home:token', k)).toBe('token');
    expect(() => decrypt(v, 'health:token', k)).toThrow();
    // Values saved before AAD still read.
    expect(decrypt(encrypt('old', '', k), 'home:token', k)).toBe('old');
  });
  it('is off without SECRETS_KEY', () => expect(secretsAvailable()).toBe(false));
});
