<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let { data } = $props();
  const t = useT();
  const next = $derived([
    {
      href: '/settings/ai',
      title: t('Sign in to Claude Code or Codex'),
      meta: t('The AI in the terminal builds and changes apps for you.')
    },
    ...(data.funnel === 'on'
      ? [{ href: '/settings/profile#mcp-h', title: t('Connect Claude'), meta: t('Copy your address into claude.ai, Settings, Connectors.') }]
      : []),
    { href: '/settings/profiles#add', title: t('Add the others at home'), meta: t('Everyone gets their own data and dashboard.') }
  ]);
</script>

<svelte:head><title>{t('Done')} · {t('Set up')}</title></svelte:head>

<div class="intro">
  <Mascot mood="charged" size={88} accessory="party-hat" decorative />
  <h1>{t('Your assistant is ready')}</h1>
  <p>
    {data.apps.length ? t('Apps: {apps}.', { apps: data.apps.map((a) => a.name).join(', ') }) : t('No apps yet: add them in System settings, Apps.')}
    {data.mode === 'manual' ? t('Updates wait for your click.') : t('Updates come by themselves.')}
  </p>
</div>

<div class="card next">
  <p class="meta head">{t('Next, when you have a moment')}</p>
  <ul>
    {#each next as n (n.href)}
      <li>
        <a href={n.href}>
          <span class="txt"><strong>{n.title}</strong><span class="meta">{n.meta}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
    {/each}
  </ul>
</div>

<a class="btn btn-primary go" href="/">{t('Open the dashboard')}</a>

<style>
  .next {
    padding: var(--space-3) var(--space-4);
  }
  .head {
    margin: 0 0 var(--space-1);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--ring);
  }
  a:not(.btn) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    color: inherit;
    text-decoration: none;
  }
  a:not(.btn):hover strong {
    color: var(--accent-ink);
  }
  .txt {
    display: grid;
    gap: 2px;
    flex: 1;
  }
  .chev {
    color: var(--ink-4);
    font-size: 1.25rem;
  }
  .go {
    justify-self: center;
    padding-inline: var(--space-6);
  }
</style>
