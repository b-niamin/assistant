<script lang="ts">
  /**
   * Settings, one shell for the profile's own settings and the system's: a sidebar of sections on the left,
   * the section's page on the right. On a phone the overview is the list (like iOS Settings) and every
   * other page starts with a way back to it.
   */
  import { page } from '$app/state';
  import { activeNav, SETTINGS_NAV, type NavId } from '#lib/settings/nav.ts';
  import { useT } from '#lib/i18n/index.ts';
  let { data, children } = $props();
  const t = useT();

  const active = $derived(activeNav(page.url.pathname));
  const dots = $derived.by(() => {
    const s = data.status;
    const out: Partial<Record<NavId, { tone: string; label: string }>> = {};
    if (!s) return out;
    const attention = (tone: string) => tone === 'warning' || tone === 'critical' || tone === 'accent';
    if (attention(s.updates.tone))
      out.updates = { tone: s.updates.tone, label: s.updates.tone === 'accent' ? t('Update available') : t('Needs attention') };
    if (attention(s.backups.tone)) out.backups = { tone: s.backups.tone, label: t('Needs attention') };
    if (attention(s.worker.tone)) out.worker = { tone: s.worker.tone, label: t('Needs attention') };
    if (s.connector.tone === 'good') out.connector = { tone: 'good', label: t('On') };
    else if (attention(s.connector.tone)) out.connector = { tone: s.connector.tone, label: t('Needs attention') };
    if (s.build.failed) out.logs = { tone: 'critical', label: t('The latest change to the app did not build') };
    return out;
  });
</script>

{#if data.unlocked}
  <div class="shell" class:home={active === 'overview'}>
    <nav class="side" aria-label={t('Settings')}>
      {#each SETTINGS_NAV as group, gi (gi)}
        <div class="group">
          {#if group.label}<p class="glabel">{t(group.label)}</p>{/if}
          <ul>
            {#each group.items as item (item.id)}
              {@const dot = dots[item.id]}
              <li>
                <a href={item.href} aria-current={active === item.id ? 'page' : undefined}>
                  <svg viewBox="0 0 20 20" aria-hidden="true">{#each item.icon as d}<path {d} />{/each}</svg>
                  <span class="label">{t(item.label)}</span>
                  {#if dot}<span class="dot {dot.tone}" title={dot.label}><span class="sr">{dot.label}</span></span>{/if}
                  <span class="chev" aria-hidden="true">›</span>
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </nav>
    <div class="content">
      {#if active !== 'overview'}
        <a class="back" href="/settings"><span aria-hidden="true">‹</span> {t('Settings')}</a>
      {/if}
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .shell {
    display: grid;
    grid-template-columns: 224px minmax(0, 1fr);
    gap: var(--space-6);
    align-items: start;
  }
  .side {
    position: sticky;
    top: calc(56px + var(--space-5));
    display: grid;
    gap: var(--space-4);
    max-height: calc(100vh - 56px - var(--space-6));
    overflow-y: auto;
    padding-bottom: var(--space-4);
  }
  .glabel {
    margin: 0 0 var(--space-1);
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1px;
  }
  .side a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 7px var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--ink-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    text-decoration: none;
  }
  .side a:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  .side a[aria-current='page'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 0 0 1px var(--ring);
  }
  .side a[aria-current='page'] svg {
    color: var(--brand);
  }
  svg {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
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
  .dot.accent {
    background: var(--accent);
  }
  .chev {
    display: none;
    color: var(--ink-4);
    font-size: 1.25rem;
    line-height: 1;
  }
  .content {
    min-width: 0;
  }
  /* The parts every settings page is made of. */
  .content :global(h1) {
    font-size: var(--text-xl);
  }
  .content :global(.sec) {
    margin-bottom: var(--space-6);
  }
  .content :global(.sec > h2),
  .content :global(.sec-h h2) {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
  }
  .content :global(.sec-h) {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .content :global(.meta) {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .content :global(.note) {
    margin: 0 0 var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-left: 3px solid var(--ink-4);
  }
  .content :global(.note.good) {
    border-left-color: var(--good);
  }
  .content :global(.note.bad) {
    border-left-color: var(--critical);
  }
  .content :global(.note.warn) {
    border-left-color: var(--warning);
  }
  .content :global(.panel) {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .content :global(.panel > p) {
    margin: 0;
  }
  .content :global(.rows) {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-4);
  }
  .content :global(.rows > li) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .content :global(.rows > li + li) {
    border-top: 1px solid var(--ring);
  }
  .content :global(.rows > li > a) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .content :global(.rows > li > a:hover strong) {
    color: var(--accent-ink);
  }
  .content :global(.what) {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .content :global(.mark) {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--hue, var(--ink-3)) 15%, transparent);
    color: var(--hue, var(--ink-2));
    font: 700 var(--text-sm) / 1 var(--mono);
  }
  .content :global(.mark svg) {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .content :global(.chev) {
    display: inline;
    flex: none;
    color: var(--ink-4);
    font-size: 1.25rem;
    line-height: 1;
  }
  .content :global(.choice) {
    display: grid;
    gap: var(--space-2);
  }
  .content :global(.choice label) {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 1px var(--ring);
    cursor: pointer;
  }
  .content :global(.choice label:has(input:checked)) {
    box-shadow: 0 0 0 1.5px var(--accent);
    background: var(--accent-wash);
  }
  .content :global(.choice input) {
    margin-top: 3px;
  }
  .content :global(.choice span) {
    display: grid;
    gap: 2px;
  }
  .content :global(details.tech summary) {
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .back {
    display: none;
  }

  /* A phone: the overview is the list, the other pages a full screen with a way back. */
  @media (max-width: 820px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-5);
    }
    .shell:not(.home) .side {
      display: none;
    }
    .shell.home .side {
      position: static;
      max-height: none;
      order: 2;
      overflow: visible;
    }
    .shell.home .content {
      order: 1;
    }
    .shell.home ul {
      background: var(--surface);
      border-radius: var(--radius);
      box-shadow: 0 0 0 1px var(--ring);
      gap: 0;
    }
    .shell.home li + li {
      border-top: 1px solid var(--ring);
    }
    .shell.home .side a {
      padding: var(--space-3);
      font-size: var(--text-base);
      color: var(--ink);
      border-radius: 0;
    }
    .shell.home .side a[aria-current='page'] {
      display: none;
    }
    .shell.home .group:first-child {
      display: none;
    }
    .chev {
      display: inline;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-bottom: var(--space-3);
      color: var(--accent-ink);
      font-weight: var(--weight-medium);
      text-decoration: none;
    }
    .back span {
      font-size: 1.4rem;
      line-height: 1;
    }
  }
</style>
