/** DB-backed opaque sessions for the single app password (core.sessions). */
import { randomBytes } from 'node:crypto';
import { db } from './db';

export const SESSION_COOKIE = 'sid';
export const PROFILE_COOKIE = 'profile';
export const SESSION_DAYS = 30;

export async function createSession(userAgent: string | null, ip: string | null): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await db()`INSERT INTO core.sessions (id, expires_at, user_agent, ip_address)
             VALUES (${id}, now() + make_interval(days => ${SESSION_DAYS}), ${userAgent}, ${ip})`;
  return id;
}

export async function isValidSession(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const rows = await db()`SELECT 1 FROM core.sessions WHERE id = ${id} AND expires_at > now()`;
  return rows.length > 0;
}

export async function deleteSession(id: string | undefined): Promise<void> {
  if (id) await db()`DELETE FROM core.sessions WHERE id = ${id}`;
}

/** After a password change: every other device has to log in again with the new password. */
export async function deleteOtherSessions(keep: string | undefined): Promise<number> {
  const rows = await db()`DELETE FROM core.sessions WHERE id <> ${keep ?? ''} RETURNING 1`;
  return rows.length;
}

export async function listProfiles(): Promise<{ id: string; name: string }[]> {
  return db()<{ id: string; name: string }[]>`SELECT id, name FROM core.profiles ORDER BY name`;
}

/** Minutes System settings stay unlocked after typing the app password again. */
export const ELEVATION_MINUTES = 10;

export async function elevateSession(id: string): Promise<void> {
  await db()`UPDATE core.sessions SET elevated_until = now() + make_interval(mins => ${ELEVATION_MINUTES})
             WHERE id = ${id} AND expires_at > now()`;
}

export async function isElevated(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const rows = await db()`SELECT 1 FROM core.sessions
                          WHERE id = ${id} AND expires_at > now() AND elevated_until > now()`;
  return rows.length > 0;
}

export async function dropElevation(id: string | undefined): Promise<void> {
  if (id) await db()`UPDATE core.sessions SET elevated_until = NULL WHERE id = ${id}`;
}
