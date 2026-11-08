<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import Tile from '#lib/dashboard/Tile.svelte';
  import Mascot from '#lib/Mascot.svelte';
  import { moodForHour, type Mood } from '#lib/mascot.ts';
  let { data } = $props();

  // The server renders its own clock; the browser re-reads its local time after hydration.
  const greet = (now: Date) => {
    const h = now.getHours();
    return {
      mood: moodForHour(h) as Mood,
      greeting: h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening',
      today: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    };
  };
  let clock = $state(greet(new Date()));
  onMount(() => (clock = greet(new Date())));
  // "Arrange": a list editor for this profile's tile order and hidden tiles.
  let arranging = $state(false);
  let draft = $state<{ key: string; title: string; source: string; hidden: boolean }[]>([]);
  const startArrange = () => {
    draft = data.layout.map((t) => ({ ...t }));
    arranging = true;
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    [draft[i], draft[j]] = [draft[j], draft[i]];
  };
  const profileName = $derived(data.profiles.find((p) => p.id === data.profileId)?.name ?? data.profileId);
</script>

<svelte:head><title>Assistant</title></svelte:head>

<div class="head">
  <div class="hello">
    <Mascot mood={clock.mood} size={56} label="Beni, the assistant mascot. Click me." />
    <div>
      <p class="eyebrow">{clock.today}</p>
      <h1>{clock.greeting}, {profileName}</h1>
    </div>
  </div>
  {#if !arranging && data.layout.length}
    <button class="btn-ghost" onclick={startArrange}>Arrange</button>
  {/if}
</div>

{#if arranging}
  <form
    method="POST"
    action="?/layout"
    class="card arrange"
    use:enhance={() =>
      async ({ update, result }) => {
        await update();
        if (result.type === 'success') arranging = false;
      }}
  >
    <h2>Arrange the dashboard</h2>
    <p class="muted">Order and hidden tiles are saved for {profileName} only.</p>
    <ol>
      {#each draft as t, i (t.key)}
        <li class:off={t.hidden}>
          <input type="hidden" name="order" value={t.key} />
          <label class="show">
            <input type="checkbox" checked={!t.hidden} onchange={(e) => (t.hidden = !e.currentTarget.checked)} />
            <span><strong>{t.title}</strong> <span class="muted">{t.source}</span></span>
          </label>
          {#if t.hidden}<input type="hidden" name="hidden" value={t.key} />{/if}
          <span class="moves">
            <button type="button" class="btn-ghost" aria-label="Move {t.title} up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
            <button type="button" class="btn-ghost" aria-label="Move {t.title} down" disabled={i === draft.length - 1} onclick={() => move(i, 1)}>↓</button>
          </span>
        </li>
      {/each}
    </ol>
    <div class="buttons">
      <button type="button" class="btn-ghost" onclick={() => (arranging = false)}>Cancel</button>
      <button class="btn">Save</button>
    </div>
  </form>
{/if}

<section class="grid" aria-label="Dashboard">
  {#each data.tiles as t, i (t.key)}
    <Tile
      title={t.title}
      source={t.extensionName}
      shared={t.scope === 'shared'}
      size={t.size}
      href={t.href}
      data={t.data}
      index={i}
    />
  {:else}
    <div class="card none">
      <Mascot mood="idle" size={72} decorative />
      <p class="muted">
        {data.layout.length
          ? 'All tiles are hidden: use Arrange to show some.'
          : 'No apps for this profile yet. Ask Claude to build one, or turn one on in Settings.'}
      </p>
    </div>
  {/each}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  .hello {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .hello > div {
    display: grid;
    gap: var(--space-1);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .arrange {
    display: grid;
    gap: var(--space-3);
    max-width: 560px;
    margin-bottom: var(--space-5);
  }
  .arrange h2,
  .arrange p {
    margin: 0;
  }
  .arrange ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .arrange li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line, rgba(127, 127, 127, 0.2));
  }
  .arrange li.off strong {
    opacity: 0.5;
  }
  .show {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .moves {
    display: flex;
    gap: var(--space-1);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .none {
    grid-column: 1 / -1;
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
    text-align: center;
  }
  .none p {
    margin: 0;
    max-width: 40ch;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    grid-auto-flow: dense;
    gap: var(--space-3);
  }
</style>
