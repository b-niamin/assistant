/** Postgres client for the web app (role app_rw; search_path = core, health). */
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

let client: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!client) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    client = postgres(env.DATABASE_URL, { max: 5, idle_timeout: 30 });
  }
  return client;
}
