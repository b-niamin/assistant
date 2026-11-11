/** Postgres client for the web app (role app_rw; search_path = core, health). */
import postgres from 'postgres';
import * as env from '$app/env/private';

let client: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!client) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    // The session time zone is the app's (TZ = APP_TIMEZONE): current_date and date_trunc then mean the
    // owner's day, not UTC's (between midnight and 1-2 a.m. "today" was yesterday).
    client = postgres(env.DATABASE_URL, { max: 5, idle_timeout: 30, connection: { TimeZone: process.env.TZ || 'UTC' } });
  }
  return client;
}
