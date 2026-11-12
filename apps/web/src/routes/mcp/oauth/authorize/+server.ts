/**
 * OAuth authorization for the Claude connector (spec 005). An MCP client (claude.ai) sends the owner
 * here. This page is on the internet (Tailscale Funnel), so it asks for nothing: it files a request and
 * waits, refreshing itself, while the owner approves it in the app on the tailnet (Profile settings ->
 * Claude and MCP: which of the profile's MCP addresses it connects to). Then it sends the browser back to the
 * client with a single-use code. A cookie ties the request to the browser that asked; the app password
 * never crosses the Funnel. One self-contained HTML response: no app scripts or styles, which the public
 * listener does not serve.
 */
import type { RequestHandler } from './$types';
import beniSvg from '../../../../../static/favicon.svg?raw';
import { endpointOfResource, escapeHtml, knownScope, redirectWith, REQUEST_TTL_S, validRedirectUri } from '#lib/mcp/oauth.ts';
import { getEndpoint } from '#lib/mcp/endpoints.server.ts';
import { allowedRedirectHosts, fileRequest, getClient, OAuthError, requestState, type OAuthClient } from '#lib/mcp/oauth.server.ts';

const BENI = `data:image/svg+xml;base64,${Buffer.from(beniSvg).toString('base64')}`;
const COOKIE = 'beni_oauth_request';

interface Ask {
  client: OAuthClient;
  redirectUri: string;
  state: string;
  challenge: string;
  /** The profile's MCP address the client connects to, if it said (resource, RFC 8707). */
  endpoint: string | null;
}

/** Checks the request; a problem before the redirect URI is trusted is shown here, never redirected. */
async function readAsk(p: URLSearchParams): Promise<Ask | string> {
  const client = await getClient(p.get('client_id') ?? '');
  if (!client) return 'This app is not registered here. Add the connector again in Claude.';
  const redirectUri = p.get('redirect_uri') ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
  if (!validRedirectUri(redirectUri, allowedRedirectHosts()) || !client.redirectUris.includes(redirectUri))
    return 'The return address is not one this assistant sends codes to.';
  if (p.get('response_type') !== 'code') return 'Only the authorization code flow is supported.';
  const challenge = p.get('code_challenge') ?? '';
  if (p.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return 'PKCE (S256) is required.';
  const scope = p.get('scope');
  if (!knownScope(scope)) return `Unknown scope: ${scope}`;
  const asked = endpointOfResource(p.get('resource'));
  const endpoint = asked && (await getEndpoint(asked)) ? asked : null;
  return { client, redirectUri, state: p.get('state') ?? '', challenge, endpoint };
}

function page(body: string, refresh = 0, headers: Record<string, string> = {}): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}<title>Connect to Beni Assistant</title>
<style>
:root{--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#5b5b57;--ring:#e3e2dc;--accent:#2a78d6;--critical:#d03b3b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink-2:#a7a59e;--ring:#2e2d2a;--accent:#3987e5;--critical:#f06b6b}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--page);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:min(420px,100%);background:var(--surface);border:1px solid var(--ring);border-radius:16px;padding:28px 24px}
.top{display:flex;align-items:center;gap:12px;margin-bottom:12px}h1{font-size:1.25rem;margin:0;letter-spacing:-.01em}
p{margin:0 0 14px;color:var(--ink-2)}strong{color:var(--ink)}label{display:grid;gap:6px;margin:0 0 14px;font-size:.875rem;color:var(--ink-2)}
input,select{font:inherit;padding:9px 11px;border-radius:9px;border:1px solid var(--ring);background:var(--page);color:var(--ink)}
.row{display:flex;gap:10px;justify-content:flex-end}button{font:inherit;font-weight:600;padding:9px 16px;border-radius:9px;border:1px solid var(--ring);background:var(--surface);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.bad{color:var(--critical)}.small{font-size:.8125rem}.code{font:600 1.5rem/1.2 ui-monospace,monospace;letter-spacing:.08em;color:var(--ink);text-align:center;margin:18px 0}
</style></head><body><main>
<div class="top"><img src="${BENI}" width="44" height="40" alt=""><h1>Connect to Beni Assistant</h1></div>
${body}
</main></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
      'x-frame-options': 'DENY',
      ...headers
    }
  });
}

/** The app on the tailnet, where the owner approves (PUBLIC_ORIGIN; the Funnel address is another one). */
const appOrigin = () => (process.env.ORIGIN ?? '').replace(/\/$/, '');

const back = (uri: string, params: Record<string, string>) => new Response(null, { status: 303, headers: { location: redirectWith(uri, params), 'cache-control': 'no-store' } });

function cookieOf(request: Request): string {
  const m = /(?:^|;\s*)beni_oauth_request=([A-Za-z0-9_-]+)/.exec(request.headers.get('cookie') ?? '');
  return m?.[1] ?? '';
}

function waiting(client: string, returnsTo: string, code: string): Response {
  const app = appOrigin();
  const link = app ? `<a href="${escapeHtml(app)}/settings/mcp" target="_blank" rel="noreferrer">${escapeHtml(app.replace(/^https?:\/\//, ''))}</a>` : 'the app';
  return page(
    `<p><strong>${escapeHtml(client)}</strong> (returns to ${escapeHtml(returnsTo)}) asks to use the assistant's apps.</p>
<p>Approve it in the app on your tailnet: open ${link}, MCP connector, Waiting for approval.</p>
<p class="code" aria-label="Request code">${escapeHtml(code)}</p>
<p class="small">Check that the app shows the same code. This page moves on by itself once you decide; the request ends after ${REQUEST_TTL_S / 60} minutes.</p>`,
    3
  );
}

export const GET: RequestHandler = async ({ url, request }) => {
  const id = url.searchParams.get('request');
  if (id) {
    const r = await requestState(id, cookieOf(request));
    if (r.state === 'allowed') return back(r.redirectUri, { code: r.code, state: r.stateParam });
    if (r.state === 'denied') return back(r.redirectUri, { error: 'access_denied', state: r.stateParam });
    if (r.state === 'pending') return waiting(r.client, r.returnsTo, r.userCode);
    return page('<p class="bad">This request has ended or belongs to another browser. Start again from Claude.</p>');
  }
  const ask = await readAsk(url.searchParams);
  if (typeof ask === 'string') return page(`<p class="bad">${escapeHtml(ask)}</p>`);
  try {
    const { id: rid, secret } = await fileRequest(ask.client, ask.redirectUri, ask.state, ask.challenge, ask.endpoint);
    return new Response(null, {
      status: 303,
      headers: {
        location: `?request=${encodeURIComponent(rid)}`,
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${secret}; Path=/mcp/oauth/authorize; Max-Age=${REQUEST_TTL_S}; HttpOnly; Secure; SameSite=Lax`
      }
    });
  } catch (e) {
    if (e instanceof OAuthError) return page(`<p class="bad">${escapeHtml(e.message)}</p>`);
    throw e;
  }
};
