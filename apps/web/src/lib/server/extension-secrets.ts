/**
 * Secrets of native extensions (spec 004): values an admin enters in System settings for the names an
 * extension declares in its manifest ("secrets": ["token"]). Encrypted with SECRETS_KEY (secret-box.ts).
 * An extension reads only its own declared names, through ctx.secrets.get(name).
 */
import { decrypt, encrypt } from './secret-box';
export { secretsAvailable } from './secret-box';
import { db } from './db';
import type { ExtensionInfo } from '$lib/extensions/types';

export interface SecretSlot {
  extensionId: string;
  extensionName: string;
  name: string;
  keyHint: string | null;
  updatedAt: Date | null;
}

const hint = (v: string) => (v.length > 8 ? v.slice(-4) : '');

/** Every declared secret of every native extension, with whether a value is set (never the value). */
export async function listSecretSlots(extensions: ExtensionInfo[]): Promise<SecretSlot[]> {
  const rows = await db()<{ extension_id: string; name: string; key_hint: string; updated_at: Date }[]>`
    SELECT extension_id, name, key_hint, updated_at FROM secrets.extension_secrets`;
  const set = new Map(rows.map((r) => [`${r.extension_id}/${r.name}`, r]));
  return extensions.flatMap((e) =>
    (e.kind === 'native' ? e.secrets : []).map((name) => {
      const r = set.get(`${e.id}/${name}`);
      return { extensionId: e.id, extensionName: e.name, name, keyHint: r?.key_hint ?? null, updatedAt: r?.updated_at ?? null };
    })
  );
}

function assertDeclared(ext: ExtensionInfo, name: string): void {
  if (ext.kind !== 'native' || !ext.secrets.includes(name)) {
    throw new Error(`extension ${ext.id} does not declare a secret named "${name}"`);
  }
}

export async function setSecret(ext: ExtensionInfo, name: string, value: string): Promise<void> {
  assertDeclared(ext, name);
  if (!value || value.length > 8192) throw new Error('A secret is 1 to 8192 characters.');
  await db()`INSERT INTO secrets.extension_secrets (extension_id, name, ciphertext, key_hint)
             VALUES (${ext.id}, ${name}, ${encrypt(value)}, ${hint(value)})
             ON CONFLICT (extension_id, name)
             DO UPDATE SET ciphertext = EXCLUDED.ciphertext, key_hint = EXCLUDED.key_hint, updated_at = now()`;
}

export async function deleteSecret(ext: ExtensionInfo, name: string): Promise<void> {
  assertDeclared(ext, name);
  await db()`DELETE FROM secrets.extension_secrets WHERE extension_id = ${ext.id} AND name = ${name}`;
}

/** For ctx.secrets.get: the plaintext, or null when not set. Throws for an undeclared name. */
export async function readSecret(ext: ExtensionInfo, name: string): Promise<string | null> {
  assertDeclared(ext, name);
  const rows = await db()<{ ciphertext: string }[]>`
    SELECT ciphertext FROM secrets.extension_secrets WHERE extension_id = ${ext.id} AND name = ${name}`;
  return rows.length ? decrypt(rows[0].ciphertext) : null;
}
