/**
 * The single app password. Stored in env as `scrypt:<salt hex>:<hash hex>` (no `$`, because
 * docker compose interpolates `$` in .env). Generate with `npm run hash-password`.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, KEYLEN).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
