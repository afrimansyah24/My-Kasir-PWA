/* My Kasir — service worker.
 *
 * Strategy:
 *   navigations  -> network first (so a fresh deploy is picked up), cache fallback
 *   static assets-> stale-while-revalidate (instant offline, updates in background)
 *   map tiles    -> network first with cache fallback
 */

const VERSION = 'mykasir-v1.12.0';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',

  './css/core.css',
  './css/base.css',
  './css/components.css',
  './css/layout.css',

  './js/util.js',
  './js/config.js',
  './js/settings.js',
  './js/api.js',
  './js/api.gas.js',
  './js/charts.js',
  './js/qr.js',
  './js/cart.js',
  './js/app.js',
  './js/map.js',
  './js/views/storefront.js',
  './js/views/portal.js',
  './js/views/queue.js',

  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/jsQR.js',

  './fonts/PlusJakartaSans-latin.woff2',
  './fonts/PlusJakartaSans-latin-ext.woff2',
  './fonts/JetBrainsMono-latin.woff2',
  './fonts/JetBrainsMono-latin-ext.woff2',

  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        // addAll is atomic: one 404 would void the whole install.
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL && key !== RUNTIME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Map tiles: network first, then cache.
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Navigations: network first so a new deploy is picked up immediately.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only a real document may replace the cached shell. A 404 page from
          // a static host (no SPA fallback) must not poison the cache, or the
          // next offline load would serve the error page instead of the app.
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put('./index.html', copy));
            return res;
          }
          // Deep link on a host without history fallback: serve the shell and
          // let the client-side router take over from the URL.
          return caches.match('./index.html').then((cached) => cached || res);
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  if (sameOrigin) {
    // config.js TIDAK boleh basi: isinya menentukan mode aplikasi
    // (demo lokal vs Google Sheets). Satu versi lama → aplikasi salah
    //_artikan dan tetap jalan di mode demo walaupun server sudah aktif.
    // Jadi config.js selalu diambil dari jaringan (fallback ke cache).
    if (url.pathname.endsWith('/js/config.js')) {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match(req))
      );
      return;
    }

    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
