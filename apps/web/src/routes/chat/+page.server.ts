import type { PageServerLoad } from './$types';
import { grantChat, hasChatGrant } from '#lib/server/chat-grant.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { sidecarsConfigured, terminalStatus } from '#lib/server/sidecars.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  const sid = cookies.get(SESSION_COOKIE);
  const elevated = await isElevated(sid);
  if (elevated && sid) grantChat(sid);
  const status = await terminalStatus();
  return {
    configured: sidecarsConfigured(),
    reachable: status.reachable,
    signedIn: status.claude,
    canAct: elevated || hasChatGrant(sid)
  };
};
