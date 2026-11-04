<script lang="ts">
  /**
   * Runs a onefile extension in a sandboxed iframe and persists what it writes to its localStorage.
   * Writes are batched and sent to /api/kv/<id>; a pending batch is flushed when the page is hidden.
   */
  import { onMount } from 'svelte';
  import { KV_MESSAGE, ONEFILE_SANDBOX } from './onefile';

  let { id, name }: { id: string; name: string } = $props();
  let frame: HTMLIFrameElement | undefined = $state();
  let status: 'saved' | 'saving' | 'error' = $state('saved');

  let pending: { set: Record<string, string>; remove: Set<string>; clear: boolean } = fresh();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function fresh() {
    return { set: {} as Record<string, string>, remove: new Set<string>(), clear: false };
  }

  function queue(msg: { op: string; key?: string; value?: string }) {
    if (msg.op === 'clear') pending = { ...fresh(), clear: true };
    else if (msg.op === 'set' && typeof msg.key === 'string' && typeof msg.value === 'string') {
      pending.set[msg.key] = msg.value;
      pending.remove.delete(msg.key);
    } else if (msg.op === 'remove' && typeof msg.key === 'string') {
      delete pending.set[msg.key];
      pending.remove.add(msg.key);
    } else return;
    status = 'saving';
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flush(false), 400);
  }

  async function flush(keepalive: boolean) {
    if (timer) clearTimeout(timer);
    timer = null;
    const batch = pending;
    if (!batch.clear && !batch.remove.size && !Object.keys(batch.set).length) return;
    pending = fresh();
    try {
      const res = await fetch(`/api/kv/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ set: batch.set, remove: [...batch.remove], clear: batch.clear }),
        keepalive
      });
      status = res.ok ? (timer ? 'saving' : 'saved') : 'error';
    } catch {
      status = 'error';
    }
  }

  onMount(() => {
    const onMessage = (e: MessageEvent) => {
      // Only our own iframe; its origin is opaque ("null"), so identity is checked by window.
      if (!frame || e.source !== frame.contentWindow) return;
      if (!e.data || typeof e.data !== 'object' || !e.data[KV_MESSAGE]) return;
      queue(e.data);
    };
    const onHide = () => flush(true);
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onHide);
      void flush(true);
    };
  });
</script>

<svelte:head><title>{name} · Assistant</title></svelte:head>

<div class="host">
  <iframe bind:this={frame} src="/api/onefile/{id}" title={name} sandbox={ONEFILE_SANDBOX}></iframe>
  <!-- Quiet while everything is saved: the app owns the whole frame, including its corners. -->
  <p class="state" data-state={status} aria-live="polite">
    {status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved: check the connection' : ''}
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
    height: calc(100dvh - 57px);
    border: 0;
    background: var(--surface);
  }
  .state {
    position: absolute;
    top: var(--space-2);
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    font-size: 0.75rem;
    color: var(--ink-3);
    pointer-events: none;
  }
  .state[data-state='error'] {
    color: var(--bad, #c0392b);
  }
</style>
