/**
 * AES-256-GCM for values stored in the `secrets` schema (extension secrets). The key comes from
 * SECRETS_KEY in .env (any long random string, hashed to 256 bits); it never reaches the database.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

function key(): Buffer {
  const raw = env.SECRETS_KEY ?? '';
  if (raw.length < 32) throw new Error('SECRETS_KEY is not set (32+ random characters in .env)');
  return createHash('sha256').update(raw).digest();
}

export const secretsAvailable = (): boolean => (env.SECRETS_KEY ?? '').length >= 32;

export function encrypt(plain: string, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

export function decrypt(blob: string, k: Buffer = key()): string {
  const buf = Buffer.from(blob, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
