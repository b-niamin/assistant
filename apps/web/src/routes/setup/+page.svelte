<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  let { data, form } = $props();

  // The profile id follows the name ("Zoë Ann" -> "zoe-ann") until it is edited by hand.
  let name = $state('');
  let profile = $state('');
  let profileEdited = $state(false);
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '');
  $effect(() => {
    if (!profileEdited) profile = slug(name);
  });
</script>

<svelte:head><title>Set up · Assistant</title></svelte:head>

<div class="wrap">
  <Mascot mood="charged" size={72} decorative />
  <h1>Welcome. Let's set up your assistant.</h1>
  {#if !data.tokenSet}
    <p class="card">
      This server has no setup code. Run <code>./install.sh</code> again (it writes <code>SETUP_TOKEN</code> into
      <code>.env</code> and prints it), then reload this page.
    </p>
  {:else}
    <form method="POST" class="card">
      {#if form?.error}<p class="err" role="alert">{form.error}</p>{/if}
      <label>Setup code <span class="muted">(printed by install.sh)</span>
        <input name="code" autocomplete="off" required />
      </label>
      <label>App password <span class="muted">(12+ characters; one password for the whole app)</span>
        <input name="password" type="password" autocomplete="new-password" minlength="12" required />
      </label>
      <label>Repeat it
        <input name="repeat" type="password" autocomplete="new-password" minlength="12" required />
      </label>
      <div class="two">
        <label>Your name <input name="name" placeholder="Alex" maxlength="40" required bind:value={name} /></label>
        <label>Profile id <input
            name="profile"
            placeholder="alex"
            pattern="[a-z][a-z0-9-]*"
            maxlength="32"
            required
            bind:value={profile}
            oninput={() => (profileEdited = profile !== '')}
          /></label
        >
      </div>
      <button class="btn">Finish setup</button>
      <p class="muted small">Next: System settings, where you add AI keys, apps and more profiles.</p>
    </form>
  {/if}
</div>

<style>
  .wrap {
    max-width: 460px;
    margin: var(--space-6) auto;
    display: grid;
    gap: var(--space-4);
    justify-items: center;
    text-align: center;
  }
  form {
    display: grid;
    gap: var(--space-3);
    width: 100%;
    text-align: left;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .muted {
    font-weight: 400;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .err {
    margin: 0;
    color: #c0392b;
  }
  .small {
    font-size: 0.8125rem;
    margin: 0;
  }
</style>
