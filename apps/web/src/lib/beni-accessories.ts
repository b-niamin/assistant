/**
 * What Beni wears. Each accessory is a small SVG fragment in Beni's 64x64 box, drawn over the body, so
 * the same markup serves the Svelte mascot (Mascot.svelte) and the `<assistant-beni>` custom element of
 * onefile apps (extensions/theme.ts). Skin-coloured parts (hands) use `var(--beni-skin)`, the paws over
 * the eyes a lighter `var(--beni-paw)`; `CLIP` is
 * replaced by the id of the body's clip path. Which accessory fits where: `accessoryFor` in mascot.ts.
 *
 * Keep ACCESSORY_IDS in step with ACCESSORIES in apps/web/scripts/extensions-lib.mjs (a test checks).
 */

export const ACCESSORY_IDS = [
  'none',
  'headband',
  'stethoscope',
  'book',
  'wrench',
  'glasses',
  'headphones',
  'chef-hat',
  'pencil',
  'bulb',
  'coin',
  'umbrella',
  'party-hat',
  'nightcap'
] as const;

export type Accessory = (typeof ACCESSORY_IDS)[number];

export const isAccessory = (v: unknown): v is Accessory => typeof v === 'string' && (ACCESSORY_IDS as readonly string[]).includes(v);

const SKIN = 'style="fill: var(--beni-skin, #ff7527); stroke: rgb(0 0 0 / 0.18); stroke-width: 0.8"';

/** A hand (paw) at x, y, turned by deg. */
const hand = (x: number, y: number, deg = 0) =>
  `<ellipse class="hand" ${SKIN} cx="${x}" cy="${y}" rx="3.4" ry="2.6" transform="rotate(${deg} ${x} ${y})"/>`;

export const ACCESSORY_LABELS: Record<Accessory, string> = {
  none: 'Nothing',
  headband: 'Sweatband (sport, gym, running)',
  stethoscope: 'Stethoscope (health)',
  book: 'Open book (learning, reading)',
  wrench: 'Wrench (settings, tools)',
  glasses: 'Glasses (code, data, focus work)',
  headphones: 'Headphones (music, podcasts, calls)',
  'chef-hat': 'Chef hat (food, recipes, diet)',
  pencil: 'Pencil in hand (notes, calendar, to-dos)',
  bulb: 'Light bulb (smart home, ideas)',
  coin: 'Gold coin (money, budget)',
  umbrella: 'Umbrella (weather)',
  'party-hat': 'Party hat (celebrations, records)',
  nightcap: 'Nightcap (sleep, night)'
};

/** SVG fragments, in front of the body. */
export const ACCESSORY_SVG: Record<Accessory, string> = {
  none: '',
  headband:
    '<g clip-path="url(#CLIP)"><rect fill="#fff" x="0" y="21" width="64" height="6.5"/>' +
    '<rect class="band-stripe" fill="#2a78d6" x="0" y="23.4" width="64" height="1.6"/></g>' +
    '<g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round">' +
    '<path class="tail" d="M51.5 22.5q6 -2 8 -6"/><path class="tail tail-2" d="M52.5 25.5q6.5 0 9.5 -3"/></g>',
  stethoscope:
    '<g fill="none" stroke="#3d4757" stroke-width="2" stroke-linecap="round">' +
    '<path d="M13 33q-1 21 19 22q20 -1 19 -22"/><path d="M32 55q7 1 9.6 -1.2"/></g>' +
    '<g fill="#3d4757"><circle cx="13.2" cy="32" r="1.7"/><circle cx="50.8" cy="32" r="1.7"/></g>' +
    '<circle fill="#c7ced8" stroke="#3d4757" stroke-width="1.4" cx="44.4" cy="52.6" r="3.6"/>' +
    '<circle fill="#fff" cx="44.4" cy="52.6" r="1.4"/>',
  book:
    '<path fill="#2a78d6" d="M17.5 49.2v10.4q7.5-2 14.5 1.4q7-3.4 14.5-1.4V49.2z"/>' +
    '<path fill="#fff" d="M32 51.4q-6-3.6-13-2.2v9.4q7-1.2 13 2z"/><path fill="#f3f1ec" d="M32 51.4q6-3.6 13-2.2v9.4q-7-1.2-13 2z"/>' +
    '<g fill="none" stroke="#b9c3d0" stroke-width=".8" stroke-linecap="round">' +
    '<path d="M21 52.2q4-.6 8.4.8M21 54.6q4-.6 8.4.8M35 53q4.4-1.4 8.4-.8M35 55.4q4.4-1.4 8.4-.8"/></g>' +
    hand(17.8, 55.4, -20) +
    hand(46.2, 55.4, 20),
  wrench:
    '<g class="tool" transform="translate(57.5 32) rotate(28)">' +
    '<rect fill="#8b97a8" x="-1.7" y="2" width="3.4" height="15" rx="1.7"/>' +
    '<path fill="#a7b2c1" d="M1.8 -4.23A4.6 4.6 0 1 1 -1.8 -4.23L-1.8 -1L1.8 -1Z"/>' +
    hand(0, 12.5, 90) +
    '</g>',
  glasses:
    '<g fill="rgb(255 255 255 / 0.18)" stroke="#262a33" stroke-width="1.6">' +
    '<circle cx="24.6" cy="35" r="7.6"/><circle cx="39.4" cy="35" r="7.6"/></g>' +
    '<g fill="none" stroke="#262a33" stroke-width="1.6" stroke-linecap="round">' +
    '<path d="M31.6 33.6q.4-1.2.8 0"/><path d="M17 33.4L10.4 31.6M47 33.4L53.6 31.6"/></g>',
  headphones:
    '<path fill="none" stroke="#3b404c" stroke-width="3" stroke-linecap="round" d="M11.5 31Q10 6 32 5.5Q54 6 52.5 31"/>' +
    '<g fill="#2a78d6" stroke="#1d4f8f" stroke-width="1"><rect x="6.6" y="25.4" width="7.6" height="13" rx="3.4"/>' +
    '<rect x="49.8" y="25.4" width="7.6" height="13" rx="3.4"/></g>',
  'chef-hat':
    '<g fill="#fff" stroke="#d6d1c8" stroke-width="1.4"><circle cx="25" cy="6.4" r="5.4"/><circle cx="32" cy="3.6" r="6.2"/>' +
    '<circle cx="39" cy="6.4" r="5.4"/></g>' +
    '<g fill="#fff"><circle cx="25" cy="6.4" r="4.7"/><circle cx="32" cy="3.6" r="5.5"/><circle cx="39" cy="6.4" r="4.7"/></g>' +
    '<rect fill="#fff" stroke="#d6d1c8" stroke-width="1.2" x="22.4" y="8" width="19.2" height="6.4" rx="1.6"/>',
  pencil:
    '<g class="tool" transform="translate(59.5 38) rotate(200) scale(1.25)">' +
    '<rect fill="#f4b400" x="-1.9" y="-8" width="3.8" height="14"/><rect fill="#d99c00" x="-.5" y="-8" width="1" height="14"/>' +
    '<path fill="#f1d3a6" d="M-1.9 6L1.9 6L0 10.4Z"/><path fill="#33302b" d="M-.7 8.8L.7 8.8L0 10.4Z"/>' +
    '<rect fill="#c0c6cf" x="-1.9" y="-9.6" width="3.8" height="1.8"/><rect fill="#f08aa0" x="-1.9" y="-12" width="3.8" height="2.6" rx="1"/>' +
    hand(0, -4.5, 90) +
    '</g>',
  bulb:
    '<g class="glow" fill="none" stroke="#f2c230" stroke-width="1.3" stroke-linecap="round">' +
    '<path d="M50.5 -1.6v-2.2M43.6 1.6l-1.6-1.4M57.4 1.6l1.6-1.4M42 8h-2M59 8h2"/></g>' +
    '<circle fill="#ffd84d" stroke="#e0b21a" stroke-width="1" cx="50.5" cy="7" r="5.2"/>' +
    '<path fill="none" stroke="#e0a400" stroke-width=".9" d="M48.8 9.6l1.7-2.4l1.7 2.4"/>' +
    '<rect fill="#8b97a8" x="48.2" y="11.6" width="4.6" height="3.4" rx="1"/>',
  coin:
    '<circle fill="#f2c230" stroke="#c99a10" stroke-width="1.2" cx="50.5" cy="46.5" r="5.6"/>' +
    '<circle fill="none" stroke="#c99a10" stroke-width=".8" cx="50.5" cy="46.5" r="3.6"/>' +
    '<path fill="#fff" opacity=".7" d="M47.6 44.2q1.2-1.6 3-1.8"/>' +
    hand(48.6, 52.4, -15),
  umbrella:
    '<path fill="none" stroke="#3b404c" stroke-width="1.6" stroke-linecap="round" d="M32 -1v12"/>' +
    '<path fill="#2a78d6" d="M10 10Q12 -7 32 -7Q52 -7 54 10Q48.5 6 43 10Q37.5 6 32 10Q26.5 6 21 10Q15.5 6 10 10Z"/>' +
    '<path fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1" d="M21 10Q22 -2 32 -7M43 10Q42 -2 32 -7"/>' +
    '<circle fill="#3b404c" cx="32" cy="-7.6" r="1.3"/>',
  'party-hat':
    '<g transform="rotate(-14 32 12)"><path fill="#a35bd6" d="M23.5 13.5L32 -7L40.5 13.5Q32 15.6 23.5 13.5Z"/>' +
    '<path fill="#f2c230" d="M26.2 7L28.4 1.6L35.7 1.6L37.9 7Z" opacity=".9"/>' +
    '<circle fill="#f2c230" cx="32" cy="-7.4" r="2.6"/></g>',
  nightcap:
    '<path fill="#5b5bd6" d="M15.4 19.5Q17 3.5 33 3Q48 3 56.5 20.5Q51 12.6 47.4 15.2Q32 9 15.4 19.5Z"/>' +
    '<path fill="none" stroke="#4646b8" stroke-width="4.8" stroke-linecap="round" d="M15.8 19.4Q32 9.6 47.6 16.6"/>' +
    '<path fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" d="M15.8 19.4Q32 9.6 47.6 16.6"/>' +
    '<circle fill="#fff" stroke="#4646b8" stroke-width=".9" cx="56.8" cy="21.6" r="2.8"/>'
};

/**
 * Hands over the eyes (password fields): a short arm up from the belly, a palm and three fingers fanned
 * over the eye, a thumb tucked towards the nose. Drawn twice, a slightly fatter dark copy under the fill,
 * so the outline goes round the whole hand instead of every finger. The right hand mirrors the left; a
 * peek slides the left one down so one eye shows.
 */
const HAND_PARTS = (w: number) =>
  `<path d="M21.2 49.4L23.6 41" stroke-width="${5 + w}"/>` +
  `<ellipse cx="24.8" cy="36.2" rx="${6.4 + w / 2}" ry="${5.6 + w / 2}"/>` +
  `<path d="M21 35L20.2 29.4M24.8 34.6V28.4M28.6 35L29.4 29.4" stroke-width="${4.6 + w}"/>` +
  `<path d="M29.4 40.2L30.6 38.4" stroke-width="${3.2 + w}"/>`;
const HAND =
  `<g stroke="rgb(0 0 0 / 0.3)" fill="rgb(0 0 0 / 0.3)" stroke-linecap="round">${HAND_PARTS(1.4)}</g>` +
  `<g style="fill: var(--beni-paw, #ff9a5c); stroke: var(--beni-paw, #ff9a5c)" stroke-linecap="round">${HAND_PARTS(0)}</g>` +
  '<path fill="none" stroke="rgb(0 0 0 / 0.22)" stroke-width=".7" stroke-linecap="round" d="M22.8 31.6l.3 2.2M26.8 31.6l-.3 2.2"/>';
export const SHY_SVG =
  `<g class="hands"><g class="hand-l">${HAND}</g>` +
  `<g class="hand-r"><g transform="matrix(-1 0 0 1 64 0)">${HAND}</g></g></g>`;

/** The fragment for one accessory, with the clip path id filled in. */
export function accessorySvg(a: Accessory, clipId: string): string {
  return ACCESSORY_SVG[a].replaceAll('CLIP', clipId);
}
