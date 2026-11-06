/* My Kasir — application entry, router and shared chrome. */

import { $, h, icon, toast, esc, clamp, rupiah } from './util.js';
import * as api from './api.js';
import { refreshSettings } from './settings.js';
import { gasConfigHint } from './config.js';
import { loadCart, subscribe as subscribeCart } from './cart.js';
import { mountStorefront } from './views/storefront.js';
import { mountPortal } from './views/portal.js';
import { mountQueueScreen } from './views/queue.js';

/* -------------------------------------------------------------------------
   Router
   ---------------------------------------------------------------------- */

const ROUTES = [
  { path: /^\/$/, view: 'storefront' },
  { path: /^\/belanja$/, view: 'storefront' },
  { path: /^\/lacak$/, view: 'track' },
  { path: /^\/lacak\/([A-Z0-9-]+)$/, view: 'track' },
  { path: /^\/portal$/, view: 'portal' },
  { path: /^\/portal\/(.*)$/, view: 'portal' },
  { path: /^\/antrean$/, view: 'queue' },
];

const app = {
  root: null,
  params: {},
  current: null,
  onLeave: null,   // callback view sebelum dilepas (mis. hentikan polling)
};

/* -------------------------------------------------------------------------
   Base path
   ---------------------------------------------------------------------- */

/**
 * Alamat dasar tempat aplikasi di-host.
 *
 * GitHub Pages (dan sejenisnya) menyajikan repo di sub-folder, misalnya
 * `/My-Kasir-PWA/`. Kalau dibiarkan, semua tautan absolut (href: '/portal')
 * akan mengarah ke akar domain — layanan yang bukan aplikasi ini — dan rute
 * `location.pathname` tak akan pernah cocok karena selalu diawali prefiks repo.
 *
 * BASE dihitung dari lokasi skrip entry (./js/app.js yang pasti berada di
 * folder `js/`), sehingga otomatis benar baik di root domain maupun di
 * sub-folder. Di luar peramban (saat modul diimpor oleh skrip tools) BASE
 * bernilai '' sehingga perilaku lama tetap berlaku.
 */
const BASE = (() => {
  if (typeof document === 'undefined') return '';   // dipanggil di luar peramban
  try {
    // src berbentuk absolut setelah `document.scripts` dibaca, jadi aman dipecah.
    const entry = document.querySelector('script[src*="js/app.js"]')?.src;
    if (!entry) return '/';
    // .../js/app.js -> .../js/ -> .../  (tanpa garis miring ganda di akhir)
    const dir = new URL(entry, location.href).pathname.replace(/[^/]*$/, '');
    const base = dir.replace(/\/js\/$/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
    return base ? base + '/' : '/';
  } catch {
    return '/';
  }
})();

/**
 * Pasang <base href> supaya semua URL relatif menunjuk ke folder aplikasi.
 *
 * Tanpa ini, halaman pada deep-link seperti /My-Kasir-PWA/portal membuat
 * "./assets/produk.webp" dan "./sw.js" salah resolve ke /My-Kasir-PWA/portal/…
 * sehingga_many aset 404 dan service worker gagal terdaftar.
 */
(() => {
  if (typeof document === 'undefined' || !BASE || BASE === '/') return;
  if (document.querySelector('base[href]')) return;
  const base = document.createElement('base');
  base.href = new URL(BASE, location.href).href;
  document.head.prepend(base);
})();

/** Tempel BASE di depan path versi aplikasi ('/' -> '/My-Kasir-PWA/').
 *  Dipakai view sebagai `href: withBase('/portal')` agar tautan absolut tetap
 *  menunjuk ke aplikasi ini saat repo di-host pada sub-folder. */
export function withBase(path) {
  const raw = String(path ?? '/');
  if (!raw.startsWith('/') || !BASE || BASE === '/') return raw;
  return BASE + raw.replace(/^\/+/, '');
}

/** Buang BASE dari pathname milik server, agar cocok dengan ROUTES. */
function normalizePath(pathname) {
  let p = String(pathname || '/');
  if (BASE && BASE !== '/') {
    const root = BASE.replace(/\/$/, '');
    if (p === root) p = '/';
    else if (p.startsWith(BASE)) p = '/' + p.slice(BASE.length);
    else return null;              // path di luar cakupan aplikasi
  }
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
  return p;
}

/** Navigate without a full page load. */
export function go(path, { replace = false } = {}) {
  const raw = String(path ?? '/');
  const url = raw.startsWith('/') ? new URL(withBase(raw), location.href) : new URL(raw, location.href);
  const dest = `${url.pathname}${url.search}${url.hash}`;
  if (replace) history.replaceState({ app: true }, '', dest);
  else history.pushState({ app: true }, '', dest);
  route();
}

/**
 * Halaman deep-link di GitHub Pages menjawab 404 karena berkafasnya memang
 * tidak ada. 404.html mengarahkan pengunjung ke `?/portal`.
 *
 * Path asli TIDAK ditulis balik ke bilah alamat: path itu tidak punya berkas,
 * jadi setiap reload (atau saat pengguna menyalin URL) akan 404 lagi.
 * Sebaliknya path asli disimpan di sessionStorage dan dibaca router dari sana.
 * Begitu pengguna Bergenavigasi lewat tautan dalam aplikasi, URL menjadi
 * normal dan artefak `?/` hilang.
 */
const DEEP_LINK_KEY = 'mykasir.deeplink';

function restoreDeepLink() {
  const q = location.search;
  if (!q || q.length < 2 || q[1] !== '/') return false;

  const decoded = q
    .slice(1)
    .split('&')
    .map((s) => s.replace(/~and~/g, '&'))
    .join('&');

  const qIdx = decoded.indexOf('?');
  let pathPart = qIdx >= 0 ? decoded.slice(0, qIdx) : decoded;
  const extra = qIdx >= 0 ? decoded.slice(qIdx) : '';

  // 404.html menulis "portal" (tanpa garis miring depan) -> normalkan.
  if (!pathPart.startsWith('/')) pathPart = '/' + pathPart;
  pathPart = pathPart.replace(/\/{2,}/g, '/');
  if (pathPart.length > 1) pathPart = pathPart.replace(/\/+$/, '') || '/';

  try {
    sessionStorage.setItem(DEEP_LINK_KEY, pathPart + extra);
  } catch { /* ignore */ }
  return true;
}

/** Path yang tersimpan dari deep-link, kalau ada. */
function pendingDeepLink() {
  try {
    return sessionStorage.getItem(DEEP_LINK_KEY) || '';
  } catch {
    return '';
  }
}

function route() {
  // Deep-link dari 404.html diprioritaskan: pathname saat ini masih "/"
  // (atau path lain), sedangkan path yang benar tersimpan di sessionStorage.
  //
  // Catatan: path yang disimpan sudah relatif-aplikasi ("/portal"), bukan
  // path server — jadi tidak boleh lewat normalizePath (yang menambah BASE).
  const pending = pendingDeepLink();
  let path = normalizePath(location.pathname);
  if (pending) {
    const deep = pending.split('?')[0].replace(/\/{2,}/g, '/');
    if (deep) path = deep;
    try { sessionStorage.removeItem(DEEP_LINK_KEY); } catch { /* ignore */ }
  }

  let matched = null;
  let params = {};

  // path === null berarti URL di luar cakupan aplikasi; layar depan dipakai.
  if (path) {
    for (const r of ROUTES) {
      const m = path.match(r.path);
      if (m) {
        matched = r.view;
        params = m.slice(1);
        break;
      }
    }
  }

  app.params = params;
  app.current = matched || 'storefront';

  // Beri view sebelumnya kesempatan membersihkan diri (polling, timer).
  if (typeof app.onLeave === 'function') {
    try { app.onLeave(); } catch { /* ignore */ }
    app.onLeave = null;
  }

  // close any open drawer/scrim between navigations
  document.querySelectorAll('.drawer.is-open, .scrim.is-open').forEach((el) => {
    el.classList.remove('is-open');
  });

  render();
}

window.addEventListener('popstate', route);

/**
 * Tautan internal ditangani di sisi klien (SPA), bukan memuat ulang halaman.
 *
 * Tanpa ini, setiap klik ke "/portal" atau "/lacak" memicu permintaan ke
 * server. Di GitHub Pages path seperti itu tidak punya berkas -> 404.
 * Dengan History API, halaman tidak pernah dimuat ulang dan tidak pernah 404.
 */
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const link = e.target.closest?.('a[href]');
  if (!link) return;
  if (link.target && link.target !== '_self') return;
  if (link.hasAttribute('download')) return;
  if (link.getAttribute('href')?.startsWith('#')) return;

  const href = link.getAttribute('href');
  let url;
  try {
    url = new URL(href, location.href);
  } catch {
    return;
  }
  if (url.origin !== location.origin) return;

  // Normalkan ke path versi aplikasi (tanpa BASE) supaya cocok dengan ROUTES.
  const appPath = normalizePath(url.pathname);
  if (appPath === null) return;

  e.preventDefault();
  go(appPath + url.search + url.hash);
});

/* -------------------------------------------------------------------------
   Chrome
   ---------------------------------------------------------------------- */

function aurora() {
  return h('div.aurora', { 'aria-hidden': 'true' },
    h('div.aurora__orb.aurora__orb--1'),
    h('div.aurora__orb.aurora__orb--2'),
    h('div.aurora__orb.aurora__orb--3')
  );
}

function render() {
  const root = app.root;
  root.innerHTML = '';
  root.append(aurora());

  const view = h('div.view.is-active');

  if (app.current === 'portal') {
    mountPortal(view, app.params);
  } else if (app.current === 'queue') {
    mountQueueScreen(view);
  } else {
    // Katalog yang sudah di-fetch saat boot diteruskan ke storefront,
    // supaya tidak ada permintaan kedua ke server.
    const catalog = app.catalogPromise;
    mountStorefront(view, {
      track: app.current === 'track',
      params: app.params,
      initialData: catalog,
    });
  }

  root.append(view);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* -------------------------------------------------------------------------
   Service worker + install prompt
   ---------------------------------------------------------------------- */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker gagal didaftarkan', err);
    });
  });
}

let deferredPrompt = null;

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBar();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBar();
    toast('My Kasir terpasang di perangkat Anda', 'ok');
  });
}

function showInstallBar() {
  if (document.querySelector('.install-bar')) return;
  const bar = h('div.install-bar',
    h('span', null, 'Pasang My Kasir untuk akses cepat'),
    h('button.btn.btn--sm.btn--primary', {
      onclick: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        hideInstallBar();
      },
    }, 'Pasang'),
    h('button.btn.btn--sm.btn--icon.btn--ghost', {
      'aria-label': 'Tutup',
      onclick: hideInstallBar,
    }, icon('close'))
  );
  document.body.append(bar);
  requestAnimationFrame(() => bar.classList.add('is-up'));
}

function hideInstallBar() {
  const bar = document.querySelector('.install-bar');
  if (!bar) return;
  bar.classList.remove('is-up');
  setTimeout(() => bar.remove(), 400);
}

/* -------------------------------------------------------------------------
   Offline indicator
   ---------------------------------------------------------------------- */

function setupOfflineBar() {
  const bar = h('div.offline-bar', null, 'Anda sedang offline — data tersimpan lokal di perangkat');
  document.body.append(bar);

  const sync = () => {
    if (navigator.onLine) {
      bar.classList.remove('is-up');
      document.body.style.paddingTop = '';
    } else {
      bar.classList.add('is-up');
      document.body.style.paddingTop = '30px';
    }
  };

  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}

/* -------------------------------------------------------------------------
   Theme
   ---------------------------------------------------------------------- */

const THEME_KEY = 'mykasir.theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function currentTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'light';
  } catch {
    return 'light';
  }
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/* -------------------------------------------------------------------------
   Boot
   ---------------------------------------------------------------------- */

/**
 * Katalog terakhir yang disimpan di localStorage (L2).
 * Dipakai agar refresh halaman tidak kembali ke layar "Memuat…" kosong.
 */
function readCatalogSeed() {
  const PERSIST_KEY = 'mykasir.cache.v1';
  const MAX_AGE = 12 * 60 * 60_000;
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw);
    const hit = store.getPublicCatalogData;
    if (!hit?.value) return null;
    if (Date.now() - (hit.fetchedAt || 0) > MAX_AGE) return null;
    const v = hit.value;
    if (!v || v.ok === false || !v.store || !Array.isArray(v.products)) return null;
    return v;
  } catch {
    return null;
  }
}

function showBootError(message) {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';
  root.append(
    h('div.gate', null,
      h('div.gate__card', null,
        h('div.gate__logo', null, icon('alert')),
        h('h1.t-h1', null, 'Konfigurasi backend'),
        h('p.t-body.mt-2.gate__error', null, message),
        h('p.t-sm.mt-3', null, 'Buka berkas js/config.js — GAS_URL = URL Web App (/exec). Spreadsheet ID hanya di Apps Script → Script properties (SPREADSHEET_ID).'),
        h('button.btn.btn--primary.mt-5', { onclick: () => location.reload() }, 'Muat ulang')
      )
    )
  );
}

function boot() {
  const misconfig = gasConfigHint();
  if (misconfig) {
    showBootError(misconfig);
    return;
  }

  applyTheme(currentTheme());
  loadCart();

  app.root = document.getElementById('app');
  restoreDeepLink();

  // Pengaturan & katalog diambil BERSAMAAN. Di mode GAS permintaan yang
  // muncul bersamaan digabung jadi satu eksekusi Apps Script — jadi
  // render pertama hanya butuh 1Network call, bukan 2.
  const seededCatalog = readCatalogSeed();

  const hydration = Promise.all([
    refreshSettings(),
    seededCatalog
      ? Promise.resolve(seededCatalog)
      : api.getPublicCatalogData().catch(() => null),
  ]);

  // Bila katalog sudah ditampilkan dari snapshot, tetap segarkan di latar.
  if (seededCatalog) {
    Promise.resolve().then(() => api.getPublicCatalogData().catch(() => null));
  }

  // Simpan katalog hasil boot; dipakai storefront agar tak request 2x.
  app.catalogPromise = hydration.then(([, catalog]) => catalog || undefined);

  route();

  hydration.finally(() => {
    // Segarkan pengaturan di cache supaya struk/keranjang/antrean memakai
    // nilai terbaru dari server.
    refreshSettings();
  });

  // Prefetch SELURUH data portal dalam satu eksekusi Apps Script.
  //
  // Tanpa ini, tiap menu portal (dashboard, produk, transaksi, antrean,
  // pengaturan) menembak server sendiri — 2-4 detik per menu, dan itulah
  // sebab "server lambat merespons" muncul. Setelah prefetch, semua menu
  // dilayani dari cache L2 secara instan.
  //
  // Dijalankan di latar belakang: etalase tetap tampil tanpa menunggu.
  const prefetch = () => {
    if (document.hidden) return;
    api.prefetchPortal?.().catch(() => { /* ignore */ });
  };
  setTimeout(prefetch, 400);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) prefetch();
  });

  registerSW();
  setupInstallPrompt();
  setupOfflineBar();

  // keep the cart badge in sync across views
  subscribeCart((c) => {
    const n = c?.count ?? 0;
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = String(n);
      el.dataset.empty = n === 0 ? '1' : '0';
    });
  });

  // Cancel expired QRIS orders.
  //
  // Di mode GAS setiap panggilan = 1 eksekusi Apps Script (2-3 detik).
  // Menjalankannya tiap menit entertained adalah pemborosan; cukup setiap
  // 5 menit, dan hanya saat tab sedang terlihat.
  let expiredTimer = null;
  const runExpiry = () => {
    if (document.hidden) return;
    api.cancelExpiredOnlineOrders();
  };
  runExpiry();
  expiredTimer = setInterval(runExpiry, 300_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) runExpiry();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      document.querySelector('[data-search]')?.focus();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { app, currentTheme, applyTheme };
