/**
 * Hosting One File Apps (github.com/b-niamin/onefile-apps) inside the shell.
 *
 * The app runs in an iframe that is sandboxed WITHOUT allow-same-origin, so it gets an opaque origin:
 * it cannot read the shell's cookies, call the shell's API, or touch the parent page. Its CSP keeps
 * connect-src 'none', so it cannot phone home either. Its localStorage is replaced by a shim that is
 * pre-filled with the extension's stored data and posts every write to the parent, which saves it in
 * core.extension_kv. sessionStorage gets an in-memory shim (the real ones throw in an opaque origin).
 */

/** CSP for the iframe document. `sandbox` makes the browser sandbox it even if opened directly. */
export const ONEFILE_CSP = [
  // No allow-popups: a popup is a new top-level window that the shell's frame-src cannot hold back,
  // so an app could carry its data out in the URL. No allow-same-origin, no allow-top-navigation.
  'sandbox allow-scripts allow-forms allow-downloads allow-modals',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'"
].join('; ');

/** Value for the iframe's sandbox attribute (must match the CSP above). */
export const ONEFILE_SANDBOX = 'allow-scripts allow-forms allow-downloads allow-modals';

/** Marker on every message the shim posts, so the host ignores anything else. */
export const KV_MESSAGE = '__assistantKv';

/** JSON safe to inline in a <script>: no `</script>`, no HTML comment openers, no U+2028/9. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The storage shim, run as the first script of the app. */
export function shimScript(data: Record<string, string>, parentOrigin: string, versions: Record<string, number> = {}): string {
  return `(function () {
  'use strict';
  var initial = ${inlineJson(data)};
  var parentOrigin = ${inlineJson(parentOrigin)};
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function post(msg) {
    msg[${inlineJson(KV_MESSAGE)}] = 1;
    try { window.parent.postMessage(msg, parentOrigin); } catch (e) {}
  }
  function makeStorage(store, persist) {
    var api = {
      getItem: function (k) { k = String(k); return has(store, k) ? store[k] : null; },
      setItem: function (k, v) {
        k = String(k); v = String(v); store[k] = v;
        if (persist) post({ op: 'set', key: k, value: v });
      },
      removeItem: function (k) {
        k = String(k); if (!has(store, k)) return; delete store[k];
        if (persist) post({ op: 'remove', key: k });
      },
      clear: function () {
        for (var k in store) if (has(store, k)) delete store[k];
        if (persist) post({ op: 'clear' });
      },
      key: function (i) { var ks = Object.keys(store); return i >= 0 && i < ks.length ? ks[i] : null; }
    };
    // Proxy so storage.foo / storage['foo'] = 'x' / Object.keys(storage) behave like the real thing.
    return new Proxy(api, {
      get: function (t, p) {
        if (p === 'length') return Object.keys(store).length;
        if (has(t, p)) return t[p];
        return typeof p === 'string' && has(store, p) ? store[p] : undefined;
      },
      set: function (t, p, v) { if (typeof p === 'string') api.setItem(p, v); return true; },
      deleteProperty: function (t, p) { if (typeof p === 'string') api.removeItem(p); return true; },
      has: function (t, p) { return has(t, p) || (typeof p === 'string' && has(store, p)); },
      ownKeys: function () { return Object.keys(store); },
      getOwnPropertyDescriptor: function (t, p) {
        return typeof p === 'string' && has(store, p)
          ? { value: store[p], writable: true, enumerable: true, configurable: true } : undefined;
      }
    });
  }
  // The versions this data was loaded at: the host sends them with each save, so a save over a key that
  // changed elsewhere since (another device, Claude) is refused instead of overwriting it.
  post({ op: 'hello', versions: ${inlineJson(versions)} });
  var local = makeStorage(initial, true);
  var session = makeStorage({}, false);
  try { Object.defineProperty(window, 'localStorage', { value: local, configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true }); } catch (e) {}
})();`;
}

/** Put the shim in front of every other script of the app. */
export function injectShim(
  html: string,
  data: Record<string, string>,
  parentOrigin: string,
  settings: Record<string, unknown> = {},
  theme = '',
  lang = 'en',
  versions: Record<string, number> = {}
): string {
  // theme: the shell's tokens and <assistant-beni> (theme.ts), so every app wears the shell's look.
  // window.assistantSettings: the values of the app's settings panel in System settings (read-only).
  // window.assistantLang: the shell's language (spec 007); an app that speaks it uses it over its own guess.
  const code = /^[a-z]{2}$/.test(lang) ? lang : 'en';
  const tag =
    `<script>window.assistantSettings = Object.freeze(${inlineJson(settings)});` +
    `window.assistantLang = ${inlineJson(code)};document.documentElement.lang = window.assistantLang;` +
    `${shimScript(data, parentOrigin, versions)}</script>${theme}`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const doctype = /<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype.index + doctype[0].length) + tag + html.slice(doctype.index + doctype[0].length);
  return tag + html;
}
