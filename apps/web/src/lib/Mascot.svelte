<script lang="ts">
  import { reducedMotion } from '#lib/motion.ts';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { accessoryFor, type Accessory, type Mood } from './mascot';
  import { accessorySvg, SHY_SVG } from './beni-accessories';
  import { beniWatch, watchSecrets } from './beni-watch.svelte';

  /**
   * Beni: a jelly-bean runner that dresses for the page. Pure SVG + CSS (transform/opacity only), so it costs
   * nothing to animate. Mood picks the idle loop; a click makes it bounce; pupils follow the pointer.
   * Everything stands still under prefers-reduced-motion.
   *
   * What Beni wears follows the page (`accessoryFor`: the app's own accessory, a wrench in settings, ...)
   * unless `accessory` names one; an asleep Beni with nothing else on gets a nightcap. While a password
   * field has focus Beni pulls a sleep mask over its eyes (`shy`), and peeks when the password is revealed.
   */
  let {
    mood = 'idle',
    size = 96,
    label = 'Beni',
    decorative = false,
    accessory = 'auto',
    shy = 'auto'
  }: {
    mood?: Mood;
    size?: number;
    label?: string;
    decorative?: boolean;
    accessory?: Accessory | 'auto';
    shy?: boolean | 'peek' | 'auto';
  } = $props();

  const uid = $props.id();
  let el: SVGSVGElement;
  let boing = $state(false);
  let look = $state({ x: 0, y: 0 });

  const worn = $derived.by((): Accessory => {
    if (accessory !== 'auto') return accessory;
    const a = accessoryFor(page.url?.pathname ?? '/', page.data?.extensions ?? []);
    return a === 'none' && mood === 'asleep' ? 'nightcap' : a;
  });
  const covering = $derived.by(() => {
    if (shy !== 'auto') return shy === true ? 'hidden' : shy === 'peek' ? 'shown' : 'none';
    return beniWatch.secrecy;
  });

  function poke() {
    boing = false;
    requestAnimationFrame(() => (boing = true));
  }

  onMount(() => {
    watchSecrets();
    if (reducedMotion()) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.55);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 240);
        look = { x: (dx / d) * 1.8 * k, y: (dy / d) * 1.4 * k };
      });
    };
    addEventListener('pointermove', onMove);
    return () => {
      removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  });
</script>

<svelte:element
  this={decorative ? 'span' : 'button'}
  class="pip {mood} wears-{worn}"
  class:boing
  class:shy={covering === 'hidden'}
  class:peek={covering === 'shown'}
  onclick={decorative ? undefined : poke}
  onanimationend={() => (boing = false)}
  aria-label={decorative ? undefined : label}
  aria-hidden={decorative ? 'true' : undefined}
  type={decorative ? undefined : 'button'}
  role={decorative ? undefined : 'button'}
>
  <svg bind:this={el} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
    <defs>
      <clipPath id="{uid}-body">
        <path d="M32 11C47 11 56 26 56 41 56 51.6 46 56 32 56 18 56 8 51.6 8 41 8 26 17 11 32 11Z" />
      </clipPath>
    </defs>

    <ellipse class="shadow" cx="32" cy="59.4" rx="16" ry="2.2" />

    <g class="spark">
      <path d="M9 14q0 4 4 4q-4 0-4 4q0-4-4-4q4 0 4-4Z" />
      <path d="M55 9q0 3 3 3q-3 0-3 3q0-3-3-3q3 0 3-3Z" />
      <path d="M58 30q0 2.4 2.4 2.4q-2.4 0-2.4 2.4q0-2.4-2.4-2.4q2.4 0 2.4-2.4Z" />
    </g>

    <g class="body">
      <path class="skin" d="M32 11C47 11 56 26 56 41 56 51.6 46 56 32 56 18 56 8 51.6 8 41 8 26 17 11 32 11Z" />
      <g clip-path="url(#{uid}-body)">
        <ellipse class="belly" cx="32" cy="50" rx="17" ry="9" />
      </g>
      <ellipse class="shine" cx="20.6" cy="17" rx="3.6" ry="1.8" transform="rotate(-35 20.6 17)" />

      <g class="eyes">
        <g class="blink">
          <circle class="white" cx="24.6" cy="35" r="6.2" />
          <circle class="white" cx="39.4" cy="35" r="6.2" />
          <g class="pupils" style:transform="translate({look.x}px, {look.y}px)">
            <circle cx="25" cy="35.6" r="3.3" />
            <circle cx="39.8" cy="35.6" r="3.3" />
            <circle class="glint" cx="26.2" cy="34.2" r="1" />
            <circle class="glint" cx="41" cy="34.2" r="1" />
          </g>
        </g>
        <g class="lids">
          <rect x="17.5" y="27.4" width="14.2" height="7.4" />
          <rect x="32.3" y="27.4" width="14.2" height="7.4" />
        </g>
      </g>
      <g class="shut">
        <path d="M19.8 35.6q4.8 3.2 9.6 0" />
        <path d="M34.6 35.6q4.8 3.2 9.6 0" />
      </g>

      <g class="cheeks">
        <ellipse cx="16.8" cy="43.4" rx="3" ry="1.8" />
        <ellipse cx="47.2" cy="43.4" rx="3" ry="1.8" />
      </g>
      <path class="mouth smile" d="M28 45.2q4 3.4 8 0" />
      <path class="mouth flat" d="M29 46.4h6" />
      <ellipse class="mouth snore" cx="32" cy="46.6" rx="1.8" ry="1.4" />

      {#key worn}<g class="acc">{@html accessorySvg(worn, `${uid}-body`)}</g>{/key}
      <g class="cover">{@html SHY_SVG}</g>
    </g>

    <g class="zzz">
      <text x="46" y="16">z</text>
      <text x="52" y="9">z</text>
      <text x="58" y="3">Z</text>
    </g>
  </svg>
</svelte:element>

<style>
  .pip {
    --m: oklch(0.72 0.19 45);
    --m-dk: color-mix(in oklch, var(--m), black 30%);
    --m-lt: color-mix(in oklch, var(--m), white 45%);
    --m-ink: color-mix(in oklch, var(--m), black 75%);
    display: inline-block;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    line-height: 0;
    -webkit-tap-highlight-color: transparent;
  }
  svg {
    display: block;
    overflow: visible;
  }
  svg * {
    transform-box: fill-box;
    transform-origin: center;
  }
  .skin {
    fill: var(--m);
  }
  .belly {
    fill: var(--m-lt);
    opacity: 0.35;
  }
  .pip {
    --beni-skin: var(--m);
  }
  .pip :global(.band-stripe) {
    fill: var(--accent);
  }
  .cover {
    opacity: 0;
    transform: translateY(-14px);
    transform-origin: 50% 0;
  }
  .shy .cover,
  .peek .cover {
    opacity: 1;
    transform: none;
  }
  .peek .cover :global(.mask) {
    transform: translateY(-6px) rotate(14deg);
  }
  .shy .pupils,
  .peek .pupils {
    transform: none !important;
  }
  .shy .cheeks {
    fill: oklch(0.68 0.2 15 / 0.75);
  }
  .shine {
    fill: #fff;
    opacity: 0.45;
  }
  .white {
    fill: #fff;
  }
  .pupils {
    fill: var(--m-ink);
    transition: transform 160ms ease-out;
    transform-origin: 0 0;
  }
  .glint {
    fill: #fff;
  }
  .lids rect {
    fill: var(--m);
    opacity: 0;
  }
  .shut path {
    fill: none;
    stroke: var(--m-ink);
    stroke-width: 1.8;
    stroke-linecap: round;
    opacity: 0;
  }
  .cheeks {
    fill: oklch(0.72 0.16 15 / 0.55);
  }
  .mouth {
    fill: none;
    stroke: var(--m-ink);
    stroke-width: 1.8;
    stroke-linecap: round;
  }
  .flat,
  .snore {
    opacity: 0;
  }
  .snore {
    fill: var(--m-ink);
    stroke: none;
  }
  .shadow {
    fill: #000;
    opacity: 0.12;
  }
  .spark path {
    fill: oklch(0.8 0.16 85);
    opacity: 0;
  }
  .zzz text {
    font: 700 9px/1 var(--font);
    fill: var(--ink-3);
    opacity: 0;
  }

  /* Moods (static part) */
  .tired .lids rect {
    opacity: 1;
  }
  .tired .smile,
  .asleep .smile,
  .idle .smile {
    opacity: 0;
  }
  .tired .flat,
  .idle .flat {
    opacity: 1;
  }
  .asleep .eyes {
    opacity: 0;
  }
  .asleep .shut path,
  .asleep .snore {
    opacity: 1;
  }
  .charged :global(.tail) {
    stroke: var(--accent);
  }

  @media (prefers-reduced-motion: no-preference) {
    .body {
      animation: breathe 3.2s ease-in-out infinite;
      transform-origin: 50% 100%;
    }
    .blink {
      animation: blink 4.6s infinite;
    }
    .pip :global(.tail) {
      animation: flutter 1.6s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: 0 50%;
    }
    .pip :global(.tail-2) {
      animation-delay: -0.4s;
    }
    .pip :global(.glow) {
      animation: glow 2.4s ease-in-out infinite;
    }
    .acc {
      animation: pop-on 0.45s cubic-bezier(0.3, 1.4, 0.5, 1);
    }
    .cover,
    .cover :global(.mask) {
      transition:
        transform 260ms cubic-bezier(0.3, 1.3, 0.5, 1),
        opacity 160ms ease-out;
    }

    .charged .body {
      animation: hop 2.8s cubic-bezier(0.3, 0, 0.3, 1) infinite;
    }
    .charged .shadow {
      animation: shadow-hop 2.8s cubic-bezier(0.3, 0, 0.3, 1) infinite;
    }
    .charged .spark path {
      animation: twinkle 2.8s ease-in-out infinite;
    }
    .charged .spark path:nth-child(2) {
      animation-delay: -0.9s;
    }
    .charged .spark path:nth-child(3) {
      animation-delay: -1.8s;
    }
    .charged :global(.tail) {
      animation-duration: 0.6s;
    }

    .tired .body {
      animation: sway 5s ease-in-out infinite;
    }
    .tired :global(.tail) {
      animation-duration: 3.2s;
    }
    .tired .blink {
      animation-duration: 3s;
    }

    .asleep .body {
      animation: breathe 5.5s ease-in-out infinite;
    }
    .asleep :global(.tail) {
      animation: none;
    }
    .asleep .zzz text {
      animation: zzz 3.6s ease-out infinite;
    }
    .asleep .zzz text:nth-child(2) {
      animation-delay: 1.2s;
    }
    .asleep .zzz text:nth-child(3) {
      animation-delay: 2.4s;
    }
    .asleep .snore {
      animation: snore 5.5s ease-in-out infinite;
    }

    .boing svg {
      animation: boing 0.7s cubic-bezier(0.3, 0, 0.3, 1);
      transform-origin: 50% 100%;
    }
    .pip:hover .body {
      animation-duration: 1.4s;
    }
  }

  @keyframes glow {
    50% {
      opacity: 0.25;
    }
  }
  @keyframes pop-on {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.6);
    }
  }
  @keyframes breathe {
    50% {
      transform: scale(1.03, 0.97);
    }
  }
  @keyframes blink {
    0%,
    91%,
    97%,
    100% {
      transform: scaleY(1);
    }
    94% {
      transform: scaleY(0.1);
    }
  }
  @keyframes flutter {
    50% {
      transform: rotate(-14deg);
    }
  }
  @keyframes hop {
    0%,
    30%,
    100% {
      transform: translateY(0) scale(1, 1);
    }
    5% {
      transform: translateY(0) scale(1.08, 0.92);
    }
    14% {
      transform: translateY(-9px) scale(0.95, 1.06);
    }
    22% {
      transform: translateY(0) scale(1.06, 0.94);
    }
    26% {
      transform: translateY(0) scale(0.98, 1.02);
    }
  }
  @keyframes shadow-hop {
    0%,
    30%,
    100% {
      transform: scale(1);
      opacity: 0.12;
    }
    14% {
      transform: scale(0.6);
      opacity: 0.05;
    }
  }
  @keyframes twinkle {
    0%,
    60%,
    100% {
      opacity: 0;
      transform: scale(0.2) rotate(0deg);
    }
    15% {
      opacity: 1;
      transform: scale(1) rotate(45deg);
    }
  }
  @keyframes sway {
    0%,
    100% {
      transform: rotate(-3deg) scale(1, 1);
    }
    50% {
      transform: rotate(3deg) scale(1.02, 0.98);
    }
  }
  @keyframes zzz {
    0% {
      opacity: 0;
      transform: translate(0, 4px) scale(0.6);
    }
    30% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(4px, -6px) scale(1.1);
    }
  }
  @keyframes snore {
    50% {
      transform: scale(1.4);
    }
  }
  @keyframes boing {
    0% {
      transform: scale(1, 1);
    }
    15% {
      transform: scale(1.18, 0.8);
    }
    40% {
      transform: translateY(-14px) scale(0.9, 1.12);
    }
    65% {
      transform: translateY(0) scale(1.1, 0.9);
    }
    82% {
      transform: scale(0.97, 1.03);
    }
    100% {
      transform: none;
    }
  }
</style>
