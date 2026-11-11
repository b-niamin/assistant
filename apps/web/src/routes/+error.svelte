<script lang="ts">
  import { page } from '$app/state';
  import Mascot from '#lib/Mascot.svelte';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  const missing = $derived(page.status === 404);
</script>

<svelte:head><title>{missing ? t('Not found') : t('Error')} · {t('Assistant')}</title></svelte:head>

<section class="card oops rise">
  <Mascot mood={missing ? 'tired' : 'asleep'} size={96} label={t('Beni, the assistant mascot. Click me.')} />
  <h1>{missing ? t('Beni looked everywhere') : t('Something went wrong')}</h1>
  <p class="muted">
    {missing ? t('There is no page at this address.') : page.error?.message ? t(page.error.message) : t('Try again in a moment.')}
  </p>
  <a class="btn btn-primary" href="/">{t('Back to the dashboard')}</a>
</section>

<style>
  .oops {
    max-width: 420px;
    margin: var(--space-6) auto;
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    text-align: center;
  }
  h1,
  p {
    margin: 0;
  }
</style>
