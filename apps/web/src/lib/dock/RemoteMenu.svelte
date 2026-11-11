<script lang="ts">
  /**
   * The Remote menu in the header: whether the Remote Control sessions of the `llm` container
   * (Claude Code, Codex) are up, summed up in one dot (all up: green, some: orange, none: grey).
   * It can start one that is down in the background of the terminal container. The status comes from
   * the dock (`GET /dock`), which refreshes it every 30 s.
   */
  import { dock, refreshDock, runInDock, type Remote } from './dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  let menuOpen = $state(false);
  let menu = $state<HTMLElement>();
  let starting = $state<'' | 'claude' | 'codex'>('');
  let startError = $state('');

  const REMOTES = $derived([
    { id: 'claude', name: 'Claude Code', where: t('claude.ai/code or the Claude app'), login: 'claude' },
    { id: 'codex', name: 'Codex', where: t('the ChatGPT or Codex app'), login: 'codex login --device-auth' }
  ] as const);
  const LABEL: Record<Remote, string> = $derived({
    starting: t('Starting'),
    running: t('Running'),
    restarting: t('Restarting'),
    'signed-out': t('Not signed in'),
    off: t('Not running')
  });

  const status = $derived(dock.status);
  // Up = the llm container's session runs, or one started here in the background.
  const agents = $derived(
    REMOTES.map((r) => {
      const state: Remote = status?.reachable ? status.remote[r.id] : 'off';
      const background = !!status?.background?.[r.id];
      const reason = status?.reasons?.[r.id] ?? '';
      // A Codex daemon keeps running while OpenAI refuses it: a known failure means it is not up.
      return { ...r, state, background, reason, up: (state === 'running' || background) && !reason, signedIn: !!status?.[r.id] };
    })
  );
  const upCount = $derived(agents.filter((a) => a.up).length);
  const tone = $derived(upCount === agents.length ? 'good' : upCount ? 'serious' : '');
  const summary = $derived(
    upCount === agents.length ? t('all running') : upCount ? t('{n} of {total} running', { n: upCount, total: agents.length }) : t('none running')
  );

  /** Start an agent's Remote Control in the background of the terminal container. */
  async function startRemote(agent: 'claude' | 'codex') {
    starting = agent;
    startError = '';
    try {
      const res = await fetch('/dock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start: agent })
      });
      if (!res.ok) startError = ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? t('Could not start it.');
      await refreshDock();
    } finally {
      starting = '';
    }
  }

  /** A pairing code for a device (ChatGPT/Codex app) from the Codex daemon. */
  let pairing = $state(false);
  let pairText = $state('');
  async function pairCodex() {
    pairing = true;
    pairText = '';
    try {
      const res = await fetch('/dock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pair: 'codex' }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; message?: string } | null;
      pairText = res.ok ? body?.text || t('No code came back.') : (body?.message ?? t('Could not get a code.'));
    } finally {
      pairing = false;
    }
  }

  /** Locked: the dock opens with its password prompt; the menu closes so it is in view. */
  function openTerminal() {
    menuOpen = false;
    dock.open = true;
    refreshDock();
  }

  function onWindowClick(e: MouseEvent) {
    if (menuOpen && menu && !menu.contains(e.target as Node)) menuOpen = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

<div class="remote" bind:this={menu}>
  <button
    class="remote-btn"
    type="button"
    aria-expanded={menuOpen}
    aria-controls="remote-menu"
    title={`Remote Control: ${summary}`}
    onclick={() => {
      menuOpen = !menuOpen;
      if (menuOpen) refreshDock();
    }}
  >
    <span class="status small {tone}">{t('Remote')}</span>
    <span class="sr">: {summary}</span>
    <svg class="chev" class:up={menuOpen} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
  </button>
  {#if menuOpen}
    <div class="menu card" id="remote-menu" role="region" aria-label="Remote Control">
      <p class="menu-head">Remote Control <span>{summary}</span></p>
      <ul>
        {#each agents as a (a.id)}
          <li>
            <span class="status small" class:good={a.up} class:warning={!a.up && (a.state === 'starting' || a.state === 'restarting')}></span>
            <span class="what">
              <strong>{a.name}</strong>
              <span class="meta" title={a.up ? t('Open it from {where}', { where: a.where }) : undefined}>
                {#if a.state === 'running'}{t('Running')}
                {:else if a.background}{t('Running in the background')}
                {:else if !a.signedIn}{t('Not signed in')}
                {:else if a.reason === 'mfa'}{t('Needs 2FA on the ChatGPT account')}
                {:else if a.reason === 'signed-out'}{t('Sign-in expired')}
                {:else}{LABEL[a.state]}{/if}
              </span>
            </span>
            {#if a.up && a.id === 'codex'}
              {#if status?.unlocked}
                <button type="button" class="btn small-btn" disabled={pairing} onclick={pairCodex} title={t('A short-lived code to connect another device')}>
                  {pairing ? t('Asking…') : t('Pair a device')}
                </button>
              {:else}
                <button type="button" class="btn small-btn" onclick={openTerminal} title={t('Pairing needs the app password')}>{t('Unlock to pair')}</button>
              {/if}
            {/if}
            {#if !a.up}
              {#if !a.signedIn || a.reason}
                <button type="button" class="btn small-btn" onclick={() => (runInDock(a.reason && a.id === 'codex' ? `codex logout; ${a.login}` : a.login), (menuOpen = false))}>{a.reason ? t('Sign in again') : t('Sign in')}</button>
              {:else if !status?.unlocked}
                <button type="button" class="btn small-btn" onclick={openTerminal} title={t('Starting it needs the app password')}>{t('Unlock to start')}</button>
              {:else if a.id === 'claude'}
                <button type="button" class="btn btn-primary small-btn" disabled={starting !== ''} onclick={() => startRemote(a.id)}>
                  {starting === a.id ? t('Starting…') : t('Start')}
                </button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
      {#if status?.outdated}
        <p class="bad">{t('An update is still building.')}</p>
      {:else if status && !status.reachable}
        <p class="bad">{t('The terminal container is not answering.')}</p>
      {/if}
      {#if startError}<p class="bad" role="alert">{startError}</p>{/if}
      {#if pairText}
        <div class="pair">
          <p class="meta">{t('Enter it in the ChatGPT or Codex app:')}</p>
          <pre>{pairText}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .remote {
    position: relative;
  }
  .remote-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--ring);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }
  .remote-btn:hover {
    background: var(--surface-2);
  }
  .chev {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 160ms ease;
  }
  .chev.up {
    transform: rotate(180deg);
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: min(420px, calc(100vw - 24px));
    padding: var(--space-3) var(--space-4);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 35%);
    z-index: 40;
  }
  .menu-head {
    display: flex;
    justify-content: space-between;
    margin: 0 0 var(--space-1);
    font-weight: 600;
    font-size: 0.875rem;
  }
  .menu-head span {
    font-weight: 400;
    color: var(--ink-2);
  }
  .menu ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .menu li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }
  .menu li + li {
    border-top: 1px solid var(--ring);
  }
  .menu .what {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
  }
  .menu .meta {
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  .menu .bad {
    margin: var(--space-1) 0 0;
    color: var(--critical);
    font-size: 0.8125rem;
  }
  .small-btn {
    flex: none;
    font-size: 0.8125rem;
    padding: 4px 10px;
  }
  @media (max-width: 560px) {
    .menu {
      position: fixed;
      left: 12px;
      right: 12px;
      top: 64px;
      width: auto;
    }
  }
  .pair {
    margin-top: var(--space-2);
  }
  .pair pre {
    margin: var(--space-1) 0 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font: 0.8125rem/1.5 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: all;
  }
</style>
