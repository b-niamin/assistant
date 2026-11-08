<script lang="ts">
  import { onMount } from 'svelte';
  import Mascot from '$lib/Mascot.svelte';
  import '@xterm/xterm/css/xterm.css';
  import '$lib/terminal/fonts/fonts.css';
  import { openSidecar } from '$lib/sidecar-client';
  import { arrowSeq, BAR_KEYS, ctrlOf, type BarKey } from '$lib/terminal/keys';
  import { defaultFontSize, stepFontSize, TERMINAL_FONT, TERMINAL_THEME } from '$lib/terminal/theme';
  import { parsePending, pendingCommand, PENDING_PROMPT_KEY, type PendingTask } from '$lib/settings/guide';

  let { data } = $props();

  type Phase = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  let host: HTMLDivElement;
  let phase = $state<Phase>('idle');
  let message = $state('');
  // The page load's status until the first poll after a login.
  let polled = $state<typeof data.status | null>(null);
  const status = $derived(polled ?? data.status);
  let size = $state('');
  let fontSize = $state(14);
  let full = $state(false);
  let ctrl = $state(false);
  let ws: WebSocket | null = null;
  // A task left by "Extend the system": shown above the terminal until it is run or dismissed.
  let pending = $state<PendingTask | null>(null);
  const pendingNeeds = $derived(pending?.tool === 'claude' ? status.claude : pending?.tool === 'codex' ? status.codex : true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let term: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fit: any = null;

  const LOGINS = [
    {
      id: 'claude',
      name: 'Claude Code',
      mark: 'C',
      hue: 'var(--brand)',
      cmd: 'claude',
      hint: 'Then type /login and open the link it prints.'
    },
    {
      id: 'codex',
      name: 'Codex',
      mark: 'X',
      hue: 'var(--hue-aqua)',
      cmd: 'codex login --device-auth',
      hint: 'Sign in with ChatGPT: enter the code at the URL it prints.'
    },
    {
      id: 'gh',
      name: 'GitHub CLI',
      mark: 'G',
      hue: 'var(--hue-violet)',
      cmd: 'gh auth login',
      hint: 'Choose GitHub.com, HTTPS, then log in with a web browser.'
    }
  ] as const;

  const PHASE_LABEL: Record<Phase, string> = {
    idle: 'Starting',
    connecting: 'Connecting',
    open: 'Connected',
    closed: 'Disconnected',
    error: 'Not connected'
  };
  const PHASE_TONE: Record<Phase, string> = {
    idle: '',
    connecting: 'warning',
    open: 'good',
    closed: '',
    error: 'critical'
  };

  function send(text: string) {
    if (ws?.readyState === WebSocket.OPEN) ws.send('0' + text);
  }

  /** Quick action: type the command and run it. Ctrl+U first clears a half-typed line. */
  function run(cmd: string) {
    send('\x15' + cmd + '\r');
    term?.focus();
    // A login takes a while; look again a few times so the card turns green without a reload.
    for (const ms of [5000, 15000, 30000, 60000]) setTimeout(refreshStatus, ms);
  }

  function clearPending() {
    pending = null;
    try {
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
    } catch {
      /* no storage */
    }
  }

  function runPending() {
    if (!pending) return;
    run(pendingCommand(pending));
    clearPending();
  }

  function pressKey(k: BarKey) {
    if (k.kind === 'ctrl') ctrl = !ctrl;
    else if (k.kind === 'arrow') send(arrowSeq(k.dir, !!term?.modes?.applicationCursorKeysMode));
    else send(k.seq);
    if (k.kind !== 'ctrl') ctrl = false;
    term?.focus();
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/settings/terminal/status');
      if (res.ok) polled = await res.json();
    } catch {
      /* keep the last known status */
    }
  }

  function setFont(dir: 1 | -1) {
    fontSize = stepFontSize(fontSize, dir);
    try {
      localStorage.setItem('terminal.fontSize', String(fontSize));
    } catch {
      /* private mode: size is per page load */
    }
    if (term) {
      term.options.fontSize = fontSize;
      refit();
    }
  }

  function refit() {
    requestAnimationFrame(() => {
      try {
        fit?.fit();
      } catch {
        /* not laid out yet */
      }
    });
  }

  function toggleFull() {
    full = !full;
    refit();
    term?.focus();
  }

  async function connect() {
    if (!data.configured || !term) return;
    ws?.close();
    phase = 'connecting';
    message = '';
    try {
      fit.fit();
      const url = await openSidecar('terminal', { cols: String(term.cols), rows: String(term.rows) });
      const sock = new WebSocket(url);
      sock.binaryType = 'arraybuffer';
      sock.onopen = () => {
        phase = 'open';
        term.focus();
      };
      sock.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
      sock.onclose = () => {
        if (ws === sock) phase = phase === 'error' ? 'error' : 'closed';
      };
      sock.onerror = () => {
        phase = 'error';
        message = 'The terminal container did not answer. Is it running?';
      };
      ws = sock;
    } catch (e) {
      phase = 'error';
      message = (e as Error).message;
    }
  }

  onMount(() => {
    let disposed = false;
    try {
      pending = parsePending(sessionStorage.getItem(PENDING_PROMPT_KEY));
    } catch {
      /* no storage */
    }
    const narrow = matchMedia('(max-width: 640px)').matches;
    fontSize = defaultFontSize(narrow);
    try {
      const saved = Number(localStorage.getItem('terminal.fontSize'));
      if (saved >= 9 && saved <= 24) fontSize = saved;
    } catch {
      /* no storage */
    }

    // Keep the full-screen window above the phone keyboard.
    const vv = window.visualViewport;
    const onViewport = () => {
      document.documentElement.style.setProperty('--term-vh', `${vv?.height ?? window.innerHeight}px`);
      refit();
    };
    vv?.addEventListener('resize', onViewport);
    window.addEventListener('resize', onViewport);
    onViewport();

    // Phones drop the socket when the tab sleeps: come back connected.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (phase === 'closed') connect();
      refreshStatus();
    };
    document.addEventListener('visibilitychange', onVisible);

    let observer: ResizeObserver | null = null;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      // xterm measures the font once: wait for the bundled one (fallback after a short wait).
      await Promise.race([
        Promise.all([document.fonts.load(`400 ${fontSize}px 'JetBrains Mono Variable'`), document.fonts.load(`700 ${fontSize}px 'JetBrains Mono Variable'`)]),
        new Promise((r) => setTimeout(r, 1500))
      ]).catch(() => {});
      if (disposed) return;
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 2,
        fontFamily: TERMINAL_FONT,
        fontSize,
        fontWeight: 400,
        fontWeightBold: 650,
        lineHeight: 1.2,
        letterSpacing: 0,
        scrollback: 5000,
        allowProposedApi: false,
        theme: TERMINAL_THEME
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      term.onData((d: string) => {
        if (ctrl && d.length === 1) {
          ctrl = false;
          send(ctrlOf(d) ?? d);
          return;
        }
        send(d);
      });
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        size = `${cols}×${rows}`;
        if (ws?.readyState === WebSocket.OPEN) ws.send(`1${cols} ${rows}`);
      });
      observer = new ResizeObserver(() => refit());
      observer.observe(host);
      fit.fit();
      size = `${term.cols}×${term.rows}`;
      if (data.configured) connect();
      else phase = 'error';
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      vv?.removeEventListener('resize', onViewport);
      window.removeEventListener('resize', onViewport);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
      term?.dispose();
    };
  });
</script>

<svelte:head><title>Terminal · Assistant</title></svelte:head>


<div class="head rise" style="--i: 0">
  <p class="eyebrow"><a href="/settings">System settings</a></p>
  <h1>Terminal</h1>
  <p class="lede">
    A shell in its own container for signing in to command-line tools. Logins land in the shared Claude home, so
    Claude Remote picks them up, and the session (tmux) keeps running after you close this page.
  </p>
</div>

{#if !data.configured}
  <p class="card warn rise" style="--i: 1">
    <span class="status warning">The terminal is off.</span> Set <code>SIDECAR_TICKET_SECRET</code> in
    <code>.env</code> (<code>openssl rand -hex 32</code>) and run <code>docker compose up -d</code>.
  </p>
{/if}

<section class="logins" aria-label="Sign-ins">
  {#each LOGINS as l, i}
    {@const ok = status[l.id]}
    <article class="login card rise" style="--i: {i + 1}; --hue: {l.hue}">
      <span class="mark" aria-hidden="true">{l.mark}</span>
      <div class="who">
        <h2>{l.name}</h2>
        <span class="status small" class:good={ok}>{ok ? 'Signed in' : 'Not signed in'}</span>
      </div>
      <button
        class="run"
        class:quiet={ok}
        type="button"
        disabled={phase !== 'open'}
        onclick={() => run(l.cmd)}
        title={l.hint}
        aria-label="Run {l.cmd}"
      >
        <code>{l.cmd}</code>
        <span class="short">{ok ? 'Run' : 'Sign in'}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5 10.5 8 5 12.5" /></svg>
      </button>
      <p class="hint">{l.hint}</p>
    </article>
  {/each}
</section>

{#if pending}
  <section class="ready card rise" id="ready" style="--i: 4" aria-label="Ready to build">
    <Mascot mood="charged" size={48} decorative />
    <div class="ask">
      <h2>{pending.title}</h2>
      <p class="said">{pending.tool === 'shell' ? pendingCommand(pending) : pending.text}</p>
      <p class="small">
        {#if pending.tool === 'shell'}
          This copies the app from the extensions repo and turns it on; the app rebuilds by itself within a minute.
        {:else}
          This starts {pending.tool === 'codex' ? 'Codex' : 'Claude Code'} with your request. It builds the app in the
          repo; answer it in the terminal if it asks something. When it is done, the app appears in System settings.
        {/if}
      </p>
    </div>
    <div class="go">
      <button class="btn btn-primary" type="button" disabled={phase !== 'open' || !pendingNeeds} onclick={runPending}>
        {pending.tool === 'shell' ? 'Run it' : pending.tool === 'codex' ? 'Run in Codex' : 'Run in Claude'}
      </button>
      <button class="btn-ghost" type="button" onclick={clearPending}>Dismiss</button>
      {#if !pendingNeeds}<p class="small">Sign in to {pending.tool === 'codex' ? 'Codex' : 'Claude Code'} first (card above).</p>{/if}
    </div>
  </section>
{/if}

<div class="window rise" class:full style="--i: 5">
  <div class="bar">
    <span class="status conn {PHASE_TONE[phase]}" class:pulse={phase === 'connecting'} aria-live="polite">
      {PHASE_LABEL[phase]}
    </span>
    <span class="title">tmux · web</span>
    {#if size}<span class="size num">{size}</span>{/if}
    <div class="tools">
      <button type="button" class="tool" onclick={() => setFont(-1)} title="Smaller text" aria-label="Smaller text">
        <span class="a sm">A</span>
      </button>
      <button type="button" class="tool" onclick={() => setFont(1)} title="Larger text" aria-label="Larger text">
        <span class="a lg">A</span>
      </button>
      <button type="button" class="tool" onclick={connect} disabled={!data.configured || phase === 'connecting'} title="Reconnect" aria-label="Reconnect">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" /></svg>
      </button>
      <button
        type="button"
        class="tool"
        onclick={toggleFull}
        title={full ? 'Exit full screen' : 'Full screen'}
        aria-label={full ? 'Exit full screen' : 'Full screen'}
        aria-pressed={full}
      >
        {#if full}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" /></svg>
        {/if}
      </button>
    </div>
  </div>

  <div class="screen">
    <div class="xt" bind:this={host}></div>
    {#if phase !== 'open'}
      <div class="veil" class:soft={phase === 'connecting' || phase === 'idle'}>
        {#if phase === 'connecting' || phase === 'idle'}
          <span class="spinner" aria-hidden="true"></span>
          <p>Opening a session…</p>
        {:else if !data.configured}
          <Mascot mood="asleep" size={64} decorative />
          <p>The terminal is off. See the note above.</p>
        {:else}
          <Mascot mood={phase === 'closed' ? 'asleep' : 'tired'} size={64} decorative />
          <p class="big">{phase === 'closed' ? 'Session disconnected' : 'Could not connect'}</p>
          <p class="sub">
            {phase === 'closed' ? 'Your shell is still running in tmux.' : message || 'Try again in a moment.'}
            {#if !status.reachable}The terminal container is not answering.{/if}
          </p>
          <button class="btn-primary btn" type="button" onclick={connect}>Reconnect</button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="keys" role="toolbar" aria-label="Terminal keys">
    {#each BAR_KEYS as k}
      <button
        type="button"
        class="key"
        class:on={k.kind === 'ctrl' && ctrl}
        aria-pressed={k.kind === 'ctrl' ? ctrl : undefined}
        title={k.title}
        disabled={phase !== 'open'}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => pressKey(k)}>{k.label}</button
      >
    {/each}
  </div>
</div>

<style>
  .head {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .lede {
    color: var(--ink-2);
    max-width: 68ch;
  }
  .ready {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3) var(--space-4);
    align-items: start;
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    border-color: var(--accent);
  }
  .ready h2,
  .ready p {
    margin: 0;
  }
  .ask {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .said {
    font: 0.8125rem/1.5 var(--mono);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    overflow-wrap: anywhere;
  }
  .ready .go {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .warn {
    border-color: var(--warning);
    margin: 0 0 var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  /* Sign-in cards */
  .logins {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .login {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'mark who' 'run run' 'hint hint';
    align-items: center;
    /* Cards in a row share a height: keep the rows at the top so the buttons line up across cards. */
    align-content: start;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .mark {
    grid-area: mark;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 1rem/1 var(--mono);
  }
  .who {
    grid-area: who;
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .small {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .run {
    grid-area: run;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    height: 38px;
    padding: 0 10px 0 12px;
    border-radius: var(--radius-sm);
    border: 1px solid #2c2c2a;
    background: #141413;
    color: #e8e6df;
    text-align: left;
    transition:
      transform 120ms ease,
      border-color 120ms ease;
  }
  .run code {
    background: none;
    padding: 0;
    color: inherit;
    font-size: 0.8125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .run code::before {
    content: '$ ';
    color: var(--hue);
  }
  .short {
    display: none;
    font-weight: 600;
    font-size: 0.875rem;
  }
  .run svg {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.7;
  }
  .run:hover:not(:disabled) {
    border-color: var(--hue);
  }
  .run:active:not(:disabled) {
    transform: translateY(1px);
  }
  .run.quiet {
    background: var(--surface-2);
    border-color: var(--ring);
    color: var(--ink-2);
  }
  .run:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .hint {
    grid-area: hint;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  /* The terminal window: dark in both themes */
  .window {
    --t-bg: #141413;
    --t-chrome: #1d1d1b;
    --t-line: #2c2c2a;
    --t-ink: #e8e6df;
    --t-ink-2: #a3a29a;
    --t-ink-3: #6e6d68;
    display: flex;
    flex-direction: column;
    height: min(72vh, 680px);
    min-height: 360px;
    border-radius: 12px;
    overflow: hidden;
    background: var(--t-bg);
    border: 1px solid var(--t-line);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.08),
      0 12px 32px -12px rgba(0, 0, 0, 0.35);
  }
  .window.full {
    position: fixed;
    inset: 0;
    z-index: 50;
    height: var(--term-vh, 100dvh);
    min-height: 0;
    border-radius: 0;
    border: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 42px;
    padding: 0 6px 0 14px;
    background: var(--t-chrome);
    border-bottom: 1px solid var(--t-line);
    color: var(--t-ink-2);
    font-size: 0.8125rem;
  }
  .conn {
    color: var(--t-ink);
    font-weight: 550;
  }
  .conn:not(.good, .warning, .critical)::before {
    background: var(--t-ink-3);
  }
  .conn.good::before {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 22%, transparent);
  }
  .title {
    font-family: var(--mono);
    color: var(--t-ink-3);
  }
  .size {
    font-family: var(--mono);
    color: var(--t-ink-3);
  }
  .tools {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
  .tool {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 7px;
    background: none;
    color: var(--t-ink-2);
  }
  .tool:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.07);
    color: var(--t-ink);
  }
  .tool:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tool svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .a {
    font-weight: 600;
    line-height: 1;
  }
  .a.sm {
    font-size: 0.75rem;
  }
  .a.lg {
    font-size: 1rem;
  }

  .screen {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 10px 6px 6px 12px;
  }
  .xt {
    height: 100%;
  }
  .xt :global(.xterm-viewport) {
    background-color: transparent !important;
  }
  .veil {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-2);
    padding: var(--space-5);
    text-align: center;
    background: color-mix(in srgb, var(--t-bg) 86%, transparent);
    backdrop-filter: blur(2px);
    color: var(--t-ink);
  }
  .veil.soft {
    background: color-mix(in srgb, var(--t-bg) 60%, transparent);
    color: var(--t-ink-2);
  }
  .veil p {
    margin: 0;
  }
  .veil .big {
    font-size: 1.0625rem;
    font-weight: 600;
  }
  .veil .sub {
    color: var(--t-ink-2);
    font-size: 0.875rem;
    max-width: 40ch;
    margin-bottom: var(--space-2);
  }
  .spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--t-line);
    border-top-color: var(--hue-orange);
  }

  /* Touch key bar: phones and tablets, and narrow windows */
  .keys {
    display: none;
    gap: 6px;
    padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
    background: var(--t-chrome);
    border-top: 1px solid var(--t-line);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .keys::-webkit-scrollbar {
    display: none;
  }
  .key {
    flex: none;
    min-width: 44px;
    height: 38px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--t-line);
    background: #262624;
    color: var(--t-ink);
    font: 500 0.875rem/1 var(--mono);
    touch-action: manipulation;
  }
  .key:active:not(:disabled) {
    background: #34342f;
  }
  .key.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .key:disabled {
    opacity: 0.45;
  }
  @media (pointer: coarse), (max-width: 640px) {
    .keys {
      display: flex;
    }
  }

  @media (max-width: 640px) {
    .head {
      margin-bottom: var(--space-4);
    }
    .lede {
      font-size: 0.875rem;
    }
    .logins {
      gap: var(--space-2);
    }
    .login {
      grid-template-columns: auto 1fr auto;
      grid-template-areas: 'mark who run';
      padding: var(--space-3);
    }
    .hint {
      display: none;
    }
    .who .status {
      white-space: nowrap;
    }
    .run {
      gap: 4px;
    }
    .run code {
      display: none;
    }
    .run .short {
      display: inline;
    }
    .window {
      height: 72dvh;
      margin: 0 calc(-1 * var(--space-2));
    }
    .title,
    .size {
      display: none;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .pulse::before {
      animation: pulse 1s ease-in-out infinite;
    }
    .spinner {
      animation: spin 0.8s linear infinite;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
