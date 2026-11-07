/**
 * My Kasir — konektor Google Apps Script.
 *
 * Apps Script ContentService tidak mengirim header CORS, jadi fetch() lintas
 * origin ditolak browser. Yang andal tanpa hosting lain adalah JSONP:
 * sisipkan <script src="...exec?action=...&cb=callback"> lalu ambil hasilnya
 * dari fungsi callback global.
 *
 * Semua parameter dikirim lewat query string (payload sudah JSON-safe).
 * Operasi tulis memakai aksi yang sama seperti mode lokal, jadi bentuk
 * respons di js/api.js tidak berubah sama sekali.
 *
 * ---------------------------------------------------------------------------
 * Kenapa lambat? & apa yang diperbaiki
 * ---------------------------------------------------------------------------
 * 1) Apps Script = satu eksekusi baru tiap permintaan (1-3 detik cold start).
 *    Dulu setiap layar portal menembak 2-3 permintaan -> 5-9 detik.
 *    SEKARANG: permintaan yang muncul bersamaan digabung jadi satu
 *    `getPortalBundle` (satu eksekusi, banyak data).
 *
 * 2) Cache lama hanya "menunggu" (blocking) selama 20 detik. resulted cache
 *    basi selama 20 detik, dan tidak ada pembaruan di latar belakang.
 *    SEKARANG: stale-while-revalidate — data lama langsung ditampilkan,
 *    lalu diperbarui di belakang layar (tetap "real time").
 *
 * 3) `config.js` sempat tersaji basi dari cache service worker sehingga
 *    aplikasi mengira mode demo. Sekarang config.js selalu diambil dari
 *    jaringan (lihat sw.js) dan aplikasi memeriksa ulang saat boot.
 */

import { GAS_URL, GAS_TOKEN, isGasConfigured } from './config.js';

const TIMEOUT = 30000;

/* ==========================================================================
   Cache: stale-while-revalidate + de-dupe
   --------------------------------------------------------------------------
   READ : hasil lama langsung dipakai, lalu request baru dikirim di latar
          belakang. Data tetap segar tanpa menunggu server.
   WRITE: langsung, lalu cache dibuang.
   ========================================================================== */

const READ_TTL = 60_000;   // dianggap basi setelah 1 menit
const LONG_TTL = 5 * 60_000;   // data yang jarang berubah (produk, kategori, settings)

const TTL_BY_ACTION = {
  getSettings: LONG_TTL,
  getCategories: LONG_TTL,
  getProducts: LONG_TTL,
  getUsers: LONG_TTL,
  getDashboardData: LONG_TTL,
  getTransactions: LONG_TTL,
  // Etalase jarang berubah; tanpa ini setiap kunjungan memicu eksekusi
  // Apps Script tiap 15 detik — itulah sebab "Memuat…" lama.
  getPublicCatalogData: LONG_TTL,
  // Antrean & pesanan online berubah cepat (kasir menandai status).
  // TTL pendek supaya data benar-benar real time, dan revalidasi berjalan
  // di latar belakang tanpa pernah menahan layar.
  getQueue: 20_000,
  getOnlineOrders: 20_000,
};

const cache = new Map();     // key -> { value, fetchedAt, revalidating }
const inflight = new Map();   // key -> Promise

/* -------------------------------------------------------------------------
   Cache persisten (L2 — localStorage)
   --------------------------------------------------------------------------
   Tanpa ini setiap refresh = reload penuh: katalog hilang lalu ditunggu
   1-3 detik (atau lebih) sampai Apps Script menjawab.

   Dengan L2, data terakhir yang diketahui langsung tampil seketika saat
   aplikasi dibuka ulang, lalu diperbarui di latar belakang
   (stale-while-revalidate). Efeknya: katalog tidak pernah "kosong" dan
   halaman tidak pernah lama tertahan "Memuat…".
   ---------------------------------------------------------------------- */

const PERSIST_KEY = 'mykasir.cache.v2';

/** Aksi yang layak disimpan (hasilnya kecil & sering dipakai). */
const PERSIST_ACTIONS = new Set([
  'getPublicCatalogData',
  'getSettings',
  'getCategories',
  'getProducts',
  // Dashboard = layar yang paling sering terlihat "Memuat…". Snapshot lama
  // tetap ditampilkan dulu, lalu diperbarui di latar belakang (SWR).
  'getDashboardData',
  'getTransactions',
  'getQueue',
  'getOnlineOrders',
  'getUsers',
]);

/** Umur maksimum data persisten yang masih boleh ditampilkan (ms). */
const PERSIST_MAX_AGE = {
  getSettings: 10 * 60_000,             // pengaturan: 10 menit
  getDashboardData: 60 * 60_000,        // ringkasan: 1 jam (lalu revalidate)
  getTransactions: 30 * 60_000,         // daftar transaksi: 30 menit
  // Katalog publik: 30 menit, BUKAN 12 jam.
  //
  // Data katalog publik memuat koordinat toko. Kalau snapshot ini bertahan
  // 12 jam di perangkat pelanggan, peta delivery menampilkan lokasi toko
  // LAMA selama itu — padahal owner sudah memindahkan tokonya.
  getPublicCatalogData: 30 * 60_000,
  getCategories: 30 * 60_000,
  getProducts: 30 * 60_000,
  // Antrean & pesanan: 2 menit. Cukup untuk tampil instan, tapi tetap
  // direvalidasi supaya kasir melihat perubahan status dalam hitungan detik.
  getQueue: 2 * 60_000,
  getOnlineOrders: 2 * 60_000,
  getUsers: 30 * 60_000,
};

/** Batas ukuran agar localStorage tidak meledak (base64 gambar produk). */
const PERSIST_MAX_CHARS = 1_600_000;

let persistStore = null;

function loadPersist() {
  if (persistStore) return persistStore;
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    persistStore = raw ? JSON.parse(raw) : {};
    if (!persistStore || typeof persistStore !== 'object') persistStore = {};
  } catch {
    persistStore = {};
  }
  return persistStore;
}

function persistRead(action, payload) {
  if (!PERSIST_ACTIONS.has(action)) return null;
  const key = cacheKey(action, payload);
  const hit = loadPersist()[key];
  if (!hit || !hit.value) return null;
  const maxAge = PERSIST_MAX_AGE[action] ?? PERSIST_MAX_AGE.getPublicCatalogData;
  if (Date.now() - (hit.fetchedAt || 0) > maxAge) return null;
  return hit;
}

function persistWrite(action, payload, value) {
  if (!PERSIST_ACTIONS.has(action)) return;
  const key = cacheKey(action, payload);
  const store = { ...loadPersist(), [key]: { value, fetchedAt: Date.now() } };
  try {
    let raw = JSON.stringify(store);
    // Keluarkan entri tertua bila terlalu besar (gambar produk = base64).
    while (raw.length > PERSIST_MAX_CHARS) {
      const keys = Object.keys(store).sort(
        (a, b) => (store[a].fetchedAt || 0) - (store[b].fetchedAt || 0)
      );
      if (keys.length <= 1) break;
      delete store[keys[0]];
      raw = JSON.stringify(store);
    }
    localStorage.setItem(PERSIST_KEY, raw);
    persistStore = store;
  } catch {
    /* localStorage penuh / diblokir -> cache persisten dilewati */
  }
}

function persistClear() {
  persistStore = {};
  try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
}

/**
 * Kabari pemanggil bahwa data segar tiba di latar belakang.
 *
 * Toko (& portal) mendengarkan event ini untuk memperbarui tampilan —
 * contoh: owner mematikan "Pesanan online" -> storefront langsung berubah
 * menjadi "toko online belum dibuka" tanpa perlu refresh manual.
 */
function dispatchFresh(action, value) {
  try {
    window.dispatchEvent(new CustomEvent('mykasir:fresh', { detail: { action, value } }));
  } catch { /* ignore */ }
}

/** Simpan hasil ke cache memori (+ L2 bila respons sukses) + kabari pendengar. */
function storeResult(action, payload, key, value) {
  const ok = value && typeof value === 'object' && value.ok !== false;
  cache.set(key, { value, fetchedAt: Date.now(), revalidating: false });
  if (ok) persistWrite(action, payload, value);
  if (ok) dispatchFresh(action, value);
  return value;
}

/** Tanam entri L1 dari L2 — memakai cap waktu lama agar TTL/SWR benar. */
function seedFromPersist(action, payload) {
  const hit = persistRead(action, payload);
  if (!hit?.value) return null;
  const key = cacheKey(action, payload);
  cache.set(key, { value: hit.value, fetchedAt: hit.fetchedAt, revalidating: false });
  return cache.get(key);
}

/** Kunci cache untuk sebuah aksi + payload. */
function cacheKey(action, payload) {
  const keys = Object.keys(payload || {}).sort();
  if (!keys.length) return action;
  return `${action}:${keys.map((k) => `${k}=${JSON.stringify(payload[k])}`).join('&')}`;
}

/** Aksi yang mengubah data — cache-nya harus dibuang setelah berhasil. */
const WRITE_ACTIONS = new Set([
  'saveProductRecord', 'deleteProductRecord',
  'saveCategoryRecord', 'deleteCategoryRecord',
  'saveUserRecord', 'deleteUserRecord',
  'saveSettings', 'deleteTransactionRecord',
  'setOrderStatus', 'assignCourier', 'setQueueEntryStatus', 'adjustStockRecord',
  'saveTransaction', 'createOnlineOrder', 'payOrder',
  'setupDatabase', 'resetDemoData', 'importDatabase',
]);

/**
 * Apakah backend mendukung aksi `getPortalBundle`?
 *
 * Backend lama (belum di-deploy ulang) menjawab "Aksi tidak dikenal".
 * Setelah diketahui, jangan coba bundle lagi — langsung pakai permintaan
 * biasa supaya tidak membuang satu panggilan tiap render.
 */
let bundleSupported = null;

/**
 * Jendela "abaikan cache" (ms).
 *
 * Dipasang oleh `bustCache()` (tombol Segarkan). Selama jendela ini terbuka,
 * semua aksi baca membaca langsung dari server — baik cache memori maupun
 * snapshot persisten dilewati — sehingga pengguna benar-benar melihat data
 * terbaru, bukan salinan lama.
 */
let forceNetworkUntil = 0;

function isForced() {
  return Date.now() < forceNetworkUntil;
}

/**
 * Buang cache memori + pastikan snapshot persisten (L2) tidak menahan
 * perubahan baru (dipakai setelah mutasi).
 *
 * L2 tidak dihapus mentah-mentah — layar berikutnya tetap boleh menampilkan
 * cadangan terakhir secara seketika. Sebagai gantinya:
 *   1. cap waktu entri dimundurkan melewati TTL miliknya sendiri, sehingga
 *      entri selalu dianggap BASI -> selalu ada revalidasi ke server;
 *   2. entri `getSettings` dihapus, supaya "Simpan" lalu `refreshSettings()`
 *      membaca nilai BARU dari server (bukan cadangan pra-simpan).
 */
function invalidateCache() {
  cache.clear();

  const now = Date.now();
  const store = loadPersist();
  let changed = false;

  for (const key of Object.keys(store)) {
    const entry = store[key];
    if (!entry) continue;

    const action = key.includes(':') ? key.slice(0, key.indexOf(':')) : key;

    // Pengaturan harus dibaca ulang dari server setelah penulisan.
    if (action === 'getSettings' || action === 'getPublicCatalogData') {
      delete store[key];
      changed = true;
      continue;
    }

    const ttl = TTL_BY_ACTION[action] || READ_TTL;
    const staleAt = now - (ttl + 1_000);
    if ((entry.fetchedAt || 0) > staleAt) {
      entry.fetchedAt = staleAt;
      changed = true;
    }
  }

  if (changed) {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(store));
    } catch { /* ignore */ }
  }
}

/** Nama callback unik per permintaan. */
function callbackName() {
  counter += 1;
  return `__mykasir_cb_${Date.now().toString(36)}_${counter}`;
}

let counter = 0;

/**
 * Panggil backend GAS lewat JSONP.
 * Resolves dengan objek hasil; menolak dengan Error bila timeout/gagal.
 */
function call(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!isGasConfigured()) {
      reject(new Error('Backend GAS belum dikonfigurasi'));
      return;
    }

    const cb = callbackName();
    const params = new URLSearchParams();
    params.set('action', action);
    params.set('cb', cb);
    if (GAS_TOKEN) params.set('token', GAS_TOKEN);

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') {
        params.set(key, JSON.stringify(value));
      } else {
        params.set(key, String(value));
      }
    }

    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      try { script.remove(); } catch { /* ignore */ }
      try { delete window[cb]; } catch { /* ignore */ }
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Permintaan ke server terlalu lama'));
    }, TIMEOUT);

    window[cb] = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Tidak dapat menghubungi server'));
    };

    script.src = `${GAS_URL}?${params.toString()}`;
    document.head.appendChild(script);
  });
}

/**
 * Bungkus hasil server: selalu bentuk { ok, error? }.
 *
 * Aksi baca memakai cache stale-while-revalidate:
 *   - data ada & masih segar  -> langsung dipakai (tanpa jaringan)
 *   - data ada tapi basi        -> langsung dipakai, refresh di belakang
 *   - belum ada data           -> tunggu server
 */
async function safe(action, payload = {}) {
  const isWrite = WRITE_ACTIONS.has(action);
  const key = cacheKey(action, payload);

  if (!isWrite) {
    const forced = isForced();
    let hit = forced ? null : (cache.get(key) || seedFromPersist(action, payload));

    if (hit) {
      const age = Date.now() - hit.fetchedAt;
      const ttl = TTL_BY_ACTION[action] || READ_TTL;

      // Masih segar -> pakai, jangan sentuh jaringan.
      if (age < ttl) return hit.value;

      // Basi -> pakai yang lama SEKARANG, segarkan di belakang layar.
      if (!hit.revalidating) {
        hit.revalidating = true;
        fetchInto(key, action, payload)
          .then(() => { hit.revalidating = false; })
          .catch(() => { hit.revalidating = false; });
      }
      return hit.value;
    }

    // Permintaan identik yang masih berjalan -> tunggu, jangan panggil lagi.
    const pending = inflight.get(key);
    if (pending) {
      try {
        return await pending;
      } catch (err) {
        return { ok: false, error: err.message || 'Gagal menghubungi server', offline: true };
      }
    }
  }

  const request = (async () => {
    try {
      const res = await call(action, payload);
      if (res && typeof res === 'object') return res;
      return { ok: false, error: 'Respons server tidak valid' };
    } catch (err) {
      return { ok: false, error: err.message || 'Gagal menghubungi server', offline: true };
    }
  })();

  if (!isWrite) {
    inflight.set(key, request);
    const value = await request;
    inflight.delete(key);
    return storeResult(action, payload, key, value);
  }

  const value = await request;
  if (value && value.ok !== false) {
    invalidateCache();
    // Backend mungkin baru saja di-deploy ulang -> coba bundle lagi.
    bundleSupported = null;
  }
  return value;
}

/** Ambil & simpan ke cache (dipakai untuk refresh di latar belakang). */
async function fetchInto(key, action, payload) {
  const res = await call(action, payload);
  if (res && typeof res === 'object' && res.ok !== false) {
    storeResult(action, payload, key, res);
  }
  return res;
}

/* ==========================================================================
   Batching: gabung beberapa permintaan jadi satu eksekusi Apps Script
   --------------------------------------------------------------------------
   Apps Script butuh 1-3 detik per eksekusi. Portal membuka beberapa layar
   sekaligus; tanpa batching total waktu menunggu bertambah.
   ========================================================================== */

/** Permintaan yang menungguIntra bundle. */
let bundleTimer = null;
let bundleQueue = [];

/**
 * Kumpulkan beberapa aksi baca menjadi satu permintaan `getPortalBundle`.
 *
 * Cache tetap dihormati: bila data masih segar, requests itu dilayani dari
 * cache tanpa jaringan. Hanya yang benar-benar perlu server yang ikut
 * di-bundle.
 */
function bundleSafe(action, payload) {
  const key = cacheKey(action, payload);
  const forced = isForced();
  let hit = forced ? null : (cache.get(key) || seedFromPersist(action, payload));

  if (hit) {
    const age = Date.now() - hit.fetchedAt;
    const ttl = TTL_BY_ACTION[action] || READ_TTL;
    if (age < ttl) return Promise.resolve(hit.value);

    // Basi: pakai yang lama sekarang, segarkan di belakang layar.
    if (!hit.revalidating) {
      hit.revalidating = true;
      fetchInto(key, action, payload)
        .then(() => { hit.revalidating = false; })
        .catch(() => { hit.revalidating = false; });
    }
    return Promise.resolve(hit.value);
  }

  // Backend belum mendukung bundle -> pakai permintaan biasa.
  if (bundleSupported === false) return safe(action, payload);

  return new Promise((resolve, reject) => {
    bundleQueue.push({ action, payload, key, resolve, reject });

    if (bundleTimer) return;
    // Kumpulkan yang muncul dalam rentang waktu singkat (satu tick).
    bundleTimer = setTimeout(flushBundle, 0);
  });
}

async function flushBundle() {
  bundleTimer = null;
  const batch = bundleQueue;
  bundleQueue = [];
  if (!batch.length) return;

  // Backend hanya punya bundle untuk sebagian aksi; sisanya dikirim biasa.
  const BUNDLED = new Set([
    'getDashboardData', 'getOnlineOrders', 'getSettings',
    'getProducts', 'getCategories', 'getTransactions', 'getQueue', 'getUsers',
    'getPublicCatalogData',
  ]);

  const bundled = batch.filter((r) => BUNDLED.has(r.action));
  const singles = batch.filter((r) => !BUNDLED.has(r.action));

  // Jalankan yang tidak dibundle secara terpisah (tidak menambah latensi).
  for (const req of singles) {
    safe(req.action, req.payload).then(req.resolve, req.reject);
  }
  if (!bundled.length) return;

  const parts = Array.from(new Set(bundled.map((r) => bundlePart(r.action))));
  try {
    const res = await call('getPortalBundle', { parts: parts.join(',') });
    if (!res || res.ok === false) {
      // Backend belum mendukung aksi ini -> tandai & jatuh ke permintaan
      // biasa per aksi. Tetap berfungsi, hanya tidak secepatnya.
      if (res && typeof res.error === 'string' && res.error.includes('tidak dikenal')) {
        bundleSupported = false;
      }
      for (const req of bundled) {
        safe(req.action, req.payload).then(req.resolve, req.reject);
      }
      return;
    }
    bundleSupported = true;

    for (const req of bundled) {
      const value = bundleValue(res, req);
      if (value === undefined) {
        safe(req.action, req.payload).then(req.resolve, req.reject);
        continue;
      }
      storeResult(req.action, req.payload, req.key, value);
      req.resolve(value);
    }
  } catch (err) {
    for (const req of bundled) {
      safe(req.action, req.payload).then(req.resolve, req.reject);
    }
  }
}

/** Peta aksi -> nama bagian di bundle backend. */
function bundlePart(action) {
  switch (action) {
    case 'getDashboardData': return 'dashboard';
    case 'getPublicCatalogData': return 'catalog';
    case 'getOnlineOrders': return 'orders';
    case 'getSettings': return 'settings';
    case 'getProducts': return 'products';
    case 'getCategories': return 'categories';
    case 'getTransactions': return 'transactions';
    case 'getQueue': return 'queue';
    case 'getUsers': return 'users';
    default: return action;
  }
}

/**
 * Ambil bagian bundle yang sesuai untuk sebuah aksi.
 *
 * PENTING: bentuk hasil di mode GAS sama persis dengan mode lokal —
 * array mentah untuk daftar, objek biasa untuk pengaturan. Jangan dibungkus
 * `{ ok, ... }` karena pemanggil (portal.js, settings.js) mengharapkan
 * bentuk datar.
 */
function bundleValue(bundle, req) {
  const part = bundlePart(req.action);
  const value = bundle[part];
  if (value === undefined) return undefined;

  switch (req.action) {
    case 'getDashboardData':
      // Backend memakai getDashboardData(14) — rentang portal memang 14 hari.
      return value;
    case 'getPublicCatalogData':
      return value;          // { store, features, products, categories }
    case 'getOnlineOrders':
      return value;          // array pesanan
    case 'getSettings':
      return value;          // objek pengaturan
    case 'getProducts':
      return value;          // array produk
    case 'getCategories':
      return value;          // array kategori
    case 'getTransactions':
      return value;          // array transaksi
    case 'getQueue':
      return value;          // array antrean
    case 'getUsers':
      return value;          // array pengguna
    default:
      return value;
  }
}

/* ==========================================================================
   Prefetch
   --------------------------------------------------------------------------
   Prefetch seluruh data portal dalam SATU eksekusi Apps Script.
   ========================================================================== */

/**
 * Ambil seluruh data portal sekaligus, lalu simpan ke cache L2.
 *
 * Setiap layar portal membuka permintaan sendiri, dan satu eksekusi Apps
 * Script memakan 2-4 detik. Dengan prefetch, semua data diambil sekali saat
 * aplikasi dibuka (di latar belakang), lalu setiap layar berikutnya dilayani
 * dari cache L2 secara INSTAN — tanpa menunggu server.
 *
 * Aman dipanggil berkali-kali: permintaan identik yang sedang berjalan
 * digabung oleh `safe()`, dan hasilnya hanya ditulis sekali.
 */
let prefetchPromise = null;

/** Aksi yang di-prefetch — cermin dari bagian bundle backend. */
const PREFETCH_ACTIONS = [
  'getSettings', 'getPublicCatalogData', 'getDashboardData',
  'getProducts', 'getCategories', 'getTransactions',
  'getQueue', 'getOnlineOrders', 'getUsers',
];

export function prefetchPortal() {
  if (prefetchPromise) return prefetchPromise;

  // Satu eksekusi Apps Script untuk SEMUA data portal.
  //
  // Backend menyediakan aksi `getPortalBundle` yang menggabungkan pembacaan
  // sheet menjadi satu permintaan. Memakai 9 permintaan terpisah (walau
  // paralel) berarti 9 eksekusi Apps Script — berat, dan sering berbaris
  // di antrean server sehingga justru lebih lambat.
  const parts = [
    'settings', 'catalog', 'dashboard', 'products',
    'categories', 'transactions', 'queue', 'orders', 'users',
  ];

  const action = 'getPortalBundle';
  const payload = { parts: parts.join(',') };
  const key = cacheKey(action, payload);

  // Kalau datanya sudah ada & segar, tidak perlu menyentuh server.
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < (TTL_BY_ACTION[action] || READ_TTL)) {
    return Promise.resolve(hit.value);
  }

  // Data per-aksi dari L2 (kunjungan sebelumnya) sudah cukup untuk
  // mengisi layar. Server baru dihubungi bila ada bagian yang benar-benar
  // perlu disegarkan — revalidasi berjalan di latar belakang, jadi layar
  // TIDAK pernah menunggu.
  const missing = [];
  for (const act of PREFETCH_ACTIONS) {
    const seeded = seedFromPersist(act, {});
    if (!seeded) missing.push(act);
  }
  if (!missing.length) {
    // Semua ada di L2 -> tidak perlu bundle sama sekali.
    prefetchPromise = Promise.resolve(null);
    return prefetchPromise;
  }

  prefetchPromise = call(action, payload)
    .then((res) => {
      prefetchPromise = null;
      if (!res || res.ok === false) return null;

      // Sebarkan tiap bagian ke cache aksi masing-masing, supaya
      // dashboardView / productsView / ordersView dilayani dari cache
      // tanpa request baru.
      const MAP = {
        settings: 'getSettings',
        catalog: 'getPublicCatalogData',
        dashboard: 'getDashboardData',
        products: 'getProducts',
        categories: 'getCategories',
        transactions: 'getTransactions',
        queue: 'getQueue',
        orders: 'getOnlineOrders',
        users: 'getUsers',
      };
      for (const [part, act] of Object.entries(MAP)) {
        const value = res[part];
        if (value === undefined) continue;
        // cacheKey harus memakai payload yang SAMA dengan saat aksi dipanggil.
        // `getPublicCatalogData()` dll. dipanggil tanpa payload -> kunci = nama
        // aksi. Bila kunci tidak sama, cache tidak terbaca dan layar menembak
        // server lagi.
        storeResult(act, {}, cacheKey(act, {}), value);
        // Pastikan juga tersedia di L1 & L2 dengan kunci kanonik.
        const canonicalKey = cacheKey(act, {});
        cache.set(canonicalKey, { value, fetchedAt: Date.now(), revalidating: false });
        persistWrite(act, {}, value);
      }

      cache.set(key, { value: res, fetchedAt: Date.now(), revalidating: false });
      return res;
    })
    .catch(() => {
      prefetchPromise = null;
      return null;
    });

  return prefetchPromise;
}

/* ==========================================================================
   Publik
   ========================================================================== */

export async function getPublicCatalogData() {
  return bundleSafe('getPublicCatalogData');
}

/**
 * Kirim gambar ke backend, disimpan di Google Drive.
 *
 * Backend membalas { ok, fileId, url } atau { ok: false, error }.
 */
export async function uploadImageToDrive(dataUrl, filename = 'gambar') {
  return safe('uploadImageToDrive', { dataUrl, filename });
}

export async function createOnlineOrder(payload) {
  return safe('createOnlineOrder', payload);
}

export async function payOrder(code, method = 'QRIS') {
  return safe('payOrder', { code, method });
}

export async function trackOrder(code) {
  return safe('trackOrder', { code });
}

export async function cancelExpiredOnlineOrders() {
  return safe('cancelExpiredOnlineOrders');
}

/* ==========================================================================
   Portal
   ========================================================================== */

export async function verifyPortalPin(pin) {
  return safe('verifyPortalPin', { pin });
}

export async function login(username, password) {
  return safe('login', { username, password });
}

export async function getDashboardData(days = 14) {
  return bundleSafe('getDashboardData', { days });
}

export async function getReport(days = 14) {
  // Backend membaca payload.range (lihat Code.gs -> getReport(payload.range)).
  return safe('getReport', { range: days });
}

export async function getTransactions() {
  return bundleSafe('getTransactions');
}

export async function getOnlineOrders() {
  return bundleSafe('getOnlineOrders');
}

export async function getQueue() {
  return bundleSafe('getQueue');
}

export async function getProducts() {
  return bundleSafe('getProducts');
}

export async function getCategories() {
  return bundleSafe('getCategories');
}

export async function getUsers() {
  return bundleSafe('getUsers');
}

export async function getSettings() {
  return bundleSafe('getSettings');
}

export async function saveProductRecord(payload) {
  return safe('saveProductRecord', payload);
}

export async function deleteProductRecord(id) {
  return safe('deleteProductRecord', { id });
}

export async function saveCategoryRecord(payload) {
  return safe('saveCategoryRecord', payload);
}

export async function deleteCategoryRecord(id) {
  return safe('deleteCategoryRecord', { id });
}

export async function saveUserRecord(payload) {
  return safe('saveUserRecord', payload);
}

export async function deleteUserRecord(id) {
  return safe('deleteUserRecord', { id });
}

export async function saveSettings(patch) {
  return safe('saveSettings', patch);
}

export async function deleteTransactionRecord(id) {
  return safe('deleteTransactionRecord', { id });
}

export async function assignCourier(code, courier, courierPhone, courierId) {
  return safe('assignCourier', { code, courier, courierPhone, courierId });
}

export async function getCourierOrders(courierId) {
  return safe('getCourierOrders', { courierId });
}

export async function setOrderStatus(code, status, extra = {}) {
  return safe('setOrderStatus', { code, status, ...extra });
}

export async function setQueueEntryStatus(number, status) {
  return safe('setQueueEntryStatus', { number, status });
}

export async function adjustStockRecord(id, delta) {
  return safe('adjustStockRecord', { id, delta });
}

export async function saveTransaction(payload) {
  return safe('saveTransaction', payload);
}

export async function setupDatabase() {
  return safe('setupDatabase');
}

export async function resetDemoData() {
  return safe('resetDemoData');
}

export async function exportDatabase() {
  return safe('exportDatabase');
}

export async function importDatabase(json) {
  return safe('importDatabase', { json });
}

/**
 * Bangun string QRIS dinamis.
 *
 * QRIS dinamis idealnya dibuat server (butuh kredensial merchant), tapi
 * backend ini tidak punya akses ke thereof. String ini stand-in yang
 * konsisten dengan mode lokal: dipakai hanya sebagai isi QR saat toko
 * belum mengunggah foto QRIS statis.
 */
export function buildQrisPayload(code, amount) {
  const amountStr = String(Math.round(Number(amount) || 0));
  return `QRIS|MYKSR|${code}|ID.CO.QRIS.WWW|${amountStr}|MYKASIR AQUATIC|`;
}

/** Refresh paksa — dipakai tombol "Segarkan data". */
export function bustCache() {
  invalidateCache();
  // Selama 5 detik ke depan semua baca langsung ke server (lewati cache).
  // Cukup untuk satu putaran refresh, tidak cukup lama untuk memperlambat
  // navigasi biasa sesudahnya.
  forceNetworkUntil = Date.now() + 5_000;
  try {
    window.dispatchEvent(new CustomEvent('mykasir:cache-bust'));
  } catch { /* ignore */ }
}

/** Uji koneksi ke backend (tanpa cache). */
export async function pingServer() {
  try {
    const res = await call('ping');
    if (res && res.ok) return { ok: true, time: res.time };
    return { ok: false, error: 'Server tidak merespons' };
  } catch (err) {
    return { ok: false, error: err.message || 'Tidak dapat menghubungi server' };
  }
}
