<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  let { form } = $props();
</script>

<form method="POST" class="card login rise">
  <div class="pip"><Mascot mood="charged" size={84} label="Beni, the assistant mascot. Click me." /></div>
  <div>
    <h1>Assistant</h1>
    <p class="muted">Enter the app password to continue.</p>
  </div>
  <label>
    <span class="eyebrow">Password</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input type="password" name="password" autocomplete="current-password" required autofocus />
  </label>
  {#if form?.error}<p class="status critical" role="alert">{form.error}</p>{/if}
  <button class="btn btn-primary">Log in</button>
</form>

<style>
  .login {
    max-width: 360px;
    margin: 14vh auto 0;
    display: grid;
    gap: var(--space-4);
    padding: var(--space-6);
  }
  .pip {
    justify-self: start;
    margin: -8px 0 -4px -6px;
  }
  h1 {
    font-size: 1.375rem;
  }
  p {
    margin: var(--space-1) 0 0;
    font-size: 0.875rem;
  }
  label {
    display: grid;
    gap: 6px;
  }
  input {
    width: 100%;
  }
  .status {
    margin: 0;
    color: var(--ink);
  }
</style>
