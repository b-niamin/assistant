<script lang="ts">
  import { enhance, saveOnChoose } from '#lib/forms.ts';
  import PageHead from '#lib/settings/PageHead.svelte';
  import { AGENT_NAMES, openDock, refreshDock, runInDock } from '#lib/dock/dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();

  // Sign-ins for the terminal's CLIs; the commands run in the dock's terminal at the bottom.
  const TOOLS = $derived([
    { id: 'claude', name: 'Claude Code', mark: 'C', hue: 'var(--brand)', cmd: 'claude', hint: t('Then type /login and open the link it prints.') },
    { id: 'codex', name: 'Codex', mark: 'X', hue: 'var(--hue-aqua)', cmd: 'codex login --device-auth', hint: t('Sign in with ChatGPT: enter the code at the URL it prints.') },
    { id: 'gh', name: 'GitHub CLI', mark: 'G', hue: 'var(--hue-violet)', cmd: 'gh auth login', hint: t('Choose GitHub.com, HTTPS, then log in with a web browser.') }
  ] as const);
  const AGENT_HINTS = $derived({ claude: t('Anthropic, signed in with a Claude account.'), codex: t('OpenAI, signed in with a ChatGPT account.') });
  const connector = $derived(data.status?.connector.state ?? 'off');
</script>

<svelte:head><title>{t('Terminal and AI')} · {t('System settings')}</title></svelte:head>

<PageHead title={t('Terminal and AI')} lede={t('The AI tools in the terminal at the bottom of every page: who is signed in, and which one Update, Build it and Install start.')}>
  {#snippet actions()}
    <button type="button" class="btn" onclick={openDock}>{t('Open the terminal')}</button>
  {/snippet}
</PageHead>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section class="sec" aria-labelledby="sign-h">
  <h2 id="sign-h">{t('Sign-ins')}</h2>
  {#if !data.terminal.configured}
    <div class="card panel">
      <p class="muted">{t('The terminal is not set up on this server yet.')}</p>
      <details class="tech"><summary>{t('Technical details')}</summary><p class="meta">{t('The terminal is off. Set SIDECAR_TICKET_SECRET in .env and run docker compose up -d.')}</p></details>
    </div>
  {:else}
    <ul class="card rows">
      {#each TOOLS as tool (tool.id)}
        {@const term = data.terminal}
        {@const ok = term[tool.id]}
        <li>
          <span class="mark" style="--hue: {tool.hue}" aria-hidden="true">{tool.mark}</span>
          <span class="what">
            <strong>{tool.name}</strong>
            <span class="meta">
              {#if !term.reachable}{t('The terminal container is not answering.')}
              {:else if !ok}{tool.hint}
              {:else if tool.id === 'gh'}{t('Lets the tools push to and read your GitHub repositories.')}
              {:else}{t('Runs in the terminal: type {cmd}, or let Update, Build it and Install start it.', { cmd: tool.id })}{/if}
            </span>
          </span>
          <span class="status small" class:good={ok}>{ok ? t('Signed in') : t('Not signed in')}</span>
          {#if !ok && term.reachable}
            <button type="button" class="btn btn-primary" onclick={() => runInDock(tool.cmd)} title={t('Runs {cmd} in the terminal at the bottom', { cmd: tool.cmd })}>{t('Sign in')}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="sec" aria-labelledby="agent-h">
  <h2 id="agent-h">{t('Default AI')}</h2>
  <form method="POST" action="?/defaultAgent" class="choice cols" aria-label={t('Default AI')} use:saveOnChoose
    use:enhance={() => async ({ update }) => (await update({ reset: false }), refreshDock())}>
    {#each ['claude', 'codex'] as const as a (a)}
      <label class="card">
        <input type="radio" name="agent" value={a} checked={data.defaultAgent === a} />
        <span><strong>{AGENT_NAMES[a]}</strong><span class="meta">{AGENT_HINTS[a]}</span></span>
      </label>
    {/each}
    <noscript><button class="btn">{t('Save')}</button></noscript>
  </form>
  <p class="meta">{t('Update, Build it and Install start it in the terminal with the request already typed.')}</p>
</section>

<section class="sec" aria-labelledby="claude-h">
  <h2 id="claude-h">{t('Claude on your phone and claude.ai')}</h2>
  <ul class="card rows">
    <li>
      <a href="/settings/connector">
        <span class="mark" style="--hue: var(--brand)" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 3v14M3.9 6.5l12.2 7M3.9 13.5l12.2-7" /></svg></span>
        <span class="what">
          <strong>{t('Claude connector')}</strong>
          <span class="meta">{t('Use your apps from claude.ai and the Claude apps (MCP)')}</span>
        </span>
        <span class="status small" class:good={connector === 'on'} class:warning={connector === 'turning'} class:critical={connector === 'error'}>
          {connector === 'on' ? t('On') : connector === 'turning' ? t('Turning on…') : connector === 'error' ? t('Not reachable') : t('Off')}
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </a>
    </li>
    <li>
      <a href="/settings/profile#mcp-h">
        <span class="mark" style="--hue: var(--hue-blue)" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2L10 5.8" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1.1-1.1" /></svg></span>
        <span class="what">
          <strong>{t('Your addresses')}</strong>
          <span class="meta">{t('Which apps each Claude sees, and approving new connections: in your profile.')}</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </a>
    </li>
  </ul>
</section>

<style>
  .cols {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    margin: 0 0 var(--space-2);
  }
  .rows .btn {
    flex: none;
  }
  .rows .status {
    flex: none;
  }
  @media (max-width: 560px) {
    .rows li {
      flex-wrap: wrap;
    }
  }
</style>
