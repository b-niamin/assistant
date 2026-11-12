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
  /** The message's Tailscale link, if any: shown as a link, not as text to copy. */
  const enableLink = $derived(f?.message.match(/https:\/\/login\.tailscale\.com\S*/)?.[0] ?? '');

  // How long this page has watched the switch on its way: past two minutes it says what holds it up.
  let waited = $state(0);
  $effect(() => {
    if (!applying) {
      waited = 0;
      return;
    }
    const from = Date.now();
    const timer = setInterval(() => {
      waited = Date.now() - from;
      invalidateAll();
    }, 5000);
    return () => clearInterval(timer);
  });
  const slow = $derived(applying && (data.updaterStale || waited > 2 * 60_000));
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : t('never');
</script>

<svelte:head><title>{t('MCP on the internet')} · {t('System settings')}</title></svelte:head>

<div class="head">
  <div class="name">
    <Mascot mood={live ? 'charged' : 'steady'} size={48} decorative />
    <h1>{t('MCP on the internet')}</h1>
    <span class="status small {tone}">{label}</span>
  </div>
  <p class="muted">{t('One switch for the whole server: claude.ai can reach the MCP address (only that, through Tailscale Funnel). Each profile then connects its own Claude in its MCP connector.')}</p>
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section class="card switch">
  <form method="POST" action="?/funnel" use:enhance>
    <input type="hidden" name="funnel" value={data.want === 'on' ? 'off' : 'on'} />
    <div class="what">
      <strong>{data.want === 'on' ? t('On') : t('Off')}</strong>
      {#if data.want === 'on'}<span class="meta">{t('Turning it off ends every connection.')}</span>{/if}
    </div>
    <button class="btn {data.want === 'on' ? '' : 'btn-primary'}" disabled={!data.updaterInstalled}>{data.want === 'on' ? t('Turn off') : t('Turn on')}</button>
  </form>
  {#if !data.updaterInstalled}
    <p class="meta">{t("The host's updater applies this switch. On the host, this sets it up:")} <code>sudo ./beni.sh update</code></p>
  {:else if slow}
    <p class="bad" role="status">
      {#if data.updaterStale}
        {t('The updater has not run since {when}, and it is what applies this switch.', { when: when(data.updaterSeen || null) })}
        <a href="/settings/updates">{t('See Updates')}</a>
      {:else}
        {t('The updater runs, but has not applied the switch yet.')}
        <a href="/settings/logs">{t('Its log')}</a> {t('(updater.log) says why. On the host, this applies it now and prints the result:')} <code>sudo sh &lt;folder&gt;-updater/update.sh funnel</code>
      {/if}
    </p>
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

<section class="sec" aria-labelledby="how-h">
  <h2 id="how-h">{t('Step by step')}</h2>
  <ol class="card steps">
    <li class:done={f?.state !== 'unavailable' && !!f}>{t('Tailscale runs on this server, with HTTPS certificates on in the tailnet (admin console, DNS).')}</li>
    <li class:done={live}>{t('Turn on the switch above. The first time, Tailscale asks the tailnet admin to allow Funnel: the link shows up here.')}</li>
    <li class:done={live}>{t('Within a minute the status says On.')}</li>
    <li>{t('Each person opens their own MCP connector and follows the steps there.')} <a href="/settings/mcp">{t('MCP connector')}</a></li>
  </ol>
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
  .switch form {
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
  .bad {
    color: var(--critical-ink);
  }
  .steps {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + 1.25rem);
    display: grid;
    gap: var(--space-2);
  }
  .steps li.done {
    color: var(--ink-2);
  }
  .steps li.done::marker {
    color: var(--good-ink);
  }
</style>
