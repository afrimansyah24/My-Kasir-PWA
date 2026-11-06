/* My Kasir — application entry, router and shared chrome. */

import { $, h, icon, toast, esc, clamp, rupiah } from './util.js';
import * as api from './api.js';
import * as store from './store.js';
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

/** Navigate without a full page load. */
export function go(path, { replace = false } = {}) {
  const url = new URL(path, location.origin);
  if (replace) history.replaceState({}, '', url.pathname + url.search);
  else history.pushState({}, '', url.pathname + url.search);
  route();
}

function route() {
  const path = location.pathname;
  let matched = null;
  let params = {};

  for (const r of ROUTES) {
    const m = path.match(r.path);
    if (m) {
      matched = r.view;
      params = m.slice(1);
      break;
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

function boot() {
  applyTheme(currentTheme());
  loadCart();

  app.root = document.getElementById('app');
  route();

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
