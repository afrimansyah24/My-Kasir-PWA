/**
 * My Kasir — API dispatcher.
 *
 * Dua implementasi dengan bentuk fungsi & respons yang sama persis:
 *
 *   js/api.local.js — mode demo, data di localStorage (default)
 *   js/api.gas.js   — mode produksi, backend Google Apps Script + Spreadsheet
 *
 * Mode dipilih otomatis oleh GAS_URL di js/config.js:
 *   GAS_URL kosong  -> lokal
 *   GAS_URL terisi  -> Google Apps Script
 *
 * Semua pemanggil (views, cart) tidak perlu tahu mode mana yang aktif.
 */

import { isGasConfigured } from './config.js';
import * as local from './api.local.js';
import * as gas from './api.gas.js';

const impl = isGasConfigured() ? gas : local;

/** Mode aktif saat ini — dipakai Portal > Pengaturan > Data. */
export const mode = isGasConfigured() ? 'gas' : 'local';

export const getPublicCatalogData = impl.getPublicCatalogData;
export const createOnlineOrder = impl.createOnlineOrder;
export const payOrder = impl.payOrder;
export const trackOrder = impl.trackOrder;
export const cancelExpiredOnlineOrders = impl.cancelExpiredOnlineOrders;

export const verifyPortalPin = impl.verifyPortalPin;
export const login = impl.login;
export const getDashboardData = impl.getDashboardData;
export const getReport = impl.getReport;
export const getTransactions = impl.getTransactions;
export const getOnlineOrders = impl.getOnlineOrders;
export const getQueue = impl.getQueue;
export const getProducts = impl.getProducts;
export const getCategories = impl.getCategories;
export const getUsers = impl.getUsers;
export const getSettings = impl.getSettings;

export const saveProductRecord = impl.saveProductRecord;
export const deleteProductRecord = impl.deleteProductRecord;
export const saveCategoryRecord = impl.saveCategoryRecord;
export const deleteCategoryRecord = impl.deleteCategoryRecord;
export const saveUserRecord = impl.saveUserRecord;
export const deleteUserRecord = impl.deleteUserRecord;
export const saveSettings = impl.saveSettings;
export const deleteTransactionRecord = impl.deleteTransactionRecord;
export const setOrderStatus = impl.setOrderStatus;
export const setQueueEntryStatus = impl.setQueueEntryStatus;
export const adjustStockRecord = impl.adjustStockRecord;
export const saveTransaction = impl.saveTransaction;
export const setupDatabase = impl.setupDatabase;
export const resetDemoData = impl.resetDemoData;

export const buildQrisPayload = impl.buildQrisPayload;
export const exportDatabase = impl.exportDatabase;
export const importDatabase = impl.importDatabase;

export { uid } from './util.js';
