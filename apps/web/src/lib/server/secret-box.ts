/**
 * AES-256-GCM for values stored in the `secrets` schema (extension secrets). The key comes from
 * SECRETS_KEY in .env (any long random string, hashed to 256 bits); it never reaches the database.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import * as env from '$app/env/private';

function key(): Buffer {
  const raw = env.SECRETS_KEY ?? '';
  if (raw.length < 32) throw new Error('SECRETS_KEY is not set (32+ random characters in .env)');
  return createHash('sha256').update(raw).digest();
}

export const secretsAvailable = (): boolean => (env.SECRETS_KEY ?? '').length >= 32;

/**
 * `aad` names what the value is (e.g. "home:token"): a ciphertext copied to another extension or name
 * no longer decrypts. Such values start with "v2:"; older ones (no prefix, no AAD) still decrypt, and
 * are re-encrypted the next time they are saved.
 */
export function encrypt(plain: string, aad = '', k: Buffer = key()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const blob = Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
  return aad ? `v2:${blob}` : blob;
}

export function decrypt(stored: string, aad = '', k: Buffer = key()): string {
  const v2 = stored.startsWith('v2:');
  const buf = Buffer.from(v2 ? stored.slice(3) : stored, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
  if (v2) d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
