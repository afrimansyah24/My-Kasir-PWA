/**
 * My Kasir — konektor Google Apps Script.
 *
 * Apps Script ContentService tidak mengirim header CORS, jadi fetch() lintas
 * origin akan ditolak browser. Yang andal tanpa hosting lain adalah JSONP:
 * sisipkan <script src="...exec?action=...&cb=callback"> lalu ambil hasilnya
 * dari fungsi callback global.
 *
 * Semua parameter dikirim lewat query string (payload sudah JSON-safe).
 * Operasi tulis memakai aksi yang sama seperti mode lokal, jadi bentuk
 * respons di js/api.js tidak berubah sama sekali.
 */

import { GAS_URL, GAS_TOKEN, isGasConfigured } from './config.js';

const TIMEOUT = 25000;

let counter = 0;

/** Nama callback unik per permintaan. */
function callbackName() {
  counter += 1;
  return `__mykasir_cb_${Date.now().toString(36)}_${counter}`;
}

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

/** Bungkus hasil server: selalu bentuk { ok, error? }. */
async function safe(action, payload = {}) {
  try {
    const res = await call(action, payload);
    if (res && typeof res === 'object') return res;
    return { ok: false, error: 'Respons server tidak valid' };
  } catch (err) {
    return { ok: false, error: err.message || 'Gagal menghubungi server', offline: true };
  }
}

/* ==========================================================================
   Publik
   ========================================================================== */

export async function getPublicCatalogData() {
  return safe('getPublicCatalogData');
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
  return safe('getDashboardData', { days });
}

export async function getReport(range = 14) {
  return safe('getReport', { range });
}

export async function getTransactions() {
  return safe('getTransactions');
}

export async function getOnlineOrders() {
  return safe('getOnlineOrders');
}

export async function getQueue() {
  return safe('getQueue');
}

export async function getProducts() {
  return safe('getProducts');
}

export async function getCategories() {
  return safe('getCategories');
}

export async function getUsers() {
  return safe('getUsers');
}

export async function getSettings() {
  return safe('getSettings');
}

/* ==========================================================================
   Mutasi
   ========================================================================== */

export async function saveProductRecord(p) {
  return safe('saveProductRecord', { product: p });
}

export async function deleteProductRecord(id) {
  return safe('deleteProductRecord', { id });
}

export async function saveCategoryRecord(c) {
  return safe('saveCategoryRecord', { category: c });
}

export async function deleteCategoryRecord(id) {
  return safe('deleteCategoryRecord', { id });
}

export async function saveUserRecord(u) {
  return safe('saveUserRecord', { user: u });
}

export async function deleteUserRecord(id) {
  return safe('deleteUserRecord', { id });
}

export async function saveSettings(patch) {
  return safe('saveSettings', { settings: patch });
}

export async function deleteTransactionRecord(id) {
  return safe('deleteTransactionRecord', { id });
}

export async function setOrderStatus(code, status) {
  return safe('setOrderStatus', { code, status });
}

export async function setQueueEntryStatus(number, status) {
  return safe('setQueueEntryStatus', { number, status });
}

export async function adjustStockRecord(id, delta) {
  return safe('adjustStockRecord', { id, delta });
}

/** Transaksi POS luring — dicatat di server (mode GAS). */
export async function saveTransaction(payload) {
  return safe('saveTransaction', payload);
}

export async function setupDatabase() {
  return safe('setupDatabase');
}

export async function resetDemoData() {
  return safe('resetDemoData');
}

/** Snapshot seluruh database dari server (dipakai untuk cadangan). */
export async function exportDatabase() {
  const [settings, categories, products, users, transactions, orders, queue] = await Promise.all([
    safe('getSettings'),
    safe('getCategories'),
    safe('getProducts'),
    safe('getUsers'),
    safe('getTransactions'),
    safe('getOnlineOrders'),
    safe('getQueue'),
  ]);
  return JSON.stringify(
    {
      version: 1,
      settings,
      categories,
      products,
      users,
      transactions,
      orders,
      queue,
    },
    null,
    2
  );
}

/** Pulihkan database dari snapshot JSON di server. */
export async function importDatabase(json) {
  let parsed;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return { ok: false, error: 'Format berkas tidak dikenali' };
  }
  if (!parsed || parsed.version !== 1) {
    return { ok: false, error: 'Format berkas tidak dikenali' };
  }
  return safe('importDatabase', { database: parsed });
}

/** QRIS statis; versi produksi dibuat di server (payload EMV + CRC). */
export function buildQrisPayload(code, amount) {
  const amountStr = String(Math.round(Number(amount) || 0));
  return `QRIS|MYKSR|${code}|ID.CO.QRIS.WWW|${amountStr}|MYKASIR AQUATIC|`;
}
