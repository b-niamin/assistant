import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { extensionForPath, visibleTo } from '#lib/extensions/registry.server.ts';
import { isMcpPath } from '#lib/mcp/paths.js';
import { defaultProfile, isConfigured } from '#lib/server/app-config.ts';
import { canonicalRedirect } from '#lib/server/canonical-origin.ts';
import { isValidSession, PROFILE_COOKIE, SESSION_COOKIE } from '#lib/server/session.ts';
import { htmlTag, parseTheme, THEME_COOKIE } from '#lib/theme.ts';
import { LANG_COOKIE, pickLanguage } from '#lib/i18n/languages.ts';
import { languageSettings } from '#lib/server/languages.ts';

const PUBLIC_PATHS = new Set(['/login', '/healthz', '/setup']);

export const handle: Handle = async ({ event, resolve }) => {
  // The MCP server and its OAuth (spec 005): their own bearer tokens and passwords, never the session.
  if (isMcpPath(event.url.pathname)) {
    event.locals.authenticated = false;
    event.locals.profileId = await defaultProfile();
    event.locals.theme = parseTheme(undefined);
    const response = await resolve(event);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'no-referrer');
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
  event.locals.profileId = event.cookies.get(PROFILE_COOKIE) || (await defaultProfile());
  event.locals.theme = parseTheme(event.cookies.get(THEME_COOKIE));
  // The language of the page (spec 007): this browser's pick from the user menu, else the default.
  event.locals.lang =
    event.url.pathname === '/healthz' ? 'en' : pickLanguage(await languageSettings(), event.cookies.get(LANG_COOKIE));

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

  const tag = htmlTag(event.locals.theme, event.locals.lang);
  const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('<html lang="en">', tag) });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'same-origin');
  // Pages get frame-ancestors 'none' from kit.csp; this covers endpoints too. SAMEORIGIN, not DENY:
  // the onefile host embeds /api/onefile/<id> in a same-origin iframe.
  if (!response.headers.has('X-Frame-Options')) response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  return response;
};
