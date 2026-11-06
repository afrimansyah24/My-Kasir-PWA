/* My Kasir — cart state, QRIS rendering and receipt data.
 *
 * The cart lives in memory (and is mirrored to localStorage so a refresh does
 * not lose an in-progress basket).
 */

import * as store from './store.js';
import { orderCode } from './util.js';

const CART_KEY = 'mykasir.cart.v1';

const state = {
  items: [], // { id, name, price, qty, unit, image, category }
  note: '',
  fulfilment: 'pickup',
  discount: 0,
  customer: '',
  phone: '',
  address: '',
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
  emit();
}

export function setFulfilment(mode) {
  state.fulfilment = mode === 'delivery' ? 'delivery' : 'pickup';
  emit();
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
  const max = store.settings().maxDiscountPercent || 0;
  const cap = (subtotal() * max) / 100;
  return Math.min(state.discount || 0, cap);
}

export function deliveryFee() {
  const s = store.settings();
  return state.fulfilment === 'delivery' && s.featureDelivery ? Number(s.deliveryFee) || 0 : 0;
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
export function checkoutOffline({ payment, cashier, customer, table, fulfilment, discount = 0 }) {
  const s = store.settings();
  const items = state.items.map((i) => ({ ...i, total: i.price * i.qty }));

  for (const it of items) {
    const p = store.product(it.id);
    if (!p) throw new Error(`Produk "${it.name}" tidak ditemukan`);
    if (p.trackStock && p.stock < it.qty) {
      throw new Error(`Stok ${it.name} tersisa ${p.stock} ${p.unit}`);
    }
  }

  const sub = items.reduce((acc, i) => acc + i.total, 0);
  const disc = Math.min(Number(discount) || 0, sub);
  const fee = fulfilment === 'delivery' ? Number(s.deliveryFee) || 0 : 0;
  const grand = Math.max(0, sub - disc + fee);

  const code = orderCode();
  const tx = store.addTransaction({
    ts: new Date().toISOString(),
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
  });

  for (const it of items) {
    const p = store.product(it.id);
    if (p?.trackStock) store.adjustStock(it.id, -it.qty);
  }

  return { tx, receipt: buildReceipt(tx) };
}

/* -------------------------------------------------------------------------
   Receipt
   ---------------------------------------------------------------------- */

export function buildReceipt(tx) {
  const s = store.settings();
  return {
    header: s.receiptHeader || s.storeName,
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

/** Draw a receipt onto a canvas for printing / sharing. */
export function receiptCanvas(receipt, opts = {}) {
  const { width = 340, scale = 2 } = opts;
  const pad = 18;
  const lineH = 20;
  const itemRows = receipt.items.length;
  const height = 300 + itemRows * 34 + 140;

  const cv = document.createElement('canvas');
  cv.width = width * scale;
  cv.height = height * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#10162b';
  ctx.textAlign = 'center';
  ctx.font = '700 17px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(receipt.header, width / 2, 34);
  ctx.font = '400 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillStyle = '#5a6480';
  ctx.fillText(receipt.address, width / 2, 52);
  ctx.fillText(receipt.phone, width / 2, 66);

  ctx.textAlign = 'left';
  let y = 92;
  ctx.strokeStyle = '#d8dcea';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  ctx.setLineDash([]);

  y += 18;
  ctx.font = '500 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillStyle = '#5a6480';
  ctx.fillText(new Date(receipt.ts).toLocaleString('id-ID'), pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(receipt.code, width - pad, y);

  y += 22;
  receipt.items.forEach((it) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#10162b';
    ctx.font = '500 11.5px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(truncate(it.name, 26), pad, y);
    ctx.textAlign = 'right';
    ctx.font = '400 11px "JetBrains Mono", monospace';
    ctx.fillText(`${it.qty} × ${fmtShort(it.price)}`, width - pad, y);
    y += 15;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7b849c';
    ctx.font = '400 10.5px "JetBrains Mono", monospace';
    ctx.fillText(fmtShort(it.total), pad, y);
    y += 22;
  });

  y += 4;
  ctx.strokeStyle = '#d8dcea';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  ctx.setLineDash([]);

  y += 20;
  ctx.font = '400 11px "Plus Jakarta Sans", system-ui, sans-serif';
  const rows = [
    ['Subtotal', fmtShort(receipt.subtotal)],
  ];
  if (receipt.discount > 0) rows.push(['Diskon', `-${fmtShort(receipt.discount)}`]);
  if (receipt.deliveryFee > 0) rows.push(['Ongkir', fmtShort(receipt.deliveryFee)]);
  rows.forEach(([label, value]) => {
    ctx.fillStyle = '#5a6480';
    ctx.textAlign = 'left';
    ctx.fillText(label, pad, y);
    ctx.fillStyle = '#10162b';
    ctx.textAlign = 'right';
    ctx.fillText(value, width - pad, y);
    y += 17;
  });

  y += 4;
  ctx.fillStyle = '#10162b';
  ctx.font = '700 14px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(fmtShort(receipt.total), width - pad, y);
  y += 18;
  ctx.font = '400 11px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillStyle = '#5a6480';
  ctx.textAlign = 'left';
  ctx.fillText(receipt.payment, pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(receipt.cashier, width - pad, y);

  y += 30;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7b849c';
  ctx.font = '400 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
  wrapText(ctx, receipt.footer, width / 2, y, width - pad * 2, 14);

  return cv;
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
