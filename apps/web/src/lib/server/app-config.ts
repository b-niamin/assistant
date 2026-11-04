/**
 * The app password: APP_PASSWORD_HASH from the environment if set (the original setup), otherwise the
 * hash stored by the first-run wizard in secrets.app_config. No password anywhere = not configured yet,
 * and every page redirects to /setup.
 */
import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { hashPassword } from './password';

let cached: string | null = null;

export async function passwordHash(): Promise<string | undefined> {
  if (env.APP_PASSWORD_HASH) return env.APP_PASSWORD_HASH;
  if (cached) return cached;
  const [row] = await db()<{ value: string }[]>`SELECT value FROM secrets.app_config WHERE key = 'app_password_hash'`;
  cached = row?.value ?? null;
  return cached ?? undefined;
}

export const isConfigured = async (): Promise<boolean> => !!(await passwordHash());

/** True when the password is managed in .env, so the web UI must not change it. */
export const passwordFromEnv = (): boolean => !!env.APP_PASSWORD_HASH;

export async function setPassword(password: string): Promise<void> {
  const hash = hashPassword(password);
  await db()`INSERT INTO secrets.app_config (key, value) VALUES ('app_password_hash', ${hash})
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  cached = hash;
}

export function passwordProblem(password: string, repeat: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password.length > 200) return 'That is too long.';
  if (password !== repeat) return 'The two passwords differ.';
  return null;
}

/** The one-time code printed by install.sh (SETUP_TOKEN), compared in constant time. */
export function setupTokenMatches(given: string): boolean {
  const want = env.SETUP_TOKEN ?? '';
  if (want.length < 16) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const setupTokenSet = (): boolean => (env.SETUP_TOKEN ?? '').length >= 16;

/** The profile used when none is picked: DEFAULT_PROFILE if set, else the first one (made by /setup). */
export async function defaultProfile(): Promise<string> {
  if (env.DEFAULT_PROFILE) return env.DEFAULT_PROFILE;
  const [row] = await db()<{ id: string }[]>`SELECT id FROM core.profiles ORDER BY created_at, id LIMIT 1`;
  return row?.id ?? 'me';
}
