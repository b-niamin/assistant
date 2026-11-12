<script lang="ts">
  import { onMount } from 'svelte';
  import { openSidecar } from '#lib/sidecar-client.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data } = $props();
  const t = useT();

  let screen: HTMLDivElement;
  let phase = $state<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  let message = $state('');
  let paste = $state('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rfb: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let RFB: any = null;

  async function connect() {
    rfb?.disconnect();
    phase = 'connecting';
    message = '';
    try {
      const url = await openSidecar('browser');
      const r = new RFB(screen, url, { shared: true });
      r.scaleViewport = true;
      r.focusOnClick = true;
      r.addEventListener('connect', () => (phase = 'open'));
      r.addEventListener('disconnect', (e: CustomEvent<{ clean: boolean }>) => {
        if (rfb !== r) return;
        phase = e.detail.clean ? 'closed' : 'error';
        if (!e.detail.clean) message = t('The browser container did not answer. Is it running?');
      });
      rfb = r;
    } catch (e) {
      phase = 'error';
      message = (e as Error).message;
    }
  }

  /** Puts text on the remote clipboard; then Ctrl+V in the remote browser pastes it. */
  function sendPaste() {
    if (!rfb || !paste) return;
    rfb.clipboardPasteFrom(paste);
    paste = '';
  }

  onMount(() => {
    let disposed = false;
    (async () => {
      // @ts-expect-error noVNC ships no type declarations
      const mod = await import('@novnc/novnc');
      RFB = mod.default?.default ?? mod.default;
      if (!disposed && data.configured && data.reachable) connect();
    })();
    return () => {
      disposed = true;
      rfb?.disconnect();
    };
  });
</script>

<svelte:head><title>{t('Browser')} · {t('Assistant')}</title></svelte:head>

<div class="head">
  <h1>{t('Browser')}</h1>
  <p class="muted">
    {t('A browser Claude shares with you: what you sign in to here, Claude can use. Sign out of what it no longer needs.')}
  </p>
</div>

{#if !data.configured}
  <p class="card warn">
    {t('The browser is not set up on this server yet.')}
    <details class="tech"><summary>{t('Technical details')}</summary>{t('The browser is off: set SIDECAR_TICKET_SECRET in .env and run docker compose up -d.')}</details>
  </p>
{:else if !data.reachable}
  <p class="card warn">{t('The browser container is not running. Start it with')} <code>docker compose up -d browser</code>.</p>
{/if}

<div class="screen card" bind:this={screen}></div>

<div class="foot">
  <form
    class="paste"
    onsubmit={(e) => {
      e.preventDefault();
      sendPaste();
    }}
  >
    <label class="sr" for="paste">{t('Text to paste into the remote browser')}</label>
    <input id="paste" type="password" autocomplete="off" placeholder={t('Paste text, then Ctrl+V in the browser')} bind:value={paste} />
    <button class="btn" disabled={phase !== 'open' || !paste}>{t('Send to clipboard')}</button>
  </form>
  <span class="muted">
    {#if phase === 'connecting'}{t('Connecting…')}{:else if phase === 'open'}{t('Connected')}{:else if phase === 'closed'}{t('Disconnected')}{:else if phase === 'error'}{message}{/if}
  </span>
  {#if phase === 'closed' || phase === 'error'}
    <button class="btn-primary" type="button" onclick={connect}>{t('Reconnect')}</button>
  {/if}
</div>

<style>
  .head {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .warn {
    border-color: var(--warning);
    margin-bottom: var(--space-3);
  }
  .screen {
    height: min(75vh, 800px);
    padding: 0;
    overflow: hidden;
    background: #0d0f13;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: space-between;
    align-items: center;
    margin-top: var(--space-2);
  }
  .paste {
    display: flex;
    gap: var(--space-2);
    flex: 1;
    min-width: 260px;
  }
  .paste input {
    flex: 1;
  }
</style>
