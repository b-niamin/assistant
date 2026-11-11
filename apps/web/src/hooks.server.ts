import { error, redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { randomBytes } from 'node:crypto';
import { extensionForPath, visibleTo } from '#lib/extensions/registry.server.ts';
import { isMcpPath } from '#lib/mcp/paths.js';
import { defaultProfile, isConfigured } from '#lib/server/app-config.ts';
import { canonicalRedirect } from '#lib/server/canonical-origin.ts';
import { checkSession, isElevated, listProfiles, PROFILE_COOKIE, SESSION_COOKIE, SESSION_DAYS } from '#lib/server/session.ts';
import { htmlTag, parseTheme, THEME_COOKIE } from '#lib/theme.ts';
import { LANG_COOKIE, pickLanguage } from '#lib/i18n/languages.ts';
import { languageSettings } from '#lib/server/languages.ts';

const PUBLIC_PATHS = new Set(['/login', '/healthz', '/setup']);

export const handle: Handle = async ({ event, resolve }) => {
  // The MCP server and its OAuth (spec 005): their own bearer tokens, never the session.
  if (isMcpPath(event.url.pathname)) {
    event.locals.authenticated = false;
    event.locals.profileId = await defaultProfile();
    event.locals.theme = parseTheme(undefined);
    const response = await resolve(event);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }
  // server.mjs lets only the paths above in from the internet; anything else from there is a bug.
  if (event.request.headers.get('x-beni-public') === '1') throw error(404, 'Not found');

  // Opened under another port than PUBLIC_ORIGIN's: go there, or every form would fail the CSRF check.
  // Tailscale Serve keeps the browser's Host and sets X-Forwarded-Host; either only ever leads to ORIGIN.
  const host = event.request.headers.get('x-forwarded-host') ?? event.request.headers.get('host');
  const canonical = canonicalRedirect(event.request.method, host, event.url.pathname + event.url.search);
  if (canonical) throw redirect(308, canonical);

  // Fresh install: nothing works until the first-run wizard has set the app password.
  if (event.url.pathname !== '/healthz' && event.url.pathname !== '/setup' && !(await isConfigured()))
    throw redirect(303, '/setup');
  // The profile in the cookie may be gone (removed, renamed): fall back to the default one.
  const picked = event.cookies.get(PROFILE_COOKIE);
  if (picked && !(await listProfiles()).some((p) => p.id === picked)) event.cookies.delete(PROFILE_COOKIE, { path: '/' });
  event.locals.profileId = (picked && event.cookies.get(PROFILE_COOKIE)) || (await defaultProfile());
  event.locals.theme = parseTheme(event.cookies.get(THEME_COOKIE));
  // The language of the page (spec 007): this browser's pick from the user menu, else the default.
  event.locals.lang =
    event.url.pathname === '/healthz' ? 'en' : pickLanguage(await languageSettings(), event.cookies.get(LANG_COOKIE));

  const sid = event.cookies.get(SESSION_COOKIE);
  const session = await checkSession(sid);
  event.locals.authenticated = session !== 'no';
  // An active browser stays signed in: the session moved SESSION_DAYS ahead, so does the cookie.
  if (session === 'renewed' && sid)
    event.cookies.set(SESSION_COOKIE, sid, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: event.url.protocol === 'https:',
      maxAge: SESSION_DAYS * 24 * 3600
    });

  if (!event.locals.authenticated && !PUBLIC_PATHS.has(event.url.pathname)) {
    const next = event.url.pathname + event.url.search;
    throw redirect(303, `/login?next=${encodeURIComponent(next)}`);
  }

  // System settings below /settings need the unlocked session: one guard here for every page and
  // endpoint read, so a new one cannot forget it (its actions still check, and answer "Unlock first").
  const sub = event.url.pathname.startsWith('/settings/') ? event.url.pathname.slice('/settings/'.length) : '';
  if (sub && event.locals.authenticated && (event.request.method === 'GET' || event.request.method === 'HEAD') && !(await isElevated(sid))) {
    if (/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(sub) && !sub.endsWith('/sources')) throw redirect(303, `/settings?next=${sub}`);
    throw error(403, 'Unlock System settings first');
  }

  // An extension limited to some profiles does not exist for the others.
  if (event.locals.authenticated) {
    const ext = await extensionForPath(event.url.pathname);
    if (ext && !visibleTo(ext, event.locals.profileId)) throw error(404, 'Not found');
  }

  const tag = htmlTag(event.locals.theme, event.locals.lang);
  const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('<html lang="en">', tag) });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'same-origin');
  // Pages get frame-ancestors 'none' from kit.csp; this covers endpoints too. SAMEORIGIN, not DENY:
  // the onefile host embeds /api/onefile/<id> in a same-origin iframe.
  if (!response.headers.has('X-Frame-Options')) response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  // A private app: nothing here is for search engines.
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
};

/**
 * An unexpected error: one line in /logs/web.log with a short code, the same code on the error page, so
 * "error a1b2c3d4" leads straight to the stack.
 */
export const handleError: HandleServerError = ({ kind, error: e, event }) => {
  // error(...) thrown on purpose and SvelteKit's own (404, ...) keep their message.
  if (kind !== 'unknown') return;
  const id = randomBytes(4).toString('hex');
  const err = e instanceof Error ? e : new Error(String(e));
  console.error(`[error] ${new Date().toISOString()} ${id} ${event.request.method} ${event.url.pathname}: ${err.message}\n${err.stack ?? ''}`);
  return { message: 'Something went wrong', id };
};
