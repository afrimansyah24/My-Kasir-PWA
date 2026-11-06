/**
 * My Kasir — cache pengaturan.
 *
 * Beberapa bagian UI (keranjang, struk, peta, layar antrean) membutuhkan
 * pengaturan secara sinkron, sementara sumber data bisa async (server GAS
 * atau localStorage). Modul ini menyimpan salinan terakhir dan memperbarui
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
