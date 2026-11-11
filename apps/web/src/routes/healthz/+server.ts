/**
 * Liveness for compose, beni.sh status and the updater: 200 "ok" when the app answers and the database
 * does (SELECT 1 within 3 s), 503 otherwise.
 */
import { db } from '#lib/server/db.ts';

const timeout = (ms: number) => new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), ms));

export const GET = async () => {
  try {
    await Promise.race([db()`SELECT 1`, timeout(3000)]);
    return new Response('ok', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
  } catch (e) {
    return new Response(`database: ${e instanceof Error ? e.message : 'down'}`, {
      status: 503,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' }
    });
  }
};
