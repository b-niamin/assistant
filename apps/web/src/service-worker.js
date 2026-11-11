// Plain JS, left out of the app's type check (vite.config.ts): it runs in a worker scope, not a page.
/**
 * The installed app (manifest.webmanifest, display: standalone) away from the tailnet: instead of the
 * browser's error page, a page that says to turn on Tailscale (audit report W9). Nothing else is cached:
 * every request still goes to the network, so updates and data are never stale.
 */
/** @type {ServiceWorkerGlobalScope} */
const sw = /** @type {any} */ (self);
const CACHE = 'offline-v1';
const OFFLINE = '/offline.html';

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/favicon.svg'])).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()));
});
