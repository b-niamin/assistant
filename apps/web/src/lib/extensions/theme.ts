/**
 * The shell's look for onefile apps. Their iframe cannot load the shell's stylesheet (opaque origin,
 * strict CSP), so the host inlines two things in front of the app:
 *
 * - the design tokens of app.css (`--page`, `--surface`, `--ink`, `--accent`, `--space-*`, ...), light and
 *   dark, inside `@layer assistant` so the app's own unlayered rules still win;
 * - the shell's checkboxes, radios, switches, sliders and picker buttons (lib/controls.css) and its components
 *   (lib/ui.css: .btn*, .card, .list, .segmented, .stepper, .chip, .glass, ...), in the same layer;
 * - `<assistant-mascot mood="steady" size="48">`: Pingo, the mascot, as a custom element (shadow DOM, so
 *   its SVG ids and styles never clash with the app). Moods: idle, steady, charged, tired, asleep.
 *   `accessory="book"` dresses it (mascot-accessories.ts); without the attribute it wears the app's own
 *   (`window.assistantMascot.accessory`, from the manifest). It covers its eyes by itself while a password
 *   field has focus; `shy` (or `shy="peek"`) forces that.
 *
 * Native extensions get the same look from the shell itself (`$shell/ui`, the classes in app.css).
 */
import appCss from '../../app.css?raw';
import controlsCss from '../controls.css?raw';
import uiCss from '../ui.css?raw';
import beanSvg from '../../../static/mascot-bean.svg?raw';
import penguinSvg from '../../../static/mascot-penguin.svg?raw';
import { DEFAULT_APPEARANCE, type Appearance } from '../appearance';
import { ACCESSORY_IDS, accessorySvg, SHY_SVG, type Accessory } from '../mascot-accessories';

/** The token part of app.css: everything before the first element rule (`*,`). */
export function tokensOf(css: string): string {
  const end = css.search(/^\*,/m);
  const head = end === -1 ? css : css.slice(0, end);
  return head.replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

/** Pingo's static drawing without the title, the fixed size and the headband (an accessory now). */
export function pipMarkup(svg: string): string {
  return svg
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<rect fill="#fff" x="0" y="21"[^>]*\/>\s*<rect fill="#2a78d6"[^>]*\/>/, '')
    .replace(/<g fill="none" stroke="#fff" stroke-width="2.6"[^>]*>[\s\S]*?<\/g>/, '')
    .replace(/<svg[^>]*>/, (tag) => tag.replace(/\s(width|height)="[^"]*"/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const PIP_CSS = `
:host { display: inline-block; line-height: 0; }
svg { width: 100%; height: 100%; overflow: visible; }
.body { transform-origin: 50% 90%; }
:host([mood='steady']) .body { animation: breathe 3.6s ease-in-out infinite; }
:host([mood='charged']) .body { animation: hop 1.4s ease-in-out infinite; }
:host([mood='tired']) .body { animation: sway 4s ease-in-out infinite; }
:host([mood='tired']) .eyes, :host([mood='asleep']) .eyes { transform: scaleY(0.25); transform-origin: 50% 55%; }
:host([mood='asleep']) .body { animation: breathe 5s ease-in-out infinite; }
@keyframes breathe { 50% { transform: scale(1.03, 0.97); } }
@keyframes hop { 40% { transform: translateY(-6%); } 60% { transform: translateY(0) scale(1.04, 0.96); } }
@keyframes sway { 50% { transform: rotate(-3deg); } }
@keyframes flutter { 50% { transform: rotate(-14deg); } }
.acc { display: none; }
${ACCESSORY_IDS.map((a) => `:host([accessory='${a}']) .acc-${a}`).join(', ')} { display: inline; }
:host([mood='asleep'][accessory='none']) .acc-nightcap { display: inline; }
.tail { transform-box: fill-box; transform-origin: 0 50%; animation: flutter 1.6s ease-in-out infinite; }
.tail-2 { animation-delay: -0.4s; }
.cover { opacity: 0; transform: translateY(-14px); transition: transform 260ms cubic-bezier(0.3, 1.3, 0.5, 1), opacity 160ms ease-out; }
.mask { transform-box: fill-box; transform-origin: center; transition: transform 260ms cubic-bezier(0.3, 1.3, 0.5, 1); }
:host([shy]) .cover, :host([covering]) .cover { opacity: 1; transform: none; }
:host([shy='peek']) .mask, :host([covering='peek']) .mask { transform: translateY(-6px) rotate(14deg); }
@media (prefers-reduced-motion: reduce) { .body, .tail { animation: none !important; } .cover, .mask { transform-box: fill-box; transform-origin: center; transition: none; } }
`;

/** Every accessory, hidden until the host's `accessory` attribute picks one, plus the sleep mask. */
function dressing(): string {
  const parts = ACCESSORY_IDS.filter((a) => a !== 'none').map((a) => `<g class="acc acc-${a}">${accessorySvg(a, 'b')}</g>`);
  return parts.join('') + `<g class="cover">${SHY_SVG}</g>`;
}

/** Script defining <assistant-mascot>; `svg` is Pingo's markup. */
export function pipElementScript(svg: string): string {
  // Wrap the drawing in .body and the eyes (white + pupils + glints) in .eyes for the mood styles.
  const drawn = svg
    .replace(/(<svg[^>]*>)/, '$1<g class="body">')
    .replace(/<\/svg>$/, `${dressing()}</g></svg>`)
    .replace(/(<circle fill="#fff" cx="24\.6"[\s\S]*?<g fill="#fff">[\s\S]*?<\/g>)/, '<g class="eyes">$1</g>');
  const template = JSON.stringify(`<style>${PIP_CSS}</style>${drawn}`)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `(function () {
  if (!window.customElements || customElements.get('assistant-mascot')) return;
  var html = ${template};
  var own = (window.assistantMascot && window.assistantMascot.accessory) || 'none';
  // Cover the eyes while a password field has focus; peek when it is revealed (type flipped to text).
  function secrecy() {
    var el = document.activeElement;
    if (!el || el.tagName !== 'INPUT') return '';
    if (el.type === 'password') return 'hidden';
    var marked = /password/.test(el.autocomplete || '') || el.hasAttribute('data-secret');
    return marked && el.type === 'text' ? 'peek' : '';
  }
  function check() {
    var s = secrecy();
    var all = document.querySelectorAll('assistant-mascot');
    for (var i = 0; i < all.length; i++) {
      if (s) all[i].setAttribute('covering', s === 'peek' ? 'peek' : ''); else all[i].removeAttribute('covering');
    }
  }
  document.addEventListener('focusin', check);
  document.addEventListener('focusout', function () { setTimeout(check, 0); });
  if (window.MutationObserver)
    new MutationObserver(check).observe(document.documentElement, { subtree: true, attributeFilter: ['type'] });
  customElements.define('assistant-mascot', class extends HTMLElement {
    static get observedAttributes() { return ['size', 'label']; }
    connectedCallback() {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = html;
      if (!this.hasAttribute('accessory')) this.setAttribute('accessory', own);
      this.update();
    }
    attributeChangedCallback() { if (this.shadowRoot) this.update(); }
    update() {
      var size = parseInt(this.getAttribute('size') || '64', 10) || 64;
      this.style.width = this.style.height = size + 'px';
      var label = this.getAttribute('label');
      if (label) { this.setAttribute('role', 'img'); this.setAttribute('aria-label', label); }
      else this.setAttribute('aria-hidden', 'true');
    }
  });
})();`;
}

/** The static drawing of a mascot kind (static/mascot-<kind>.svg). */
export const mascotSvg = (kind: Appearance['kind']) => (kind === 'bean' ? beanSvg : penguinSvg);

/**
 * Everything a onefile app gets in front of its own code: a <style> and a <script>. `appearance` (System
 * settings -> Appearance) picks the mascot's kind and the accent theme (html[data-accent] in the iframe).
 */
export function themeTags(
  css = appCss,
  appearance: Appearance = DEFAULT_APPEARANCE,
  accessory: Accessory = 'none',
  controls = controlsCss + '\n' + uiCss
): string {
  const tokens = tokensOf(css).replace(/<\/style/gi, '<\\/style');
  const look = controls.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/<\/style/gi, '<\\/style');
  const mascot = { accessory, name: appearance.name, kind: appearance.kind };
  const accent = appearance.accent === 'lagoon' ? '' : `document.documentElement.setAttribute('data-accent', ${JSON.stringify(appearance.accent)});`;
  return (
    `<style id="assistant-theme">@layer assistant { ${tokens} ${look} }</style>` +
    `<script>${accent}window.assistantMascot = Object.freeze(${JSON.stringify(mascot).replace(/</g, '\\u003c')});` +
    `${pipElementScript(pipMarkup(mascotSvg(appearance.kind)))}</script>`
  );
}
