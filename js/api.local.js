/* My Kasir — API lokal (mode demo, localStorage).
 *
 * Dipakai otomatis oleh js/api.js bila GAS_URL belum diisi.
 * Bentuk fungsi & respons identik dengan backend Apps Script.
 *
 * Every function here is shaped like its Google Apps Script counterpart
 * (same name, same argument signature, same return shape), so the PWA can be
 * moved onto Apps Script by replacing the bodies with `return <fn>(...)`
 * calls instead of rewriting the UI.
 *
 *   getPublicCatalogData()      → { store, categories, products }
 *   createOnlineOrder(payload)  → { ok, code, order, error }
 *   verifyPortalPin(pin)        → { ok, role, name }
 *   getDashboardData(range)     → { summary, daily, top, hourly, channels }
 *   cancelExpiredOnlineOrders() → { ok, cancelled }
 *   setupDatabase()             → { ok, sheets }
 */

import * as store from './store.js';
import { orderCode, uid, haversineKm } from './util.js';

const SIM_LATENCY = 120;

/** Simulated round-trip so loading states behave like the real backend. */
function lag(ms = SIM_LATENCY) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ==========================================================================
   Public (no login)
   ========================================================================== */

export async function getPublicCatalogData() {
  await lag(80);
  const s = store.settings();
  const products = store.products({ activeOnly: true }).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    image: p.image,
    unit: p.unit,
    description: p.description,
    negotiable: p.negotiable && s.allowNegotiable,
    trackStock: p.trackStock,
    available: !p.trackStock || p.stock > 0,
    stock: p.trackStock ? p.stock : null,
  }));

  return {
    store: {
      name: s.storeName,
      tagline: s.storeTagline,
      address: s.storeAddress,
      phone: s.storePhone,
      lat: s.storeLat,
      lng: s.storeLng,
      deliveryFee: s.deliveryFee,
      deliveryPerKm: s.deliveryPerKm,
      deliveryRadiusKm: s.deliveryRadiusKm,
      logo: s.storeLogo || '',
      qrisImage: s.qrisImage || '',
    },
    features: {
      onlineOrder: s.featureOnlineOrder,
      delivery: s.featureDelivery,
      dineIn: s.featureDineIn,
      customerName: s.featureCustomerName,
      requireCustomerName: s.requireCustomerName,
      allowNegotiable: s.allowNegotiable,
      allowDiscount: s.allowDiscount,
    },
    categories: store.categories(),
    products,
  };
}

export async function createOnlineOrder(payload) {
  await lag(320);

  const s = store.settings();
  if (!s.featureOnlineOrder) return { ok: false, error: 'Pesanan online sedang dinonaktifkan' };

  const items = (payload.items || []).filter((it) => it.qty > 0);
  if (!items.length) return { ok: false, error: 'Keranjang masih kosong' };

  if (s.featureCustomerName && s.requireCustomerName && !String(payload.customer || '').trim()) {
    return { ok: false, error: `Nama ${s.termCustomer.toLowerCase()} wajib diisi` };
  }

  // validate against live stock
  for (const it of items) {
    const p = store.product(it.id);
    if (!p) return { ok: false, error: `Produk tidak ditemukan: ${it.name}` };
    if (!p.active) return { ok: false, error: `${p.name} sedang tidak tersedia` };
    if (p.trackStock && p.stock < it.qty) {
      return { ok: false, error: `Stok ${p.name} tinggal ${p.stock} ${p.unit}` };
    }
  }

  const subtotal = items.reduce((s2, it) => s2 + it.price * it.qty, 0);
  const discount = Math.max(0, Math.min(subtotal, Number(payload.discount) || 0));
  const fulfilment = payload.fulfilment === 'delivery' && s.featureDelivery ? 'delivery' : 'pickup';

  // Lokasi tujuan pelanggan (dipilih di peta saat checkout).
  const destLat = payload.lat === '' || payload.lat === undefined || payload.lat === null ? null : Number(payload.lat);
  const destLng = payload.lng === '' || payload.lng === undefined || payload.lng === null ? null : Number(payload.lng);
  let distanceKm = 0;

  if (fulfilment === 'delivery') {
    const radius = Number(s.deliveryRadiusKm) || 0;
    if (destLat !== null && destLng !== null && !isNaN(destLat) && !isNaN(destLng)) {
      distanceKm = haversineKm(Number(s.storeLat), Number(s.storeLng), destLat, destLng);
    }
    if (radius > 0) {
      if (!distanceKm) return { ok: false, error: 'Titik lokasi pengiriman belum dipilih pada peta' };
      if (distanceKm > radius) {
        return { ok: false, error: `Jarak tujuan ${distanceKm.toFixed(1)} km melebihi radius layanan ${radius} km` };
      }
    }
  }

  let deliveryFee = 0;
  if (fulfilment === 'delivery') {
    const perKm = Number(s.deliveryPerKm) || 0;
    deliveryFee = perKm > 0 && distanceKm > 0
      ? Math.ceil(perKm * distanceKm)
      : Number(s.deliveryFee) || 0;
  }
  const total = subtotal - discount + deliveryFee;

  const code = orderCode();
  const now = new Date();
  const order = {
    code,
    ts: now.toISOString(),
    status: 'pending',
    payment: payload.payment === 'Cash' ? 'Cash' : 'QRIS',
    paymentStatus: payload.payment === 'Cash' ? 'unpaid' : 'unpaid',
    items: items.map((it) => ({
      id: it.id,
      name: it.name,
      price: it.price,
      qty: it.qty,
      unit: it.unit,
      image: it.image,
      category: it.category,
      total: it.price * it.qty,
    })),
    subtotal,
    discount,
    deliveryFee,
    total,
    customer: String(payload.customer || '').trim(),
    phone: String(payload.phone || '').trim(),
    channel: 'online',
    fulfilment,
    address: fulfilment === 'delivery' ? String(payload.address || '').trim() : '',
    note: String(payload.note || '').trim(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    paidAt: null,
    qrisPayload: buildQrisPayload(code, total),
    lat: fulfilment === 'delivery' ? destLat : null,
    lng: fulfilment === 'delivery' ? destLng : null,
    courier: '',
    courierPhone: '',
  };

  store.saveOrder(order);

  // stock is deducted when the order is created — matching the PRD flow
  for (const it of items) {
    const p = store.product(it.id);
    if (p?.trackStock) store.adjustStock(it.id, -it.qty);
  }

  if (fulfilment === 'pickup') {
    store.pushQueue({ code, label: 'Ambil di tempat' });
  }

  return { ok: true, code, order };
}

/** Stand-in for a real dynamic-QRIS string. */
export function buildQrisPayload(code, amount) {
  const amountStr = String(Math.round(amount));
  return `QRIS|MYKSR|${code}|ID.CO.QRIS.WWW|${amountStr}|MYKASIR AQUATIC|`;
}

/** Pay an order: simulate the QRIS callback, then write the transaction. */
export async function payOrder(code, method = 'QRIS') {
  await lag(600);
  const order = store.findOrder(code);
  if (!order) return { ok: false, error: 'Pesanan tidak ditemukan' };
  if (order.status === 'cancelled') return { ok: false, error: 'Pesanan sudah kedaluwarsa' };
  if (order.status === 'paid') return { ok: true, order, alreadyPaid: true };

  const updated = store.updateOrderStatus(code, 'paid');
  updated.paymentStatus = 'paid';
  updated.payment = method;
  updated.paidAt = new Date().toISOString();
  store.saveOrder(updated);

  // stock was already deducted when the order was created — do not deduct twice
  store.addTransaction({
    ts: updated.paidAt,
    code: updated.code,
    items: updated.items,
    subtotal: updated.subtotal,
    discount: updated.discount,
    deliveryFee: updated.deliveryFee,
    total: updated.total,
    payment: method,
    cashier: 'Online',
    channel: 'online',
    customer: updated.customer,
    fulfilment: updated.fulfilment,
    status: 'paid',
  });

  return { ok: true, order: updated };
}

export async function trackOrder(code) {
  await lag(140);
  const order = store.findOrder(code);
  if (!order) return { ok: false, error: 'Kode pesanan tidak ditemukan' };
  return { ok: true, order };
}

export async function cancelExpiredOnlineOrders() {
  const cancelled = store.cancelExpiredOrders();
  return { ok: true, cancelled };
}

/* ==========================================================================
   Portal auth
   ========================================================================== */

export async function verifyPortalPin(pin) {
  await lag(180);
  const s = store.settings();
  const clean = String(pin || '').trim();
  if (!clean) return { ok: false, error: 'Masukkan PIN' };
  if (clean.length !== 6) return { ok: false, error: 'PIN harus 6 digit' };

  let stored = String(s.portalPin || '');
  if (!stored) stored = '258000';
  else if (stored.length !== 6) stored = (stored + '0000').slice(0, 6); // PIN lama 4 digit

  if (clean !== stored) return { ok: false, error: 'PIN salah' };
  return { ok: true, role: 'owner', name: 'Owner' };
}

export async function login(username, password) {
  await lag(260);
  const name = String(username || '').trim();
  const u = store.users().find(
    (x) => x.username.toLowerCase() === name.toLowerCase()
  );
  if (!u || !u.active) return { ok: false, error: 'Pengguna tidak ditemukan atau nonaktif' };
  if (u.password !== String(password)) return { ok: false, error: 'Kata sandi salah' };
  return { ok: true, user: { id: u.id, name: u.name, username: u.username, role: u.role } };
}

/* ==========================================================================
   Dashboard & reports
   ========================================================================== */

export async function getDashboardData(days = 14) {
  await lag(90);
  const summary = store.summaryToday();
  const daily = store.reportDaily(days);
  const top = store.reportTopProducts(5, days);
  const hourly = store.reportHourly();
  const channels = store.reportChannels(days);
  return { summary, daily, top, hourly, channels };
}

export async function getReport(range = 14) {
  await lag(120);
  return {
    daily: store.reportDaily(range),
    top: store.reportTopProducts(10, range),
    hourly: store.reportHourly(),
    channels: store.reportChannels(range),
    summary: store.summaryToday(),
  };
}

export async function getTransactions() {
  await lag(80);
  return store.transactions();
}

export async function getOnlineOrders() {
  await lag(80);
  return store.orders();
}

export async function getQueue() {
  await lag(60);
  return store.queue();
}

export async function getProducts() {
  await lag(60);
  return store.products();
}

export async function getCategories() {
  await lag(60);
  return store.categories();
}

export async function getUsers() {
  await lag(60);
  return store.users();
}

export async function getSettings() {
  await lag(60);
  return store.settings();
}

/* ==========================================================================
   Mutations
   ========================================================================== */

export async function saveProductRecord(p) {
  await lag(120);
  store.saveProduct(p);
  return { ok: true };
}

export async function deleteProductRecord(id) {
  await lag(100);
  store.deleteProduct(id);
  return { ok: true };
}

export async function saveCategoryRecord(c) {
  await lag(100);
  store.saveCategory(c);
  return { ok: true };
}

export async function deleteCategoryRecord(id) {
  await lag(100);
  const res = store.deleteCategory(id);
  if (!res.ok) throw new Error(res.reason);
  return { ok: true };
}

export async function saveUserRecord(u) {
  await lag(100);
  store.saveUser(u);
  return { ok: true };
}

export async function deleteUserRecord(id) {
  await lag(100);
  store.deleteUser(id);
  return { ok: true };
}

export async function saveSettings(patch) {
  await lag(100);
  store.setSettings(patch);
  return { ok: true };
}

export async function deleteTransactionRecord(id) {
  await lag(100);
  store.deleteTransaction(id);
  return { ok: true };
}

export async function setOrderStatus(code, status, extra = {}) {
  await lag(120);
  const o = store.updateOrderStatus(code, status, extra);
  return { ok: !!o, order: o };
}

export async function setQueueEntryStatus(number, status) {
  await lag(90);
  const q = store.setQueueStatus(number, status);
  return { ok: !!q, entry: q };
}

export async function adjustStockRecord(id, delta) {
  await lag(90);
  const stock = store.adjustStock(id, delta);
  return { ok: stock !== null, stock };
}

/** Mirrors the PRD's setupDatabase() — creates/normalises every sheet. */
export async function setupDatabase() {
  await lag(400);
  const sheets = [
    { name: 'Settings', headers: ['key', 'value'], rows: Object.entries(store.settings()).length },
    { name: 'Categories', headers: ['id', 'name', 'icon', 'color'], rows: store.categories().length },
    {
      name: 'Products',
      headers: ['id', 'name', 'category', 'price', 'cost', 'stock', 'unit', 'image', 'active', 'trackStock', 'description'],
      rows: store.products().length,
    },
    { name: 'Users', headers: ['id', 'username', 'password', 'name', 'role', 'active'], rows: store.users().length },
    {
      name: 'Transactions',
      headers: ['id', 'ts', 'code', 'items', 'subtotal', 'discount', 'deliveryFee', 'total', 'payment', 'cashier', 'channel', 'customer', 'table', 'status'],
      rows: store.transactions().length,
    },
    {
      name: 'OnlineOrders',
      headers: ['code', 'ts', 'status', 'payment', 'items', 'customer', 'fulfilment', 'address', 'total', 'expiresAt', 'paidAt'],
      rows: store.orders().length,
    },
    { name: 'Queue', headers: ['number', 'ts', 'status', 'code', 'label'], rows: store.queue().length },
  ];
  return { ok: true, sheets, at: new Date().toISOString() };
}

export async function resetDemoData() {
  await lag(300);
  store.resetDatabase();
  return { ok: true };
}

/**
 * Transaksi POS luring (mode lokal).
 *
 * Mode lokal sudah menangani pencatatan di cart.checkoutOffline(), tapi fungsi
 * ini tetap disediakan agar bentuk API kedua mode benar-benar sama.
 */
export async function saveTransaction(payload) {
  await lag(120);
  const items = (payload.items || []).filter((it) => it.qty > 0);
  if (!items.length) return { ok: false, error: 'Keranjang masih kosong' };

  const tx = store.addTransaction({ ...payload, items });
  return { ok: true, transaction: tx };
}

/** Snapshot seluruh database (dipakai untuk cadangan/restore). */
export async function exportDatabase() {
  return store.exportDatabase();
}

/** Pulihkan database dari snapshot JSON. */
export async function importDatabase(json) {
  store.importDatabase(json);
  return { ok: true };
}

export { uid };
