<script lang="ts">
  import { page } from '$app/state';
  import Mascot from '$lib/Mascot.svelte';

  const missing = $derived(page.status === 404);
</script>

<svelte:head><title>{missing ? 'Not found' : 'Error'} · Assistant</title></svelte:head>

<section class="card oops rise">
  <Mascot mood={missing ? 'tired' : 'asleep'} size={96} label="Pip, the assistant mascot. Click me." />
  <h1>{missing ? 'Pip looked everywhere' : 'Something went wrong'}</h1>
  <p class="muted">
    {missing ? 'There is no page at this address.' : (page.error?.message ?? 'Try again in a moment.')}
  </p>
  <a class="btn btn-primary" href="/">Back to the dashboard</a>
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
