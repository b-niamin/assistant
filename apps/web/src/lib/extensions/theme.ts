/**
 * The shell's look for onefile apps. Their iframe cannot load the shell's stylesheet (opaque origin,
 * strict CSP), so the host inlines two things in front of the app:
 *
 * - the design tokens of app.css (`--page`, `--surface`, `--ink`, `--accent`, `--space-*`, ...), light and
 *   dark, inside `@layer assistant` so the app's own unlayered rules still win;
 * - `<assistant-pip mood="steady" size="48">`: Pip, the mascot, as a custom element (shadow DOM, so
 *   its SVG ids and styles never clash with the app). Moods: idle, steady, charged, tired, asleep.
 *
 * Native extensions get the same look from the shell itself (`$shell/ui`, the classes in app.css).
 */
import appCss from '../../app.css?raw';
import pipSvg from '../../../static/pip.svg?raw';

/** The token part of app.css: everything before the first element rule (`*,`). */
export function tokensOf(css: string): string {
  const end = css.search(/^\*,/m);
  const head = end === -1 ? css : css.slice(0, end);
  return head.replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

/** Pip's static drawing without the title and the fixed size, ready for any size. */
export function pipMarkup(svg: string): string {
  return svg
    .replace(/<title>[\s\S]*?<\/title>/, '')
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
@media (prefers-reduced-motion: reduce) { .body { animation: none !important; } }
`;

/** Script defining <assistant-pip>; `svg` is Pip's markup. */
export function pipElementScript(svg: string): string {
  // Wrap the drawing in .body and the eyes (white + pupils + glints) in .eyes for the mood styles.
  const drawn = svg
    .replace(/(<svg[^>]*>)/, '$1<g class="body">')
    .replace(/<\/svg>$/, '</g></svg>')
    .replace(/(<circle fill="#fff" cx="24\.6"[\s\S]*?<g fill="#fff">[\s\S]*?<\/g>)/, '<g class="eyes">$1</g>');
  const template = JSON.stringify(`<style>${PIP_CSS}</style>${drawn}`)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  return `(function () {
  if (!window.customElements || customElements.get('assistant-pip')) return;
  var html = ${template};
  customElements.define('assistant-pip', class extends HTMLElement {
    static get observedAttributes() { return ['size', 'label']; }
    connectedCallback() {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = html;
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

/** Everything a onefile app gets in front of its own code: a <style> and a <script>. */
export function themeTags(css = appCss, svg = pipSvg): string {
  const tokens = tokensOf(css).replace(/<\/style/gi, '<\\/style');
  return (
    `<style id="assistant-theme">@layer assistant { ${tokens} }</style>` +
    `<script>${pipElementScript(pipMarkup(svg))}</script>`
  );
}
