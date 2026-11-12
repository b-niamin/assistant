<script lang="ts">
  /** The wizard's frame: Beni, the steps so far, and the step's page in one column. */
  import { page } from '$app/state';
  import { SETUP_STEPS, stepIndex } from '#lib/setup/steps.ts';
  import { tFor, useT } from '#lib/i18n/index.ts';
  let { data, children } = $props();
  const shell = useT();
  // Step 1 runs before any language is set: it speaks the browser's (its load picks it).
  const t = $derived(page.data.setupLang ? tFor(page.data.setupLang) : shell);
  const at = $derived(stepIndex(page.url.pathname));
</script>

<div class="wizard" lang={page.data.setupLang ?? data.lang}>
  <ol class="steps" aria-label={t('Setup steps')}>
    {#each SETUP_STEPS as s, i (s.href)}
      <li class:done={i < at} class:now={i === at} aria-current={i === at ? 'step' : undefined}>
        <span class="n" aria-hidden="true">{i < at ? '✓' : i + 1}</span>
        <span class="l">{t(s.label)}</span>
      </li>
    {/each}
  </ol>
  {@render children()}
</div>

<style>
  .wizard {
    max-width: 560px;
    margin: var(--space-5) auto var(--space-7);
    display: grid;
    gap: var(--space-5);
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
    counter-reset: s;
  }
  .steps li {
    display: grid;
    justify-items: center;
    gap: 6px;
    position: relative;
    font-size: var(--text-xs);
    color: var(--ink-3);
    text-align: center;
  }
  .steps li + li::before {
    content: '';
    position: absolute;
    top: 13px;
    right: calc(50% + 18px);
    width: calc(100% - 36px + var(--space-2));
    height: 2px;
    border-radius: 2px;
    background: var(--grid);
  }
  .steps li.done::before,
  .steps li.now::before {
    background: var(--brand);
  }
  .n {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--axis);
    background: var(--surface);
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  .done .n {
    background: var(--brand);
    box-shadow: none;
    color: #fff;
  }
  .now .n {
    box-shadow: inset 0 0 0 2px var(--brand);
    color: var(--ink);
  }
  .now .l {
    color: var(--ink);
    font-weight: var(--weight-medium);
  }
  /* Parts the steps share. */
  .wizard :global(.intro) {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    text-align: center;
  }
  .wizard :global(.intro h1) {
    margin: 0;
    font-size: var(--text-xl);
  }
  .wizard :global(.intro p) {
    margin: 0;
    color: var(--ink-2);
    max-width: 46ch;
  }
  .wizard :global(.nav) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .wizard :global(.nav .skip) {
    color: var(--ink-2);
    font-size: var(--text-sm);
  }
  .wizard :global(.choice) {
    display: grid;
    gap: var(--space-2);
  }
  .wizard :global(.choice label) {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--ring);
    cursor: pointer;
  }
  .wizard :global(.choice label:has(input:checked)) {
    box-shadow: 0 0 0 1.5px var(--accent);
    background: var(--accent-wash);
  }
  .wizard :global(.choice input) {
    margin-top: 3px;
  }
  .wizard :global(.choice .txt) {
    display: grid;
    gap: 2px;
  }
  .wizard :global(.meta) {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .wizard :global(.err) {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-left: 3px solid var(--critical);
    color: var(--critical-ink);
  }
  @media (max-width: 480px) {
    .l {
      display: none;
    }
    .now .l {
      display: block;
    }
  }
</style>
