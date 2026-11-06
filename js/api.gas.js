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

const READ_TTL = 15_000;   // dianggap basi setelah 15 detik
const LONG_TTL = 60_000;   // data yang jarang berubah (produk, kategori, settings)

const TTL_BY_ACTION = {
  getSettings: LONG_TTL,
  getCategories: LONG_TTL,
  getProducts: LONG_TTL,
  getUsers: LONG_TTL,
};

const cache = new Map();     // key -> { value, fetchedAt, revalidating }
const inflight = new Map();   // key -> Promise

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
  'setOrderStatus', 'setQueueEntryStatus', 'adjustStockRecord',
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

/** Buang semua cache (dipakai setelah mutasi). */
function invalidateCache() {
  cache.clear();
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
    const hit = cache.get(key);
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
    cache.set(key, { value, fetchedAt: Date.now(), revalidating: false });
    return value;
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
    cache.set(key, { value: res, fetchedAt: Date.now(), revalidating: false });
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
  const hit = cache.get(key);

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
      cache.set(req.key, { value, fetchedAt: Date.now(), revalidating: false });
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
   Publik
   ========================================================================== */

export async function getPublicCatalogData() {
  return bundleSafe('getPublicCatalogData');
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

/** Refresh paksa — dipakai tombol "Muat ulang". */
export function bustCache() {
  invalidateCache();
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
