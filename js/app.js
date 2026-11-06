/* My Kasir — application entry, router and shared chrome. */

import { $, h, icon, toast, esc, clamp, rupiah } from './util.js';
import * as api from './api.js';
import * as store from './store.js';
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
    const dir = new URL(entry, location.href).pathname.replace(/[^/]*$/, ''); // .../js/
    return dir.replace(/\/js\/$/, '/') || '/';
  } catch {
    return '/';
  }
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
 * Halaman deep-link di GitHub Pages menjawab 404 karena berkasnya memang tidak
 * ada. 404.html di repositori ini mengalihkan pengunjung ke `?/portal`. Pulihkan
 * kembali jalurnya lalu buang query artefak itu dari bilah alamat.
 */
function restoreDeepLink() {
  const q = location.search;
  if (!q || q.length < 2 || q[1] !== '/') return false;
  const decoded = q
    .slice(1)
    .split('&')
    .map((s) => s.replace(/~and~/g, '&'))
    .join('?');
  const qIdx = decoded.indexOf('?');
  const pathPart = qIdx >= 0 ? decoded.slice(0, qIdx) : decoded;
  const extra = qIdx >= 0 ? decoded.slice(qIdx) : '';
  history.replaceState({ app: true }, '', withBase(pathPart) + extra + location.hash);
  return true;
}

function route() {
  const path = normalizePath(location.pathname);

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

  // close any open drawer/scrim between navigations
  document.querySelectorAll('.drawer.is-open, .scrim.is-open').forEach((el) => {
    el.classList.remove('is-open');
  });

  render();
}

window.addEventListener('popstate', route);

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
    mountStorefront(view, { track: app.current === 'track', params: app.params });
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
  route();

  // Pengaturan dipakai sinkron oleh keranjang/struk/antrean — ambil sekali
  // di awal, lalu segarkan lagi setelah hydration selesai.
  refreshSettings();

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

  // cancel expired QRIS orders on boot and every minute
  api.cancelExpiredOnlineOrders();
  setInterval(() => api.cancelExpiredOnlineOrders(), 60_000);

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
