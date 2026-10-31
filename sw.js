/* Vishesh Workout Studio service worker.
 * Saves the app shell so the app opens offline. It does NOT touch YouTube, imported videos or any
 * other data: videos live in IndexedDB and are read by the page itself, not by this worker.
 *
 * TO PUBLISH AN UPDATE: change VERSION below whenever you change any app file. The browser sees the
 * changed sw.js, downloads all files fresh into a NEW cache, and the app offers an "Update now" button.
 * The old version keeps working until you tap it, so an update can never break a running workout.
 */
const VERSION = '2026-10-31-v1';
const CACHE = 'vws-' + VERSION;
const SHELL = ['./', './index.html', './styles.css', './core.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' skips the browser's HTTP cache so a new version never stores stale copies
    await Promise.all(SHELL.map(async url => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error('Could not cache ' + url + ' (' + res.status + ')');
      await cache.put(url, res);
    }));
    // no skipWaiting here on purpose: the page asks for it when the person taps "Update now"
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf('vws-') === 0 && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // YouTube, thumbnails etc. are never touched
  if (req.mode === 'navigate') {
    const p = url.pathname;
    if (p.endsWith('/') || p.endsWith('/index.html')) {
      event.respondWith(caches.match('./index.html', { cacheName: CACHE }).then(r => r || fetch(req)));
    }
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(r => r || fetch(req)));
});
