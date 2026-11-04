import { error, redirect, type Handle } from '@sveltejs/kit';
import { extensionForPath, visibleTo } from '$lib/extensions/registry.server';
import { defaultProfile, isConfigured } from '$lib/server/app-config';
import { claudeTokenMatches } from '$lib/server/claude-token';
import { isValidSession, PROFILE_COOKIE, SESSION_COOKIE } from '$lib/server/session';

const PUBLIC_PATHS = new Set(['/login', '/healthz', '/setup']);

export const handle: Handle = async ({ event, resolve }) => {
  // Fresh install: nothing works until the first-run wizard has set the app password.
  if (event.url.pathname !== '/healthz' && event.url.pathname !== '/setup' && !(await isConfigured()))
    throw redirect(303, '/setup');
  event.locals.profileId = event.cookies.get(PROFILE_COOKIE) || (await defaultProfile());

  // Tools for Claude (spec 005): a bearer token, never a browser session.
  if (event.url.pathname === '/api/claude') {
    if (!claudeTokenMatches(event.request.headers.get('authorization'))) throw error(401, 'Bearer CLAUDE_TOOLS_TOKEN required');
    event.locals.profileId = await defaultProfile();
    event.locals.authenticated = false;
    return resolve(event);
  }

  event.locals.authenticated = await isValidSession(event.cookies.get(SESSION_COOKIE));

  if (!event.locals.authenticated && !PUBLIC_PATHS.has(event.url.pathname)) {
    const next = event.url.pathname + event.url.search;
    throw redirect(303, `/login?next=${encodeURIComponent(next)}`);
  }

  // An extension limited to some profiles does not exist for the others.
  if (event.locals.authenticated) {
    const ext = await extensionForPath(event.url.pathname);
    if (ext && !visibleTo(ext, event.locals.profileId)) throw error(404, 'Not found');
  }

  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'same-origin');
  // Pages get frame-ancestors 'none' from kit.csp; this covers endpoints too. SAMEORIGIN, not DENY:
  // the onefile host embeds /api/onefile/<id> in a same-origin iframe.
  if (!response.headers.has('X-Frame-Options')) response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  return response;
};
