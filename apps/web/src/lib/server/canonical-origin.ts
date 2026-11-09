/**
 * The app answers on ONE public origin (ORIGIN = PUBLIC_ORIGIN in .env): SvelteKit's CSRF check rejects a
 * form posted from any other ("Cross-site POST form submissions are forbidden"). Tailscale Serve can
 * publish the same port on several HTTPS ports (443 and 8443, say, after a reinstall), and a phone
 * bookmark keeps the old one, so pages there load but every form fails. A page request that reaches
 * us under the public host name on another port is sent to the public origin instead; CSRF stays as
 * strict as before. Other hosts (localhost, the compose service name) are left alone.
 */
export function canonicalRedirect(
  method: string,
  host: string | null,
  pathAndQuery: string,
  origin = process.env.ORIGIN ?? ''
): string | null {
  if ((method !== 'GET' && method !== 'HEAD') || !host || !origin) return null;
  let pub: URL;
  try {
    pub = new URL(origin);
  } catch {
    return null;
  }
  const at = host.toLowerCase();
  if (at === pub.host) return null;
  // Host is "name" (default port) or "name:port"; only the public name on another port is ours.
  if (at.replace(/:\d+$/, '') !== pub.hostname) return null;
  return pub.origin + pathAndQuery;
}
