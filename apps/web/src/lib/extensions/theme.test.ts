import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pipElementScript, pipMarkup, themeTags, tokensOf } from './theme';

// Vitest turns CSS imports (even ?raw) into empty strings, so the tests read the real files.
const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');
const svg = readFileSync(new URL('../../../static/mascot-bean.svg', import.meta.url), 'utf8');
const bean = { name: 'Pingo', kind: 'bean' as const, accent: 'lagoon' as const };
const controls = readFileSync(new URL('../controls.css', import.meta.url), 'utf8');

describe('onefile theme', () => {
  it('takes only the token blocks of app.css', () => {
    const sample = ':root {\n  --ink: #000; /* note */\n}\n\n*,\n*::before { box-sizing: border-box; }\nbody { margin: 0; }';
    expect(tokensOf(sample)).toBe(':root {\n  --ink: #000; \n}');
  });

  it('inlines the real tokens, light and dark, in a layer', () => {
    const tags = themeTags(css, bean);
    expect(tags).toMatch(/^<style id="assistant-theme">@layer assistant \{ :root \{/);
    expect(tags).toContain('--accent:');
    expect(tags).toContain("[data-theme='dark']");
    expect(tags).not.toContain('box-sizing');
  });

  it('gives onefile apps the shell checkboxes in the same layer, without comments', () => {
    const tags = themeTags(css, bean, 'none', ":where(input[type='checkbox']) { appearance: none; } /* zz-comment */");
    expect(tags).toContain(":where(input[type='checkbox']) { appearance: none; } }</style>");
    expect(tags).not.toContain('zz-comment');
    expect(themeTags(css, bean, 'none', controls)).toContain("input[type='checkbox'][role='switch']");
  });

  it('defines <assistant-mascot> with the eyes wrapped for moods and no raw tags in the script', () => {
    const script = pipElementScript(pipMarkup('<svg viewBox="0 0 64 64" width="256" height="256"><title>Pingo</title><circle fill="#fff" cx="24.6" cy="35" r="6.2"/><g fill="#fff"><circle cx="1"/></g></svg>'));
    expect(script).toContain("customElements.define('assistant-mascot'");
    expect(script).not.toMatch(/<\/?(svg|style|script)/);
    const html = JSON.parse(/var html = (".*");/.exec(script)![1]);
    expect(html).toContain('<g class="body">');
    expect(html).toContain('<g class="eyes">');
    expect(html).not.toContain('width="256"');
    expect(html).not.toContain('<title>');
  });

  it('draws the penguin with its eyes wrapped too, and sets the accent theme', () => {
    const tags = themeTags(css, { name: 'Tux', kind: 'penguin', accent: 'iris' });
    expect(tags).toContain('class=\\"eyes\\"');
    expect(tags).toContain("setAttribute('data-accent', \"iris\")");
    expect(tags).toContain('"name":"Tux"');
  });

  it('wraps the eyes of the real Pingo too', () => {
    const tags = themeTags(css, bean);
    expect(tags).toContain('class=\\"eyes\\"');
    expect(tags).toContain('width=\\"64\\"'); // the headband rect keeps its size
  });

  it('turns the headband into one accessory among many and passes the own accessory of the app', () => {
    expect(pipMarkup(svg)).not.toContain('y="21"');
    const tags = themeTags(css, bean, 'book');
    expect(tags).toContain('window.assistantMascot = Object.freeze({"accessory":"book","name":"Pingo","kind":"bean"})');
    expect(tags).toContain('acc-headband');
    expect(tags).toContain('acc-stethoscope');
    expect(tags).toContain("class=\\\"cover\\\"");
    expect(tags).toContain("setAttribute('covering'");
  });
});
