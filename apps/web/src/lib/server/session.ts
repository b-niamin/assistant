/**
 * DB-backed opaque sessions for the single app password (core.sessions). The table keeps only a hash of
 * the cookie (migration 013), so a copy of the database holds no working login. A session lasts
 * SESSION_DAYS from its last use: an active browser stays signed in, an idle one runs out.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';

export const SESSION_COOKIE = 'sid';
export const PROFILE_COOKIE = 'profile';
export const SESSION_DAYS = 30;

/** What the table stores for a cookie value. */
export const sessionKey = (id: string): string => `h:${createHash('sha256').update(id).digest('hex')}`;
const k = (id: string | undefined) => sessionKey(id ?? '');

export async function createSession(userAgent: string | null, ip: string | null): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await db()`INSERT INTO core.sessions (id, expires_at, user_agent, ip_address)
             VALUES (${k(id)}, now() + make_interval(days => ${SESSION_DAYS}), ${userAgent}, ${ip})`;
  return id;
}

/** 'ok', 'renewed' (pushed SESSION_DAYS ahead again: send the cookie anew) or 'no'. Renews once a day. */
export async function checkSession(id: string | undefined): Promise<'ok' | 'renewed' | 'no'> {
  if (!id || id.length > 200) return 'no';
  const [row] = await db()<{ renewed: boolean }[]>`
    WITH s AS (SELECT id FROM core.sessions WHERE id = ${k(id)} AND expires_at > now()),
         r AS (UPDATE core.sessions SET expires_at = now() + make_interval(days => ${SESSION_DAYS})
               WHERE id IN (SELECT id FROM s) AND expires_at < now() + make_interval(days => ${SESSION_DAYS - 1}) RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM r) AS renewed FROM s`;
  return !row ? 'no' : row.renewed ? 'renewed' : 'ok';
}

export async function isValidSession(id: string | undefined): Promise<boolean> {
  return (await checkSession(id)) !== 'no';
}

export async function deleteSession(id: string | undefined): Promise<void> {
  if (id) await db()`DELETE FROM core.sessions WHERE id = ${k(id)}`;
}

/** After a password change: every other device has to log in again with the new password. */
export async function deleteOtherSessions(keep: string | undefined): Promise<number> {
  const rows = await db()`DELETE FROM core.sessions WHERE id <> ${k(keep)} RETURNING 1`;
  return rows.length;
}

export async function listProfiles(): Promise<{ id: string; name: string }[]> {
  return db()<{ id: string; name: string }[]>`SELECT id, name FROM core.profiles ORDER BY name`;
}

/** Minutes System settings stay unlocked after typing the app password again. */
export const ELEVATION_MINUTES = 10;

export async function elevateSession(id: string): Promise<void> {
  await db()`UPDATE core.sessions SET elevated_until = now() + make_interval(mins => ${ELEVATION_MINUTES})
             WHERE id = ${k(id)} AND expires_at > now()`;
}

export async function isElevated(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const rows = await db()`SELECT 1 FROM core.sessions
                          WHERE id = ${k(id)} AND expires_at > now() AND elevated_until > now()`;
  return rows.length > 0;
}

export async function dropElevation(id: string | undefined): Promise<void> {
  if (id) await db()`UPDATE core.sessions SET elevated_until = NULL WHERE id = ${k(id)}`;
}
