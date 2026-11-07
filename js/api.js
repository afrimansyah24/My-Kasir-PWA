/**
 * My Kasir — API dispatcher.
 *
 * Seluruh data aplikasi (produk, kategori, transaksi, pesanan online, antrean,
 * pengguna, pengaturan) berada di **Google Spreadsheet** dan diakses lewat
 * **Google Apps Script Web App** (`/exec`).
 *
 * Tidak ada lagi mode demo / basis data lokal: perangkat hanya menyimpan
 *   - cache baca sementara (`mykasir.cache.v1`) supaya halaman tampil instan,
 *   - preferensi perangkat (tema, sesi login, keranjang berjalan).
 *
 * Semua pemanggil (views, cart) tidak perlu tahu detail transportasi —
 * bentuk fungsi & respons tetap sama seperti sebelumnya.
 */

import * as gas from './api.gas.js';

/** Mode aplikasi. Selalu server — tidak ada basis data lokal. */
export const mode = 'gas';

export const getPublicCatalogData = gas.getPublicCatalogData;
export const createOnlineOrder = gas.createOnlineOrder;
export const payOrder = gas.payOrder;
export const trackOrder = gas.trackOrder;
export const cancelExpiredOnlineOrders = gas.cancelExpiredOnlineOrders;

export const verifyPortalPin = gas.verifyPortalPin;
export const login = gas.login;
export const getDashboardData = gas.getDashboardData;
export const getReport = gas.getReport;
export const getTransactions = gas.getTransactions;
export const getOnlineOrders = gas.getOnlineOrders;
export const getCourierOrders = gas.getCourierOrders;
export const savePaymentProof = gas.savePaymentProof;
export const confirmPayment = gas.confirmPayment;
export const rejectPaymentProof = gas.rejectPaymentProof;
export const assignCourier = gas.assignCourier;
export const getQueue = gas.getQueue;
export const getProducts = gas.getProducts;
export const getCategories = gas.getCategories;
export const getUsers = gas.getUsers;
export const getSettings = gas.getSettings;

export const saveProductRecord = gas.saveProductRecord;
export const deleteProductRecord = gas.deleteProductRecord;
export const saveCategoryRecord = gas.saveCategoryRecord;
export const deleteCategoryRecord = gas.deleteCategoryRecord;
export const saveUserRecord = gas.saveUserRecord;
export const deleteUserRecord = gas.deleteUserRecord;
export const saveSettings = gas.saveSettings;
export const deleteTransactionRecord = gas.deleteTransactionRecord;
export const setOrderStatus = gas.setOrderStatus;
export const setQueueEntryStatus = gas.setQueueEntryStatus;
export const adjustStockRecord = gas.adjustStockRecord;
export const saveTransaction = gas.saveTransaction;
export const setupDatabase = gas.setupDatabase;
export const resetDemoData = gas.resetDemoData;

export const buildQrisPayload = gas.buildQrisPayload;
export const exportDatabase = gas.exportDatabase;
export const importDatabase = gas.importDatabase;
export const pingServer = gas.pingServer;

/** Buang cache baca (paksa data segar dari server). */
export const bustCache = gas.bustCache;

/**
 * Ambil seluruh data portal sekaligus (satu eksekusi Apps Script) lalu
 * simpan ke cache — layar berikutnya tampil tanpa menunggu server.
 */
export const prefetchPortal = gas.prefetchPortal;

/**
 * Simpan gambar ke Google Drive, kembalikan kode file-nya.
 *
 * Dipakai saat gambar terlalu besar untuk disimpan langsung di sel
 * Spreadsheet (atau ketika unggahan biasa gagal).
 */
export const uploadImageToDrive = gas.uploadImageToDrive;

export { uid } from './util.js';
