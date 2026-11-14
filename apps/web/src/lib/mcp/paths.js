/**
 * The MCP server and its OAuth (spec 005): the only paths the public listener (Tailscale Funnel,
 * server.mjs) lets through from the internet, and the ones hooks.server.ts keeps away from sessions.
 * Plain JS: server.mjs imports it before any build.
 */

/** @param {string} p a URL path */
export function isMcpPath(p) {
  return (
    p === '/mcp' ||
    p.startsWith('/mcp/oauth/') ||
    /^\/mcp\/x\/e[a-z0-9]{20}$/.test(p) ||
    /^\/\.well-known\/oauth-(protected-resource|authorization-server)(\/mcp(\/x\/e[a-z0-9]{20})?)?$/.test(p)
  );
}

/**
 * The OAuth endpoints a client's server calls (form posts without an Origin, or from another one). They
 * use no cookies, so SvelteKit's CSRF check has nothing to protect there.
 * @param {string} p
 */
export const isOAuthApi = (p) => p === '/mcp/oauth/token' || p === '/mcp/oauth/register' || p === '/mcp/oauth/revoke';

/**
 * Paths a browser-based MCP client may call from another origin (CORS): all of the above but the
 * authorize page, which is opened, not fetched. Bearer tokens only, no cookies, so any origin is fine.
 * @param {string} p
 */
export const isCorsPath = (p) => isMcpPath(p) && p !== '/mcp/oauth/authorize';

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id, mcp-protocol-version',
  'access-control-max-age': '86400'
};
