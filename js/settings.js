/**
 * My Kasir — cache pengaturan.
 *
 * Beberapa bagian UI (keranjang, struk, peta, layar antrean) membutuhkan
 * pengaturan secara sinkron, sementara sumber data async dari server GAS. Modul ini menyimpan salinan terakhir dan memperbarui
 * dirinya saat boot maupun setelah pengaturan diubah.
 */

import * as api from './api.js';
import { normalizeCoordinate } from './util.js';

/**
 * Nilai cadangan saat server belum menjawab.
 *
 * Sengaja KOSONG untuk detail toko: aplikasi ini dipakai toko apa pun, bukan
 * hanya satu toko. Tidak ada nama/alamat/koordinat contoh yang bisa
 * tertinggal di layar bila owner belum mengatur apa pun.
 */
const FALLBACK = {
  storeName: '',
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
  // QRIS untuk pickup & delivery di toko online (owner bisa mematikan).
  qrisPickupEnabled: true,
  qrisDeliveryEnabled: true,
  allowNegotiable: true,
  allowDiscount: true,
  requireCustomerName: false,
  maxDiscountPercent: 30,
  deliveryFee: 0,
  deliveryPerKm: 0,
  deliveryRadiusKm: 0,
  // Kosong = belum diatur (bukan titik kota tertentu).
  storeLat: '',
  storeLng: '',
  storeAddressShort: '',
  storeLogo: '',
  qrisImage: '',
  heroTitle: '',
  heroTitleHighlight: '',
  heroSubtitle: '',
  heroBadgeText: '',
  heroButtonText: '',
  heroTrackButtonText: '',
  heroImage: '',
  heroShowBadge: 'true',
  heroShowStats: 'true',
  heroBadgeIcon: '',
  heroTile1Icon: '',
  heroTile1Image: '',
  heroTile1Label: '',
  heroTile2Icon: '',
  heroTile2Image: '',
  heroTile2Label: '',
  heroTile3Icon: '',
  heroTile3Image: '',
  heroTile3Label: '',
  heroTile4Icon: '',
  heroTile4Image: '',
  heroTile4Label: '',
  footerNote: '',
  portalPin: '',
  qrisMerchant: '',
  qrisNmid: '',
  receiptHeader: '',
  receiptFooter: '',
};

let cache = { ...FALLBACK };
const listeners = new Set();

/** snapshot L2 (`mykasir.cache.v2`) — sama seperti js/api.gas.js */
const PERSIST_KEY = 'mykasir.cache.v2';
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
    cache.storeLat = normalizeCoordinate(hit.value.storeLat, 'lat');
    cache.storeLng = normalizeCoordinate(hit.value.storeLng, 'lng');
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
    cache.storeLat = normalizeCoordinate(value.storeLat, 'lat');
    cache.storeLng = normalizeCoordinate(value.storeLng, 'lng');
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
      // Pulihkan koordinat legacy yang tersimpan tanpa titik desimal.
      cache.storeLat = normalizeCoordinate(s.storeLat, 'lat');
      cache.storeLng = normalizeCoordinate(s.storeLng, 'lng');
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
