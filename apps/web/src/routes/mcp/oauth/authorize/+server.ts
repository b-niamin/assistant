/**
 * OAuth authorization for the Claude connector (spec 005). An MCP client (claude.ai) sends the owner
 * here; the owner picks the profile the connection reads and writes for, types the app password, and is
 * sent back with a single-use code. This page is reachable from the internet (Tailscale Funnel), so it is
 * one self-contained HTML response: no app scripts or styles, which the public listener does not serve.
 * The password is always asked for, whatever session cookie the browser holds; attempts are rate-limited
 * for everyone together, since every Funnel request comes from the same address.
 */
import type { RequestHandler } from './$types';
import beniSvg from '../../../../../static/favicon.svg?raw';
import { escapeHtml, redirectWith, SCOPE, validRedirectUri } from '#lib/mcp/oauth.ts';
import { approve, getClient, type OAuthClient } from '#lib/mcp/oauth.server.ts';
import { defaultProfile, passwordHash } from '#lib/server/app-config.ts';
import { verifyPassword } from '#lib/server/password.ts';
import { createLimiter } from '#lib/server/rate-limit.ts';
import { listProfiles } from '#lib/server/session.ts';

const limiter = createLimiter(10, 15 * 60 * 1000);
const BENI = `data:image/svg+xml;base64,${Buffer.from(beniSvg).toString('base64')}`;

interface Ask {
  client: OAuthClient;
  redirectUri: string;
  state: string;
  challenge: string;
}

/** Checks the request; a problem before the redirect URI is trusted is shown here, never redirected. */
async function readAsk(p: URLSearchParams): Promise<Ask | string> {
  const client = await getClient(p.get('client_id') ?? '');
  if (!client) return 'This app is not registered here. Add the connector again in Claude.';
  const redirectUri = p.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
  if (!validRedirectUri(redirectUri) || !client.redirectUris.includes(redirectUri)) return 'The return address does not match this app.';
  if (p.get('response_type') !== 'code') return 'Only the authorization code flow is supported.';
  const challenge = p.get('code_challenge') ?? '';
  if (p.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return 'PKCE (S256) is required.';
  const scope = p.get('scope');
  if (scope && !scope.split(' ').every((s) => s === SCOPE || s === '')) return `Unknown scope: ${scope}`;
  return { client, redirectUri, state: p.get('state') ?? '', challenge };
}

function page(body: string, formAction = ''): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Connect to Beni Assistant</title>
<style>
:root{--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#5b5b57;--ring:#e3e2dc;--accent:#2a78d6;--critical:#d03b3b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink-2:#a7a59e;--ring:#2e2d2a;--accent:#3987e5;--critical:#f06b6b}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--page);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:min(420px,100%);background:var(--surface);border:1px solid var(--ring);border-radius:16px;padding:28px 24px}
.top{display:flex;align-items:center;gap:12px;margin-bottom:12px}h1{font-size:1.25rem;margin:0;letter-spacing:-.01em}
p{margin:0 0 14px;color:var(--ink-2)}strong{color:var(--ink)}label{display:grid;gap:6px;margin:0 0 14px;font-size:.875rem;color:var(--ink-2)}
input,select{font:inherit;padding:9px 11px;border-radius:9px;border:1px solid var(--ring);background:var(--page);color:var(--ink)}
.row{display:flex;gap:10px;justify-content:flex-end}button{font:inherit;font-weight:600;padding:9px 16px;border-radius:9px;border:1px solid var(--ring);background:var(--surface);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.bad{color:var(--critical)}.small{font-size:.8125rem}
</style></head><body><main>
<div class="top"><img src="${BENI}" width="44" height="40" alt=""><h1>Connect to Beni Assistant</h1></div>
${body}
</main></body></html>`;
  const action = formAction ? ` ${formAction}` : '';
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // After the form, the browser follows a redirect to the client: form-action has to allow its origin.
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'${action}; frame-ancestors 'none'; base-uri 'none'`,
      'x-frame-options': 'DENY'
    }
  });
}

async function form(ask: Ask, query: string, error = '', chosen = ''): Promise<Response> {
  const profiles = await listProfiles();
  const pick = chosen || (await defaultProfile());
  const where = new URL(ask.redirectUri).host;
  const options = profiles
    .map((p) => `<option value="${escapeHtml(p.id)}"${p.id === pick ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');
  return page(
    `<p><strong>${escapeHtml(ask.client.name)}</strong> (returns to ${escapeHtml(where)}) asks to use the assistant's apps:
read their data and make the changes their tools allow.</p>
${error ? `<p class="bad" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="?${escapeHtml(query)}">
<label>Act for profile<select name="profile">${options}</select></label>
<label>App password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<div class="row"><button name="decision" value="deny">Deny</button><button class="primary" name="decision" value="allow">Allow</button></div>
</form>
<p class="small">You can remove this connection any time in System settings, Claude connector.</p>`,
    new URL(ask.redirectUri).origin
  );
}

export const GET: RequestHandler = async ({ url }) => {
  const ask = await readAsk(url.searchParams);
  if (typeof ask === 'string') return page(`<p class="bad">${escapeHtml(ask)}</p>`);
  return form(ask, url.searchParams.toString());
};

export const POST: RequestHandler = async ({ url, request }) => {
  const ask = await readAsk(url.searchParams);
  if (typeof ask === 'string') return page(`<p class="bad">${escapeHtml(ask)}</p>`);
  const f = await request.formData();
  const back = (params: Record<string, string>) => new Response(null, { status: 303, headers: { location: redirectWith(ask.redirectUri, { ...params, state: ask.state }) } });
  if (f.get('decision') !== 'allow') return back({ error: 'access_denied' });
  const profile = String(f.get('profile') ?? '');
  if (!limiter.attempt('authorize')) return form(ask, url.searchParams.toString(), 'Too many attempts. Try again in 15 minutes.', profile);
  if (!verifyPassword(String(f.get('password') ?? ''), await passwordHash()))
    return form(ask, url.searchParams.toString(), 'Wrong password.', profile);
  limiter.reset('authorize');
  if (!(await listProfiles()).some((p) => p.id === profile)) return form(ask, url.searchParams.toString(), 'Pick a profile.', profile);
  const code = await approve(ask.client, profile, ask.redirectUri, ask.challenge);
  console.log(`[mcp] ${new Date().toISOString()} connection approved for ${ask.client.name} (profile ${profile})`);
  return back({ code });
};
