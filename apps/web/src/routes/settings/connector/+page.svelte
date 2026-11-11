<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Mascot from '#lib/Mascot.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();
  let copied = $state(false);

  const f = $derived(data.funnel);
  // The switch is applied by the host's updater: until its status says so, the change is on its way.
  const applying = $derived(!!data.updaterInstalled && (!f || f.want !== data.want || (data.want === 'on' && f.state === 'off')));
  const live = $derived(data.want === 'on' && f?.state === 'on' && !!f.url);
  const tone = $derived(live ? 'good' : f?.state === 'error' || f?.state === 'unavailable' ? 'critical' : applying ? 'warning' : '');
  const label = $derived(
    !data.updaterInstalled
      ? t('Needs the updater')
      : applying
        ? data.want === 'on' ? t('Turning on…') : t('Turning off…')
        : live
          ? t('On')
          : f?.state === 'error'
            ? t('Not reachable')
            : f?.state === 'unavailable'
              ? t('No Tailscale')
              : t('Off')
  );
  const profileName = (id: string) => data.profiles.find((p) => p.id === id)?.name ?? id;
  /** The message's Tailscale link, if any: shown as a link, not as text to copy. */
  const enableLink = $derived(f?.message.match(/https:\/\/login\.tailscale\.com\S*/)?.[0] ?? '');

  $effect(() => {
    if (!applying) return;
    const timer = setInterval(() => invalidateAll(), 5000);
    return () => clearInterval(timer);
  });

  async function copy() {
    if (!f?.url) return;
    await navigator.clipboard.writeText(f.url).catch(() => null);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : t('never');
</script>

<svelte:head><title>{t('Claude connector')} · {t('System settings')}</title></svelte:head>

<div class="head">
  <p class="eyebrow"><a href="/settings">{t('System settings')}</a></p>
  <div class="name">
    <Mascot mood={live ? 'charged' : 'steady'} size={48} decorative />
    <h1>{t('Claude connector')}</h1>
    <span class="status small {tone}">{label}</span>
  </div>
  <p class="muted">
    {t('Lets Claude (claude.ai and the Claude apps) use your apps through MCP: read their data and use their tools.')}
    {t('Only the connector goes on the internet, through Tailscale Funnel; the rest of the app stays on your tailnet.')}
    {t('Every new connection asks for the app password.')}
  </p>
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section class="card switch">
  <form method="POST" action="?/funnel" use:enhance>
    <input type="hidden" name="funnel" value={data.want === 'on' ? 'off' : 'on'} />
    <div class="what">
      <strong>{data.want === 'on' ? t('The connector is on') : t('The connector is off')}</strong>
      <span class="meta">{data.want === 'on' ? t('Turning it off ends every connection.') : t('Publishes only the MCP address.')}</span>
    </div>
    <button class="btn {data.want === 'on' ? '' : 'btn-primary'}" disabled={!data.updaterInstalled}>{data.want === 'on' ? t('Turn off') : t('Turn on')}</button>
  </form>
  {#if !data.updaterInstalled}
    <p class="meta">{t("The host's updater applies this switch (spec 006). On the host, this sets it up:")} <code>sudo ./beni.sh update</code></p>
  {:else if data.want === 'on' && f?.state === 'error'}
    <p class="bad">
      {#if enableLink}{t('Tailscale does not allow Funnel for this machine yet.')} <a href={enableLink} target="_blank" rel="noreferrer">{t('Enable Funnel')}</a>
        {t('(once, as the tailnet admin), and the updater tries again within a minute.')}
      {:else}{f.message}{/if}
    </p>
  {:else if f?.state === 'unavailable'}
    <p class="bad">{f.message}</p>
  {/if}
</section>

{#if live && f}
  <section aria-labelledby="add-h">
    <h2 id="add-h">{t('Add it to Claude')}</h2>
    <div class="card url">
      <code>{f.url}</code>
      <button type="button" class="btn" onclick={copy}>{copied ? t('Copied') : t('Copy')}</button>
    </div>
    <ol class="steps">
      <li>{t('In claude.ai: Settings, Connectors, Add custom connector.')}</li>
      <li>{t('Name it (for example "Assistant"), paste the address above, and add it. No client ID or secret is needed.')}</li>
      <li>{t("Connect opens this assistant's sign-in page: pick the profile Claude acts for, type the app password, and allow it.")}</li>
      <li>{t('In a chat, turn the connector on in the tools menu. The Claude apps on your phone and computer get it too.')}</li>
    </ol>
  </section>
{/if}

<section aria-labelledby="conn-h">
  <h2 id="conn-h">{t('Connections')}</h2>
  {#if data.connections.length}
    <ul class="menu card">
      {#each data.connections as c (c.id)}
        <li class="row">
          <span class="what">
            <strong>{c.client}</strong>
            <span class="meta">{t('For {name} · approved {approved} · last used {used}', { name: profileName(c.profileId), approved: when(c.createdAt), used: when(c.lastUsedAt) })}</span>
          </span>
          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="id" value={c.id} />
            <button class="btn">{t('Remove')}</button>
          </form>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('No connections yet. Each Claude account or app that signs in shows up here, and can be removed.')}</p>
  {/if}
</section>

<section aria-labelledby="how-h">
  <h2 id="how-h">{t('How it works')}</h2>
  <ul class="facts">
    <li>{t('The address serves only the MCP server and its sign-in: /mcp, /mcp/oauth/* and two discovery files. Every other path answers 404.')}</li>
    <li>{t('Tools are what each app offers (spec 005): an overview, read-only queries, and the writes the app allows. Claude asks before using a tool that changes data.')}</li>
    <li>{t('Sign-in is OAuth with PKCE. Access tokens last an hour, and refresh tokens 90 days. Only their hashes are stored.')}</li>
    <li>{t('The AI CLIs in the terminal use the same tools without the internet, through the assistant server in .mcp.json.')}</li>
  </ul>
</section>

<style>
  .head {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  section {
    margin-top: var(--space-5);
  }
  .switch form,
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .switch {
    padding: var(--space-4);
  }
  .switch > p {
    margin: var(--space-3) 0 0;
  }
  .what {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .meta {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .bad {
    color: var(--critical);
  }
  .url {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .url code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .steps,
  .facts {
    margin: var(--space-3) 0 0;
    padding-left: 1.25rem;
    display: grid;
    gap: var(--space-2);
    color: var(--ink-2);
  }
  .menu {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-4);
  }
  .menu li {
    padding: var(--space-3) 0;
  }
  .menu li + li {
    border-top: 1px solid var(--ring);
  }
  .note {
    margin: 0 0 var(--space-3);
  }
  .note.good {
    color: var(--good, var(--ink-2));
  }
</style>
