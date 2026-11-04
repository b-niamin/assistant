/** Browser side of the sidecar WebSockets: fetch a ticket, then open /settings/<aud>/ws. */
export async function openSidecar(aud: 'terminal' | 'browser', extra: Record<string, string> = {}): Promise<string> {
  const res = await fetch('/settings/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aud })
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `HTTP ${res.status}`);
  }
  const { ticket } = (await res.json()) as { ticket: string };
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ ticket, ...extra });
  return `${proto}//${location.host}/settings/${aud}/ws?${query}`;
}
