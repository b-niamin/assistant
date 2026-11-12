<script lang="ts">
  /**
   * Runs a onefile extension in a sandboxed iframe and persists what it writes to its localStorage.
   * Writes are batched and sent to /api/kv/<id> with the version of each key the app loaded (the shim's
   * hello): a key changed elsewhere since (another device, Claude through MCP) answers 409, and the app
   * reloads with the newer data instead of overwriting it. A failed save is kept and retried (backoff,
   * back online, page shown again); a pending batch is saved when the page is hidden.
   */
  import { onMount } from 'svelte';
  import { KV_MESSAGE, ONEFILE_SANDBOX } from './onefile';
  import { mergeBatch, freshBatch, batchBody, isEmpty, type Batch } from './onefile-save';
  import { tFor, useT } from '#lib/i18n/index.ts';
  const t = useT();

  let { id, name }: { id: string; name: string } = $props();
  let frame: HTMLIFrameElement | undefined = $state();
  let status: 'saved' | 'saving' | 'error' | 'reloaded' = $state('saved');
  let reloads = $state(0);

  /** Versions of the keys as the app loaded or last saved them. */
  let base: Record<string, number> = {};
  let pending: Batch = freshBatch();
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000];

  function schedule(ms: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flush(false), ms);
  }

  function queue(msg: { op: string; key?: string; value?: string; versions?: Record<string, number> }) {
    if (msg.op === 'hello') {
      base = msg.versions && typeof msg.versions === 'object' ? { ...msg.versions } : {};
      return;
    }
    if (msg.op === 'clear') pending = { ...freshBatch(), clear: true };
    else if (msg.op === 'set' && typeof msg.key === 'string' && typeof msg.value === 'string') {
      pending.set[msg.key] = msg.value;
      pending.remove.delete(msg.key);
    } else if (msg.op === 'remove' && typeof msg.key === 'string') {
      delete pending.set[msg.key];
      pending.remove.add(msg.key);
    } else return;
    status = 'saving';
    schedule(400);
  }

  async function flush(leaving: boolean) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (inFlight || isEmpty(pending)) return;
    const batch = pending;
    pending = freshBatch();
    inFlight = true;
    const body = JSON.stringify(batchBody(batch, base));
    try {
      const res = await fetch(`/api/kv/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body,
        // keepalive survives the page going away, but browsers cap its body at 64 KB.
        keepalive: leaving && body.length < 60_000
      });
      if (res.ok) {
        const { versions } = (await res.json().catch(() => ({}))) as { versions?: Record<string, number> };
        if (batch.clear) base = {};
        Object.assign(base, versions ?? {});
        failures = 0;
        status = isEmpty(pending) ? 'saved' : 'saving';
      } else if (res.status === 409) {
        // Someone else saved these keys since the app loaded: load their data rather than overwrite it.
        pending = freshBatch();
        status = 'reloaded';
        reloads += 1;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        status = 'error'; // refused for good (too large, bad data): retrying would not help
      } else throw new Error(String(res.status));
    } catch {
      // Network down, app restarting after a build: keep the batch (newer writes win) and try again.
      pending = mergeBatch(batch, pending);
      status = 'error';
      schedule(BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)]);
    } finally {
      inFlight = false;
      if (!isEmpty(pending) && !timer && status !== 'error') schedule(400);
    }
  }

  onMount(() => {
    const onMessage = (e: MessageEvent) => {
      // Only our own iframe; its origin is opaque ("null"), so identity is checked by window.
      if (!frame || e.source !== frame.contentWindow) return;
      if (!e.data || typeof e.data !== 'object' || !e.data[KV_MESSAGE]) return;
      queue(e.data);
    };
    // Hidden (tab switched, phone locked, page closing): save now, while the page still runs.
    const onVisibility = () => void flush(document.visibilityState === 'hidden');
    const onOnline = () => void flush(false);
    const onHide = () => void flush(true);
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onHide);
      void flush(true);
    };
  });
</script>

<svelte:head><title>{tFor(t.lang, id)(name)} · {t('Assistant')}</title></svelte:head>

<div class="host onefile-host">
  {#key reloads}
    <iframe bind:this={frame} src="/api/onefile/{id}" title={tFor(t.lang, id)(name)} sandbox={ONEFILE_SANDBOX}></iframe>
  {/key}
  <!-- Quiet while everything is saved: the app owns the whole frame, including its corners. -->
  <p class="state" data-state={status} aria-live="polite">
    {status === 'saving'
      ? t('Saving…')
      : status === 'error'
        ? t('Not saved yet: trying again')
        : status === 'reloaded'
          ? t('Changed on another device or by Claude: reloaded the latest data')
          : ''}
  </p>
</div>

<style>
  .host {
    position: relative;
    margin: calc(-1 * var(--space-6)) calc(-1 * var(--space-4)) calc(-1 * var(--space-7));
  }
  iframe {
    display: block;
    width: 100%;
    height: calc(100dvh - 57px - var(--dock-h, 0px));
    border: 0;
    background: var(--surface);
  }
  .state {
    position: absolute;
    top: var(--space-2);
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    font-size: var(--text-xs);
    color: var(--ink-3);
    pointer-events: none;
  }
  .state[data-state='error'] {
    color: var(--critical-ink);
  }
</style>
