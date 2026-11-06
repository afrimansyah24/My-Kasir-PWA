/**
 * My Kasir — cache pengaturan.
 *
 * Beberapa bagian UI (keranjang, struk, peta, layar antrean) membutuhkan
 * pengaturan secara sinkron, sementara sumber data bisa async (server GAS
 * atau cache lokal). Modul ini menyimpan salinan terakhir dan memperbarui
 * dirinya saat boot maupun setelah pengaturan diubah.
 */

import * as api from './api.js';

const FALLBACK = {
  storeName: 'Toko Saya',
  storeTagline: '',
  storeAddress: '',
  storePhone: '',
  currency: 'Rp',
  featureCustomerName: true,
  featureDelivery: true,
  featureDineIn: true,
  featureQueue: true,
  featureOnlineOrder: true,
  featureTableNumber: false,
  allowNegotiable: true,
  allowDiscount: true,
  requireCustomerName: false,
  maxDiscountPercent: 30,
  deliveryFee: 0,
  deliveryPerKm: 0,
  deliveryRadiusKm: 0,
  storeLat: -6.9147,
  storeLng: 107.6098,
  storeAddressShort: '',
  storeLogo: '',
  qrisImage: '',
  couriers: '[]',
  portalPin: '',
  qrisMerchant: '',
  qrisNmid: '',
  receiptHeader: '',
  receiptFooter: '',
};

let cache = { ...FALLBACK };
const listeners = new Set();

/** snapshot L2 (`mykasir.cache.v1`) — sama seperti js/api.gas.js */
const PERSIST_KEY = 'mykasir.cache.v1';
const SETTINGS_MAX_AGE = 10 * 60_000;

function seedFromPersist() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const store = JSON.parse(raw);
    const hit = store.getSettings;
    if (!hit?.value || typeof hit.value !== 'object' || hit.value.ok === false) return;
    if (Date.now() - (hit.fetchedAt || 0) > SETTINGS_MAX_AGE) return;
    cache = { ...FALLBACK, ...hit.value };
  } catch {
    /* ignore */
  }
}

seedFromPersist();

/**
 * Sinkronkan cache pengaturan saat server mengirim versi baru.
 *
 * Menyimpan "Simpan" di portal memicu revalidasi di latar belakang; event
 * ini memastikan nilai yang dipakai struk/POS/etalase ikut ter-update tanpa
 * perlu memuat ulang halaman.
 */
try {
  window.addEventListener('mykasir:fresh', (e) => {
    const { action, value } = e?.detail || {};
    if (action !== 'getSettings') return;
    if (!value || typeof value !== 'object' || value.ok === false || !('storeName' in value)) return;
    cache = { ...FALLBACK, ...value };
    listeners.forEach((fn) => {
      try { fn(cache); } catch { /* ignore */ }
    });
  });
} catch { /* di luar peramban */ }

/** Pengaturan saat ini (sinkron). */
export function settings() {
  return cache;
}

/** Ambil ulang dari sumber data (lokal atau GAS). */
export async function refreshSettings() {
  try {
    const s = await api.getSettings();
    if (s && typeof s === 'object' && s.ok !== false && 'storeName' in s) {
      cache = { ...FALLBACK, ...s };
      listeners.forEach((fn) => {
        try { fn(cache); } catch { /* ignore */ }
      });
    }
  } catch {
    /* pertahankan cache terakhir */
  }
  return cache;
}

/** Daftarkan callback saat pengaturan berubah. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
