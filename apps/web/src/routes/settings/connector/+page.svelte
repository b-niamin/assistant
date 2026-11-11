<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import { invalidateAll } from '$app/navigation';
  import Mascot from '#lib/Mascot.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();

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
    {t("Every new connection is approved in a profile's settings, on your tailnet: the app password never goes over the internet.")}
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

{#if live}
  <section aria-labelledby="add-h">
    <h2 id="add-h">{t('Add it to Claude')}</h2>
    <p class="muted">{t("Each profile has its own MCP addresses, and approves its own connections: open your profile's settings (the menu under your avatar), Claude and MCP.")}</p>
    <p><a class="btn" href="/settings/profile">{t('Profile settings')}</a></p>
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
            <span class="meta">{t('For {name} · address {endpoint}', { name: profileName(c.profileId), endpoint: c.builtin ? t('All apps') : c.endpoint })}</span>
            <span class="meta">{t('Approved {approved} · last used {used} · ends {ends}', { approved: when(c.createdAt), used: when(c.lastUsedAt), ends: when(c.expiresAt) })}</span>
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

<section aria-labelledby="calls-h">
  <h2 id="calls-h">{t('Latest tool calls')}</h2>
  {#if data.calls.length}
    <ul class="calls card">
      {#each data.calls as c, i (i)}
        <li>
          <span class="status small {c.ok ? 'good' : 'critical'}">{c.ok ? t('ok') : t('failed')}</span>
          <code>{c.tool}</code>
          <span class="meta">{c.source === 'terminal' ? t('terminal') : `${c.client} (${c.endpoint === 'All apps' ? t('All apps') : c.endpoint})`} · {profileName(c.profileId)} · {when(c.at)}{c.error ? ` · ${c.error}` : ''}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('No tool calls yet.')}</p>
  {/if}
</section>

<section aria-labelledby="how-h">
  <h2 id="how-h">{t('How it works')}</h2>
  <ul class="facts">
    <li>{t('The address serves only the MCP server and its sign-in: /mcp, /mcp/oauth/* and two discovery files. Every other path answers 404.')}</li>
    <li>{t('Tools are what each app offers (spec 005): an overview, read-only queries, and the writes the app allows. Claude asks before using a tool that changes data.')}</li>
    <li>{t("A connection sees only the profile and apps of its address. It never gets raw SQL or the raw saved data: only each app's overview and own tools, and writes only where the address allows them.")}</li>
    <li>{t('Sign-in is OAuth with PKCE. Access tokens last an hour, refresh tokens 90 days, and a connection ends after 180 days. Only their hashes are stored.')}</li>
    <li>{t('Claude reads the tool list when it connects: after installing an app, connect again to see its tools.')}</li>
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
    color: var(--critical-ink);
  }
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
  .calls {
    list-style: none;
    margin: 0;
    padding: var(--space-2) var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  .calls li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
  .note.good {
    color: var(--good, var(--ink-2));
  }
</style>
