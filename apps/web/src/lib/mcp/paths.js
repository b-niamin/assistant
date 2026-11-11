/**
 * The MCP server and its OAuth (spec 005): the only paths the public listener (Tailscale Funnel,
 * server.mjs) lets through from the internet, and the ones hooks.server.ts keeps away from sessions.
 * Plain JS: server.mjs imports it before any build.
 */

/** @param {string} p a URL path */
export function isMcpPath(p) {
  return p === '/mcp' || p.startsWith('/mcp/oauth/') || /^\/\.well-known\/oauth-(protected-resource|authorization-server)(\/mcp)?$/.test(p);
}

/**
 * The OAuth endpoints a client's server calls (form posts without an Origin, or from another one). They
 * use no cookies, so SvelteKit's CSRF check has nothing to protect there.
 * @param {string} p
 */
export const isOAuthApi = (p) => p === '/mcp/oauth/token' || p === '/mcp/oauth/register' || p === '/mcp/oauth/revoke';
