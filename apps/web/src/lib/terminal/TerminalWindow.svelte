<script lang="ts">
  /**
   * The in-app terminal window (spec 004): xterm.js over a single-use-ticket WebSocket to the terminal
   * sidecar, attached to a tmux session. `session` + `start` open a named session that starts Claude Code
   * or Codex the first time and is re-attached afterwards, so a conversation survives page changes; `dir`
   * runs it in an installed extension's folder.
   */
  import { onMount } from 'svelte';
  import { reducedMotion } from '#lib/motion.ts';
  import Mascot from '#lib/Mascot.svelte';
  import { useT } from '#lib/i18n/index.ts';
  import '@xterm/xterm/css/xterm.css';
  import '#lib/terminal/fonts/fonts.css';
  import { openSidecar } from '#lib/sidecar-client.ts';
  import { arrowSeq, BAR_KEYS, ctrlOf, type BarKey } from '#lib/terminal/keys.ts';
  import { defaultFontSize, stepFontSize, TERMINAL_FONT, TERMINAL_THEME } from '#lib/terminal/theme.ts';

  type Phase = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  let {
    configured,
    reachable = true,
    session = 'web',
    start = '',
    dir = '',
    title = 'tmux · web',
    height = 'min(72vh, 680px)',
    compact = false,
    phase = $bindable<Phase>('idle')
  }: {
    configured: boolean;
    reachable?: boolean;
    session?: string;
    start?: '' | 'claude' | 'codex';
    dir?: string;
    title?: string;
    height?: string;
    compact?: boolean;
    phase?: Phase;
  } = $props();

  let host: HTMLDivElement;
  let message = $state('');
  let size = $state('');
  let fontSize = $state(14);
  let full = $state(false);
  let ctrl = $state(false);
  /** xterm's screen reader mode: output goes to a live region a screen reader can read (per browser). */
  let readerMode = $state(false);
  try {
    readerMode = localStorage.getItem('terminal.reader') === '1';
  } catch {
    /* no storage */
  }
  function toggleReader() {
    readerMode = !readerMode;
    if (term) term.options.screenReaderMode = readerMode;
    try {
      localStorage.setItem('terminal.reader', readerMode ? '1' : '');
    } catch {
      /* no storage */
    }
  }
  let ws: WebSocket | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let term: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fit: any = null;

  const t = useT();
  const PHASE_LABEL: Record<Phase, string> = $derived({
    idle: t('Starting'),
    connecting: t('Connecting'),
    open: t('Connected'),
    closed: t('Disconnected'),
    error: t('Not connected')
  });
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

  /** Type a command and run it. Ctrl+U first clears a half-typed line. */
  export function run(cmd: string) {
    send('\x15' + cmd + '\r');
    term?.focus();
  }

  /**
   * Run a command in a new tmux window (prefix C-b, then c), so whatever runs in the current one, such
   * as a Claude conversation, is left alone. tmux's window bar switches between them.
   */
  export function runInNewWindow(cmd: string) {
    send('\x02c');
    setTimeout(() => run(cmd), 400);
  }

  /** Type text where the cursor is, without Enter: the owner finishes the line. */
  export function type(text: string) {
    send(text);
    term?.focus();
  }

  /** Say something to the program running in the window (e.g. Claude Code) and press Enter. */
  export function say(text: string) {
    send(text.replace(/\s+/g, ' ').trim());
    setTimeout(() => send('\r'), 150);
    term?.focus();
  }

  function pressKey(k: BarKey) {
    if (k.kind === 'ctrl') ctrl = !ctrl;
    else if (k.kind === 'arrow') send(arrowSeq(k.dir, !!term?.modes?.applicationCursorKeysMode));
    else send(k.seq);
    if (k.kind !== 'ctrl') ctrl = false;
    term?.focus();
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
    if (!configured || !term) return;
    ws?.close();
    phase = 'connecting';
    message = '';
    try {
      fit.fit();
      const url = await openSidecar('terminal', {
        cols: String(term.cols),
        rows: String(term.rows),
        ...(session !== 'web' ? { session } : {}),
        ...(start ? { start } : {}),
        ...(dir ? { dir } : {})
      });
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
        message = t('The terminal container did not answer. Is it running?');
      };
      ws = sock;
    } catch (e) {
      phase = 'error';
      message = (e as Error).message;
    }
  }

  onMount(() => {
    let disposed = false;
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
      const reduced = reducedMotion();
      term = new Terminal({
        cursorBlink: !reduced,
        screenReaderMode: readerMode,
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
      // F6 is the way out of the terminal (Dock.svelte): xterm leaves it to the page.
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => e.key !== 'F6');
      host.querySelector('textarea')?.setAttribute('aria-label', t('Terminal input. F6 leaves the terminal.'));
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
      if (configured) connect();
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

<div class="window" class:full class:compact style="--h: {height}">
  <div class="bar">
    <span class="status conn {PHASE_TONE[phase]}" class:pulse={phase === 'connecting'} aria-live="polite">
      {PHASE_LABEL[phase]}
    </span>
    <span class="title">{title}</span>
    {#if size}<span class="size num">{size}</span>{/if}
    <div class="tools">
      <button type="button" class="tool" onclick={() => setFont(-1)} title={t('Smaller text')} aria-label={t('Smaller text')}>
        <span class="a sm">A</span>
      </button>
      <button type="button" class="tool" onclick={() => setFont(1)} title={t('Larger text')} aria-label={t('Larger text')}>
        <span class="a lg">A</span>
      </button>
      <button type="button" class="tool" onclick={toggleReader} title={t('Screen reader mode')} aria-label={t('Screen reader mode')} aria-pressed={readerMode}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2.5L8 3v10l-3.5-3H2zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" /></svg>
      </button>
      <button type="button" class="tool" onclick={connect} disabled={!configured || phase === 'connecting'} title={t('Reconnect')} aria-label={t('Reconnect')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" /></svg>
      </button>
      <button
        type="button"
        class="tool"
        onclick={toggleFull}
        title={full ? t('Exit full screen') : t('Full screen')}
        aria-label={full ? t('Exit full screen') : t('Full screen')}
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
          <p>{t('Opening a session…')}</p>
        {:else if !configured}
          <Mascot mood="asleep" size={64} decorative />
          <p>{t('The terminal is off: set SIDECAR_TICKET_SECRET in .env.')}</p>
        {:else}
          <Mascot mood={phase === 'closed' ? 'asleep' : 'tired'} size={64} decorative />
          <p class="big">{phase === 'closed' ? t('Session disconnected') : t('Could not connect')}</p>
          <p class="sub">
            {phase === 'closed' ? t('Your shell is still running in tmux.') : message || t('Try again in a moment.')}
            {#if !reachable}{t('The terminal container is not answering.')}{/if}
          </p>
          <button class="btn-primary btn" type="button" onclick={connect}>{t('Reconnect')}</button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="keys" role="toolbar" aria-label={t('Terminal keys')}>
    {#each BAR_KEYS as k}
      <button
        type="button"
        class="key"
        class:on={k.kind === 'ctrl' && ctrl}
        aria-pressed={k.kind === 'ctrl' ? ctrl : undefined}
        title={t(k.title)}
        aria-label={t(k.title)}
        disabled={phase !== 'open'}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => pressKey(k)}>{k.label}</button
      >
    {/each}
  </div>
</div>

<style>
  .window {
    --t-bg: #141413;
    --t-chrome: #1d1d1b;
    --t-line: #2c2c2a;
    --t-ink: #e8e6df;
    --t-ink-2: #a3a29a;
    --t-ink-3: #6e6d68;
    display: flex;
    flex-direction: column;
    height: var(--h);
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
  .window.compact .keys {
    display: none;
  }
</style>
