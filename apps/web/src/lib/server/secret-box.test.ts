import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ SECRETS_KEY: undefined }));
const { decrypt, encrypt, secretsAvailable } = await import('./secret-box');

describe('secret encryption', () => {
  const k = randomBytes(32);
  it('round-trips and uses a fresh IV every time', () => {
    const a = encrypt('sk-test-123', k);
    expect(a).not.toBe(encrypt('sk-test-123', k));
    expect(decrypt(a, k)).toBe('sk-test-123');
  });
  it('rejects a tampered ciphertext or another key', () => {
    const blob = Buffer.from(encrypt('sk-test-123', k), 'base64');
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob.toString('base64'), k)).toThrow();
    expect(() => decrypt(encrypt('x', k), randomBytes(32))).toThrow();
  });
  it('is off without SECRETS_KEY', () => expect(secretsAvailable()).toBe(false));
});
