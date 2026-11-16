<script lang="ts">
  /**
   * System settings -> Infrastructure: the parts of this server on one diagram. A part's dot is its state;
   * a click (or Enter) shows what it is, what it uses and what uses it, a way to its settings and its log,
   * and Restart where the host's updater can do it. On a phone the diagram becomes a list.
   */
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { enhance } from '#lib/forms.ts';
  import Mascot from '#lib/Mascot.svelte';
  import PageHead from '#lib/settings/PageHead.svelte';
  import { LINKS, linkPath, NODE_H, NODE_W, neighbours, PARTS, partById, VIEW_H, VIEW_W, type Health, type Part, type PartId } from '#lib/settings/infrastructure.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();

  const fromUrl = page.url.searchParams.get('part');
  let selected = $state<PartId>(partById(fromUrl ?? '')?.id ?? 'web');
  const sel = $derived(partById(selected)!);
  const near = $derived(neighbours(selected));
  const st = (id: PartId) => data.states[id];

  // A restart on its way: follow it every 5 seconds; otherwise refresh the states every 30.
  const waiting = $derived(data.restart?.state === 'pending');
  $effect(() => {
    const timer = setInterval(() => invalidate('app:infrastructure'), waiting ? 5000 : 30000);
    return () => clearInterval(timer);
  });

  const KIND: Record<Part['kind'], string> = { outside: 'Outside this server', host: 'On the host', container: 'Container' };

  /** The state of a part in words. */
  function stateText(id: PartId): string {
    const s = st(id);
    const n = Number(s.detail) || 0;
    const common: Record<string, string> = {
      running: t('Running'),
      down: t('Not answering'),
      'not-set-up': t('Not set up'),
      none: t('No status yet'),
      held: t('Waits for a restart: runs the previous version'),
      outdated: t('Runs a version from before the chat: restart it')
    };
    const own: Partial<Record<PartId, Record<string, string>>> = {
      you: { here: t('You are here') },
      claude: { 'can-connect': t('Can connect'), 'cannot-connect': t('Cannot connect: the connector is off') },
      connector: { on: t('On'), off: t('Off'), turning: t('Turning on…'), error: t('Not reachable') },
      github: { main: t('main at {sha}', { sha: s.detail }), unreachable: t('Not reachable from the host'), unknown: t('Unknown') },
      updater: {
        ok: t('Up to date'),
        available: t('Update available'),
        updating: t('Updating'),
        interrupted: t('Update interrupted'),
        failed: t('Last update failed'),
        blocked: t('Updates paused'),
        stale: t('The updater is not running'),
        held: t('Up to date; a restart waits'),
        none: t('Not set up')
      },
      web: { 'build-failed': t('The latest change did not build; the previous build serves') },
      worker: { units: t.n(n, '{n} service or job', '{n} services and jobs'), 'units-failed': t.n(n, '{n} failing', '{n} failing'), down: t('Not running') },
      backup: { ok: t('Up to date'), 'backing-up': t('Backing up'), failed: t('Last backup failed'), stale: t('Out of date') },
      'ext-migrate': { watching: t('Watching for new migrations'), failed: t('Last migration failed'), 'no-status': t('No log yet') }
    };
    return own[id]?.[s.state] ?? common[s.state] ?? s.state;
  }
  const HEALTH: Record<Health, string> = { good: 'OK', warning: 'Needs attention', critical: 'Not working', off: 'Off' };
  const shortText = (id: PartId) => (id === 'you' ? t('You are here') : t(HEALTH[st(id).health]));

  const attention = $derived(PARTS.filter((p) => st(p.id).health === 'warning' || st(p.id).health === 'critical'));
  const broken = $derived(attention.some((p) => st(p.id).health === 'critical'));

  const restartFor = (p: Part) => (data.restart && data.restart.service === p.service ? data.restart : null);

  function when(iso: string): string {
    const at = Date.parse(iso);
    return at ? new Date(at).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
  }

  function pick(id: PartId) {
    selected = id;
    const u = new URL(location.href);
    u.searchParams.set('part', id);
    history.replaceState(history.state, '', u);
  }
  function onKey(e: KeyboardEvent, id: PartId) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(id);
    }
  }
  const s = $derived(st(sel.id));
  const r = $derived(restartFor(sel));
  const touches = (l: { from: PartId; to: PartId }) => l.from === selected || l.to === selected;
  const mid = (a: Part, b: Part) => ({ x: (a.x + b.x + NODE_W) / 2, y: (a.y + b.y + NODE_H) / 2 });
</script>

<svelte:head><title>{t('Infrastructure')} · {t('System settings')}</title></svelte:head>

<PageHead title={t('Infrastructure')} lede={t('The parts of this server, what each one needs and how each one is doing. Pick a part for its details, its settings and a restart.')} />

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section class="sec" aria-label={t('Summary')}>
  <div class="card summary" class:s-warn={attention.length && !broken} class:s-bad={broken}>
    <Mascot mood={broken ? 'tired' : attention.length ? 'charged' : 'steady'} size={52} accessory="wrench" decorative />
    <div class="what">
      <strong class="big">{attention.length ? t.n(attention.length, '{n} part needs attention', '{n} parts need attention') : t('Every part runs')}</strong>
      <span class="meta">
        {#if attention.length}
          {#each attention as p, i (p.id)}{i ? ', ' : ''}<button type="button" class="linkish" onclick={() => pick(p.id)}>{t(p.name)}</button>{/each}
        {:else}
          {t('Running')} {#if data.deployedSha}<code>{data.deployedSha}</code>{/if}
        {/if}
      </span>
    </div>
    <ul class="legend" aria-label={t('Legend')}>
      {#each ['good', 'warning', 'critical', 'off'] as h (h)}
        <li><span class="dot {h}"></span>{t(HEALTH[h as Health])}</li>
      {/each}
    </ul>
  </div>
</section>

<section class="sec" aria-label={t('Diagram')}>
  <div class="card diagram">
    <svg viewBox="0 0 {VIEW_W} {VIEW_H}" role="group" aria-label={t('Parts of this server and their links')}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" class="tip" />
        </marker>
        <marker id="arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" class="tip on" />
        </marker>
      </defs>
      <g class="frames" aria-hidden="true">
        <text x="10" y="92">{t('Outside')}</text>
        <rect x="200" y="230" width="196" height="310" rx="14" />
        <text x="212" y="222">{t('On the host')}</text>
        <rect x="454" y="10" width="442" height="540" rx="14" />
        <text x="470" y="40">{t('Containers')}</text>
      </g>
      <g class="links" aria-hidden="true">
        {#each LINKS as l (l.from + l.to)}
          {@const a = partById(l.from)!}
          {@const b = partById(l.to)!}
          <path d={linkPath(a, b)} class:dashed={l.dashed} class:on={touches(l)} class:dim={!touches(l)} marker-end={touches(l) ? 'url(#arrow-on)' : 'url(#arrow)'} />
        {/each}
        {#each LINKS.filter(touches) as l (l.from + l.to)}
          {@const m = mid(partById(l.from)!, partById(l.to)!)}
          <text class="ltext" x={m.x} y={m.y - 6} text-anchor="middle">{t(l.label)}</text>
        {/each}
      </g>
      {#each PARTS as p (p.id)}
        {@const s = st(p.id)}
        <g
          class="node {p.kind} {s.health}"
          class:sel={p.id === selected}
          class:near={near.uses.includes(p.id) || near.usedBy.includes(p.id)}
          transform="translate({p.x} {p.y})"
          role="button"
          tabindex="0"
          aria-pressed={p.id === selected}
          aria-label="{t(p.name)}: {stateText(p.id)}"
          onclick={() => pick(p.id)}
          onkeydown={(e) => onKey(e, p.id)}
        >
          <rect class="box" width={NODE_W} height={NODE_H} rx="12" />
          <rect x="10" y="12" width="36" height="36" rx="10" class="badge" />
          <g class="icon" transform="translate(18 20)">{#each p.icon as d}<path {d} />{/each}</g>
          <circle cx="42" cy="16" r="5.5" class="dot ring {s.health}" />
          <text x="56" y="28" class="name">{t(p.short ?? p.name)}</text>
          <text x="56" y="45" class="state">{shortText(p.id)}</text>
        </g>
      {/each}
    </svg>

    <!-- A phone: the same parts as a list, grouped where they run. -->
    <div class="plist">
      {#each ['outside', 'host', 'container'] as k (k)}
        <p class="glabel">{t(KIND[k as Part['kind']])}</p>
        <ul>
          {#each PARTS.filter((p) => p.kind === k) as p (p.id)}
            <li>
              <button type="button" class:sel={p.id === selected} onclick={() => pick(p.id)}>
                <span class="dot {st(p.id).health}"></span>
                <span class="pname">{t(p.name)}</span>
                <span class="meta pstate">{stateText(p.id)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/each}
    </div>
  </div>
</section>

<section class="sec" aria-live="polite" aria-labelledby="part-h">
  <div class="card detail {s.health}">
    <div class="dhead">
      <span class="dot big-dot {s.health}" aria-hidden="true"></span>
      <div class="what">
        <h2 id="part-h">{t(sel.name)}</h2>
        <span class="meta">{t(KIND[sel.kind])}{sel.service ? ` · ${sel.service}` : ''}</span>
      </div>
      <div class="acts">
        {#if sel.href}<a class="btn" href={sel.href}>{t('Settings')}</a>{/if}
        {#if sel.log}<a class="btn" href="/settings/logs?file={sel.log}">{t('Log')}</a>{/if}
      </div>
    </div>

    <p class="state-line"><strong>{stateText(sel.id)}</strong>{#if s.detail && !/^\d+$/.test(s.detail) && sel.id !== 'github'}<span class="meta"> · {s.detail}</span>{/if}</p>
    <p class="meta">{t(sel.what)}</p>
    {#if sel.id === 'terminal' && s.state !== 'not-set-up'}
      <p class="meta">{t('Signed in:')} {(['claude', 'codex', 'gh'] as const).filter((k) => data.terminal[k]).map((k) => ({ claude: 'Claude Code', codex: 'Codex', gh: 'GitHub CLI' })[k]).join(', ') || t('nobody yet')}</p>
    {/if}

    <div class="deps">
      {#if near.uses.length}
        <div>
          <span class="meta">{t('Uses')}</span>
          <ul class="chips">
            {#each near.uses as id (id)}<li><button type="button" class="chip" onclick={() => pick(id)}><span class="dot {st(id).health}"></span>{t(partById(id)!.name)}</button></li>{/each}
          </ul>
        </div>
      {/if}
      {#if near.usedBy.length}
        <div>
          <span class="meta">{t('Needed by')}</span>
          <ul class="chips">
            {#each near.usedBy as id (id)}<li><button type="button" class="chip" onclick={() => pick(id)}><span class="dot {st(id).health}"></span>{t(partById(id)!.name)}</button></li>{/each}
          </ul>
        </div>
      {/if}
    </div>

    {#if sel.service}
      <div class="restart">
        <form method="POST" action="?/restart" use:enhance>
          <input type="hidden" name="service" value={sel.service} />
          <button class="btn" class:btn-primary={s.state === 'outdated' || s.state === 'held' || s.health === 'critical'} disabled={!data.updaterRuns || r?.state === 'pending'}>
            {r?.state === 'pending' ? t('Restarting…') : t('Restart')}
          </button>
        </form>
        <p class="meta">
          {#if !data.updaterRuns}
            {t('Restarts go through the host\'s updater, which is not running.')} <a href="/settings/updates">{t('Updates')}</a>
          {:else if r?.state === 'pending'}
            {t('Requested {when}: the updater takes it within a minute.', { when: when(r.at) })}
          {:else if r?.state === 'unanswered'}
            <span class="bad">{t('Requested {when}, but the updater has not taken it yet.', { when: when(r.at) })}</span>
          {:else if r?.state === 'ok'}
            {t('Restarted after the request of {when}.', { when: when(r.at) })}
          {:else if r?.state === 'failed'}
            <span class="bad">{t('The restart asked {when} failed.', { when: when(r.at) })}</span> <a href="/settings/logs?file=updater.log">{t('Updater log')}</a>
          {:else}
            {sel.restartNote ? t(sel.restartNote) : t('The host\'s updater restarts it within a minute.')}
          {/if}
        </p>
      </div>
    {:else if sel.kind === 'container'}
      <p class="meta">{t('The app does not restart this part; the host does (sudo ./beni.sh restart).')}</p>
    {/if}
  </div>
</section>

<style>
  .summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-left: 4px solid var(--good);
  }
  .summary.s-warn {
    border-left-color: var(--warning);
  }
  .summary.s-bad {
    border-left-color: var(--critical);
  }
  .big {
    font-size: var(--text-lg);
  }
  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-ink);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-xs);
    color: var(--ink-2);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    display: inline-block;
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ink-4);
  }
  .dot.good {
    background: var(--good);
  }
  .dot.warning {
    background: var(--warning);
  }
  .dot.critical {
    background: var(--critical);
  }
  circle.dot {
    fill: var(--ink-4);
  }
  circle.dot.good {
    fill: var(--good);
  }
  circle.dot.warning {
    fill: var(--warning);
  }
  circle.dot.critical {
    fill: var(--critical);
  }

  .diagram {
    padding: var(--space-3);
    overflow: hidden;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    font-family: var(--font);
  }
  .badge {
    fill: var(--surface-2);
    stroke: none;
  }
  .node.sel .badge {
    fill: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .icon path {
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .node.sel .icon path {
    stroke: var(--accent-ink);
  }
  circle.ring {
    stroke: var(--surface);
    stroke-width: 2.5;
  }
  .frames rect {
    fill: var(--surface-2);
    fill-opacity: 0.55;
    stroke: var(--ring);
    stroke-dasharray: 4 4;
  }
  .frames text {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    fill: var(--ink-3);
  }
  .links path {
    fill: none;
    stroke: var(--axis);
    stroke-width: 1.6;
    transition: stroke 150ms ease, opacity 150ms ease;
  }
  .links path.dashed {
    stroke-dasharray: 6 5;
  }
  .links path.on {
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-dasharray: 7 5;
  }
  @media (prefers-reduced-motion: no-preference) {
    .links path.on {
      animation: flow 0.9s linear infinite;
    }
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -12;
    }
  }
  .links path.dim {
    opacity: 0.55;
  }
  .tip {
    fill: var(--axis);
  }
  .tip.on {
    fill: var(--accent);
  }
  .ltext {
    font-size: 11.5px;
    fill: var(--accent-ink);
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 4px;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .node {
    cursor: pointer;
    outline: none;
  }
  .node .box {
    fill: var(--surface);
    stroke: var(--ring);
    stroke-width: 1.2;
    transition: stroke 150ms ease, fill 150ms ease;
  }
  .node.outside .box {
    fill: var(--page);
    stroke-dasharray: 3 3;
  }
  .node.warning .box {
    stroke: var(--warning);
  }
  .node.critical .box {
    stroke: var(--critical);
  }
  .node.near .box {
    stroke: var(--accent);
  }
  .node.sel .box {
    fill: var(--accent-wash);
    stroke: var(--accent);
    stroke-width: 2.2;
  }
  .node:focus-visible .box {
    stroke: var(--accent);
    stroke-width: 3;
  }
  @media (hover: hover) {
    .node:hover .box {
      stroke: var(--accent);
    }
  }
  .node .name {
    font-size: 13.5px;
    font-weight: 600;
    fill: var(--ink);
  }
  .node .state {
    font-size: 12px;
    fill: var(--ink-3);
  }
  @media (prefers-reduced-motion: no-preference) {
    .node.critical circle.dot,
    .node.warning circle.dot {
      animation: pulse 1.8s ease-in-out infinite;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  .plist {
    display: none;
  }
  .glabel {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .plist ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: var(--radius);
    box-shadow: 0 0 0 1px var(--ring);
  }
  .plist li + li {
    border-top: 1px solid var(--ring);
  }
  .plist button {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 2px var(--space-3);
    width: 100%;
    padding: var(--space-3);
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .plist button.sel {
    background: var(--accent-wash);
  }
  .pname {
    font-weight: var(--weight-medium);
  }
  .pstate {
    grid-column: 2;
  }

  .detail {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-left: 4px solid var(--good);
  }
  .detail.warning {
    border-left-color: var(--warning);
  }
  .detail.critical {
    border-left-color: var(--critical);
  }
  .detail.off {
    border-left-color: var(--ink-4);
  }
  .detail p {
    margin: 0;
  }
  .dhead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .dhead h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .big-dot {
    width: 12px;
    height: 12px;
  }
  .acts {
    display: flex;
    gap: var(--space-2);
    margin-left: auto;
  }
  .deps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-6);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  @media (hover: hover) {
    .chip:hover {
      box-shadow: 0 0 0 1px var(--accent);
    }
  }
  .restart {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--ring);
  }
  .restart form {
    margin: 0;
  }
  .bad {
    color: var(--critical-ink);
  }
  code {
    font-size: var(--text-sm);
  }

  @media (max-width: 640px) {
    svg {
      display: none;
    }
    .plist {
      display: block;
    }
    .diagram {
      padding: 0 var(--space-3) var(--space-3);
    }
    .summary {
      grid-template-columns: auto minmax(0, 1fr);
      padding: var(--space-4);
    }
    .legend {
      grid-column: 1 / -1;
    }
    .detail {
      padding: var(--space-4);
    }
    .acts {
      margin-left: 0;
      width: 100%;
    }
    .restart {
      flex-wrap: wrap;
    }
  }
</style>
