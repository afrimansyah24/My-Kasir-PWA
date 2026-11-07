/* My Kasir — cart state, QRIS rendering and receipt data.
 *
 * The cart lives in memory (and is mirrored to localStorage so a refresh does
 * not lose an in-progress basket). It is a per-device preference, NOT a
 * business record: the actual sale is always written to the Spreadsheet via
 * api.saveTransaction().
 */

import * as api from './api.js';
import { settings } from './settings.js';
import { orderCode, haversineKm, loadImage, normalizeCoordinate } from './util.js';

const CART_KEY = 'mykasir.cart.v1';

const state = {
  items: [], // { id, name, price, qty, unit, image, category }
  note: '',
  fulfilment: 'pickup',
  discount: 0,
  customer: '',
  phone: '',
  address: '',
  destLat: null,   // titik tujuan delivery (dipilih pelanggan di peta)
  destLng: null,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — cart stays in memory only */
  }
  listeners.forEach((fn) => fn(cart()));
}

export function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch {
    /* ignore corrupt cart */
  }
  return state;
}

export function cart() {
  return {
    ...state,
    items: state.items.map((i) => ({ ...i })),
    subtotal: subtotal(),
    discount: discountAmount(),
    deliveryFee: deliveryFee(),
    total: total(),
    count: state.items.reduce((s, i) => s + i.qty, 0),
  };
}

export function addItem(product, qty = 1) {
  const found = state.items.find((i) => i.id === product.id);
  if (found) {
    found.qty += qty;
  } else {
    state.items.push({
      id: product.id,
      name: product.name,
      price: Number(product.price) || 0,
      qty,
      unit: product.unit || 'pcs',
      image: product.image || '',
      category: product.category || '',
    });
  }
  emit();
  return state.items.find((i) => i.id === product.id);
}

export function setQty(id, qty) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.qty = Math.max(0, Math.floor(qty));
  if (item.qty === 0) state.items = state.items.filter((i) => i.id !== id);
  emit();
}

export function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  emit();
}

export function clearCart() {
  state.items = [];
  state.note = '';
  state.discount = 0;
  state.customer = '';
  state.phone = '';
  state.address = '';
  state.destLat = null;
  state.destLng = null;
  emit();
}

export function setFulfilment(mode) {
  state.fulfilment = mode === 'delivery' ? 'delivery' : 'pickup';
  emit();
}

/** Simpan titik tujuan pengiriman (hasil pilih di peta). */
export function setDestination(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  state.destLat = Number.isFinite(la) ? la : null;
  state.destLng = Number.isFinite(ln) ? ln : null;
  emit();
}

/** Jarak (km) dari toko ke titik tujuan — null bila belum dipilih. */
export function destinationKm() {
  if (state.destLat === null || state.destLng === null) return null;
  const s = settings();
  const lat = normalizeCoordinate(s.storeLat, 'lat');
  const lng = normalizeCoordinate(s.storeLng, 'lng');
  // Tanpa lokasi toko ongkir/jarak tidak dapat dihitung; jangan diam-diam
  // menghitung dari Bandung atau titik default lain.
  if (lat === null || lng === null) return null;
  const km = haversineKm(lat, lng, state.destLat, state.destLng);
  return Number.isFinite(km) ? km : null;
}
export function setDiscount(value) {
  state.discount = Math.max(0, Number(value) || 0);
  emit();
}

export function setField(key, value) {
  if (key in state) {
    state[key] = value;
    emit();
  }
}

export function subtotal() {
  return state.items.reduce((s, i) => s + i.price * i.qty, 0);
}

export function discountAmount() {
  const max = settings().maxDiscountPercent || 0;
  const cap = (subtotal() * max) / 100;
  return Math.min(state.discount || 0, cap);
}

export function deliveryFee() {
  const s = settings();
  if (state.fulfilment !== 'delivery' || !s.featureDelivery) return 0;

  // Tarif per km (bila diatur owner) + lokasi sudah dipilih → hitung otomatis.
  const perKm = Number(s.deliveryPerKm) || 0;
  if (perKm > 0) {
    const km = destinationKm();
    if (km !== null && km > 0) return Math.ceil(perKm * km);
    return 0; // lokasi belum dipilih — ongkir tampil setelah titik dipilih
  }
  return Number(s.deliveryFee) || 0;
}

export function total() {
  return Math.max(0, subtotal() - discountAmount() + deliveryFee());
}

/* -------------------------------------------------------------------------
   Offline POS checkout
   ---------------------------------------------------------------------- */

/**
 * Complete a POS sale. Deducts stock, records the transaction and returns a
 * receipt-shaped object the caller can print.
 */
export async function checkoutOffline({ payment, cashier, customer, table, fulfilment, discount = 0 }) {
  const s = settings();
  const items = state.items.map((i) => ({ ...i, total: i.price * i.qty }));

  const sub = items.reduce((acc, i) => acc + i.total, 0);
  const disc = Math.min(Number(discount) || 0, sub);
  const fee = fulfilment === 'delivery' ? Number(s.deliveryFee) || 0 : 0;
  const grand = Math.max(0, sub - disc + fee);

  const code = orderCode();
  const payload = {
    code,
    items,
    subtotal: sub,
    discount: disc,
    deliveryFee: fee,
    total: grand,
    payment,
    cashier,
    channel: 'offline',
    customer: customer || '',
    table: table || '',
    fulfilment: fulfilment || 'pickup',
    status: 'paid',
  };

  // Pencatatan & validasi stok terjadi di server (Google Spreadsheet).
  // Tidak ada lagi pencatatan lokal.
  const res = await api.saveTransaction(payload);
  if (!res.ok) throw new Error(res.error || 'Gagal menyimpan transaksi');
  const tx = res.transaction;
  return { tx, receipt: buildReceipt(tx) };
}

/* -------------------------------------------------------------------------
   Receipt
   ---------------------------------------------------------------------- */

export function buildReceipt(tx) {
  const s = settings();
  return {
    header: s.receiptHeader || s.storeName,
    storeName: s.storeName,
    logo: s.storeLogo || '',
    footer: s.receiptFooter,
    address: s.storeAddress,
    phone: s.storePhone,
    code: tx.code,
    ts: tx.ts,
    items: tx.items,
    subtotal: tx.subtotal,
    discount: tx.discount,
    deliveryFee: tx.deliveryFee,
    total: tx.total,
    payment: tx.payment,
    cashier: tx.cashier,
    customer: tx.customer,
    fulfilment: tx.fulfilment,
    channel: tx.channel,
  };
}

/**
 * Struk profesional (asli 58mm): logo toko → kop toko → info kasir/waktu →
 * tabel item → rincian biaya → TOTAL → metode bayar → footer.
 *
 * Gambar logo dimuat lebih dulu supaya bisa digambar; bila logo tidak ada
 * atau gagal dimuat, kop tetap rapi tanpa logo.
 */
export async function receiptCanvas(receipt, opts = {}) {
  const { width = 340, scale = 2 } = opts;
  const pad = 20;
  const bodyW = width - pad * 2;
  const itemRows = Math.max(1, receipt.items.length);

  // --- tinggi dulu (semua posisi vertikal dihitung) ---
  const headerH = receipt.logo ? 150 : 108;
  const rowsH = itemRows * 34;
  const totalsH = 130;
  const footH = 96;
  const height = headerH + rowsH + totalsH + footH;

  const cv = document.createElement('canvas');
  cv.width = width * scale;
  cv.height = height * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);

  // latar
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, monospace';
  const INK = '#10162b';
  const MUTED = '#5a6480';
  const FAINT = '#8b93a7';
  const LINE = '#d8dcea';

  let y = pad;

  // --- logo ---
  let logo = null;
  if (receipt.logo) {
    try {
      logo = await loadImage(receipt.logo);
    } catch {
      logo = null;
    }
  }
  if (logo) {
    const size = 52;
    const aspect = logo.width / logo.height || 1;
    const w = aspect >= 1 ? size : size * aspect;
    const hh = aspect >= 1 ? size / aspect : size;
    ctx.drawImage(logo, (width - w) / 2, y, w, hh);
    y += Math.max(size, hh) + 12;
  }

  // --- kop toko ---
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `700 17px ${FONT}`;
  ctx.fillText(receipt.header || receipt.storeName || 'Struk', width / 2, y + 14);
  y += 22;
  ctx.fillStyle = MUTED;
  ctx.font = `400 10.5px ${FONT}`;
  if (receipt.address) {
    wrapText(ctx, receipt.address, width / 2, y, bodyW, 13);
    y += 13 * (1 + extraLines(ctx, receipt.address, bodyW));
  }
  if (receipt.phone) {
    ctx.fillText(receipt.phone, width / 2, y + 6);
    y += 16;
  }

  y += 6;
  // garis titik-titik ala struk thermal
  ctx.strokeStyle = LINE;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 16;

  // --- meta kasir / waktu / no. nota ---
  ctx.font = `500 10.5px ${FONT}`;
  ctx.fillStyle = MUTED;
  const rows = [
    ['No. nota', receipt.code || '—'],
    ['Waktu', new Date(receipt.ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })],
    ['Kasir', receipt.cashier || '—'],
  ];
  if (receipt.customer) rows.push(['Pelanggan', receipt.customer]);
  rows.forEach(([k, v]) => {
    ctx.textAlign = 'left';
    ctx.fillText(k, pad, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = `500 10.5px ${FONT}`;
    ctx.fillText(truncate(v, 26), width - pad, y);
    ctx.fillStyle = MUTED;
    y += 15;
  });

  y += 4;
  ctx.strokeStyle = LINE;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 18;

  // --- header tabel item ---
  ctx.font = `600 9.5px ${FONT}`;
  ctx.fillStyle = FAINT;
  ctx.textAlign = 'left';
  ctx.fillText('ITEM', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText('JUMLAH', width - pad, y);
  y += 8;
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  y += 16;

  // --- item ---
  receipt.items.forEach((it) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = `500 11.5px ${FONT}`;
    ctx.fillText(truncate(it.name, 24), pad, y);
    ctx.textAlign = 'right';
    ctx.font = `500 11.5px ${MONO}`;
    ctx.fillText(fmtShort(it.total ?? it.price * it.qty), width - pad, y);
    y += 15;

    ctx.textAlign = 'left';
    ctx.fillStyle = FAINT;
    ctx.font = `400 10px ${MONO}`;
    ctx.fillText(`${it.qty} × ${fmtShort(it.price)}`, pad, y);
    y += 19;
  });

  y += 2;
  ctx.strokeStyle = LINE;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 18;

  // --- rincian ---
  ctx.font = `400 11px ${FONT}`;
  const sumRows = [['Subtotal', fmtShort(receipt.subtotal)]];
  if (receipt.discount > 0) sumRows.push(['Diskon', `-${fmtShort(receipt.discount)}`]);
  if (receipt.deliveryFee > 0) sumRows.push(['Ongkir', fmtShort(receipt.deliveryFee)]);
  sumRows.forEach(([label, value]) => {
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.fillText(label, pad, y);
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(value, width - pad, y);
    y += 16;
  });

  // --- TOTAL ---
  y += 6;
  ctx.fillStyle = INK;
  ctx.font = `700 15px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(fmtShort(receipt.total), width - pad, y);
  y += 20;

  ctx.font = `400 10.5px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(receipt.payment || '', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(receipt.cashier || '', width - pad, y);
  y += 24;

  // --- footer ---
  ctx.textAlign = 'center';
  ctx.fillStyle = FAINT;
  ctx.font = `400 10.5px ${FONT}`;
  wrapText(ctx, receipt.footer || 'Terima kasih atas kunjungan Anda.', width / 2, y, bodyW, 14);
  y += 14 * (1 + extraLines(ctx, receipt.footer || 'Terima kasih atas kunjungan Anda.', bodyW));
  y += 8;
  ctx.font = `600 9.5px ${FONT}`;
  ctx.fillText('— Nota ini adalah bukti pembayaran yang sah —', width / 2, y);

  return cv;
}

function extraLines(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let n = 0;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      n += 1;
      line = w;
    } else line = t;
  }
  return n;
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text || '').split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function fmtShort(n) {
  const v = Number(n) || 0;
  return `Rp${String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
