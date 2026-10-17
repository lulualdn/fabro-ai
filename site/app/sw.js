// Fabro Anywhere service worker: works offline (app shell + the phone model's code), shows notifications
// sent by the computer (Web Push), and opens the right conversation when one is tapped.
const VERSION = '__VERSION__';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'steps.js', 'i18n.js', 'core.js', 'theme.js', 'scan-worker.js', 'manifest.webmanifest',
  'vendor/marked.umd.js', 'vendor/purify.min.js', 'icons/icon.svg', 'icons/mark.svg', 'icons/icon-192.png', 'icons/badge.png'];
const SHELL_CACHE = 'fa-shell-' + VERSION, RUNTIME = 'fa-runtime';

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fa-shell-') && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the app itself: cache first, refreshed in the background
  if (url.origin === location.origin && url.pathname.startsWith('/app/')) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || (await cache.match('index.html'));
    })());
    return;
  }
  // the phone model's code (WebLLM from jsDelivr): kept for offline use; model weights are cached by WebLLM itself
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r;
    })());
  }
});
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible') && m.tag !== 'test') return; // the app is open: it shows the answer itself
    await self.registration.showNotification(m.title || 'Fabro', { body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag, data: { convId: m.convId || null }, icon: 'icons/icon-192.png', badge: 'icons/badge.png' });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const convId = e.notification.data && e.notification.data.convId;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).pathname.startsWith('/app/'));
    if (w) { await w.focus(); if (convId) w.postMessage({ type: 'open', convId }); return; }
    await self.clients.openWindow('./' + (convId ? '?c=' + encodeURIComponent(convId) : ''));
  })());
});
