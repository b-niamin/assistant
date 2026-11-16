/**
 * POST {service} -> asks the host's updater to restart one part (the chat's "Restart the terminal").
 * The same request as the Infrastructure page's Restart; needs the unlocked session.
 */
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requestServiceRestart } from '#lib/server/infrastructure.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw error(403, 'locked');
  const body = (await request.json().catch(() => ({}))) as { service?: unknown };
  if (!(await requestServiceRestart(String(body.service ?? '')))) throw error(400, 'not restartable');
  return json({ ok: true });
};
