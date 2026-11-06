/* My Kasir — local data store.
 *
 * Mirrors the Google Sheets schema from the PRD so the same field names can be
 * swapped onto Apps Script without touching the UI layer:
 *
 *   Products      id, name, category, price, cost, stock, unit, image, active,
 *                 trackStock, description, negotiable
 *   Categories    id, name, icon, color
 *   Transactions  id, ts, code, items, subtotal, discount, deliveryFee, total,
 *                 payment, cashier, channel, customer, table, status
 *   Orders        code, ts, status, payment, items, customer, channel, ...
 *   Users         username, password, name, role, active
 *   Queue         number, ts, status, code, label
 *   Settings      key, value
 *
 * Everything lives in localStorage under one key so a single read/write keeps
 * the whole database consistent.
 */

import { uid, isoDay, addDays, startOfDay } from './util.js';

const DB_KEY = 'mykasir.db.v1';

/* ==========================================================================
   Seed
   ========================================================================== */

const IMG = (slug) => `./assets/products/${slug}.webp`;

const SEED_CATEGORIES = [
  { id: 'cat_eyewear', name: 'Kacamata & Optik', icon: 'eye', color: '#2F4BFF' },
  { id: 'cat_apparel', name: 'Pakaian', icon: 'tag', color: '#FF5C7A' },
  { id: 'cat_bag', name: 'Tas', icon: 'bag', color: '#38BAFF' },
  { id: 'cat_footwear', name: 'Sepatu', icon: 'shoe', color: '#FF8A3D' },
  { id: 'cat_accessory', name: 'Aksesoris', icon: 'sparkles', color: '#7C5CFF' },
  { id: 'cat_equipment', name: 'Perlengkapan', icon: 'box', color: '#0FBFA8' },
];

const SEED_PRODUCTS = [
  {
    id: 'p_gog_attack', name: 'Goggles Attack Pro', category: 'cat_eyewear',
    price: 349000, cost: 189000, stock: 24, unit: 'pcs', image: IMG('goggles-attack'),
    active: true, trackStock: true, negotiable: false,
    description: 'Kacamata swimmer-latihan anti-kabut dengan seal silikon rapat. Lensa biru dengan proteksi UV400.',
    note: 'Frame 2.5mm, head strap 32mm adjustabel',
  },
  {
    id: 'p_gog_bigframe', name: 'Goggles Bigframe', category: 'cat_eyewear',
    price: 425000, cost: 235000, stock: 8, unit: 'pcs', image: IMG('goggles-bigframe'),
    active: true, trackStock: true, negotiable: false,
    description: 'Lens besar untuk latihan-renang intensify. Seal lateks hypersoft, adjustable nose bridge.',
    note: 'Anti-fog, 3 ukuran nasal',
  },
  {
    id: 'p_sun_nova', name: 'Sunglasses Nova', category: 'cat_eyewear',
    price: 289000, cost: 145000, stock: 31, unit: 'pcs', image: IMG('sunglasses-nova'),
    active: true, trackStock: true, negotiable: true,
    description: 'Frame acetate gradient dengan polarized lens. Ringan, cocok untuk daily wear.',
    note: 'Polarized, hard case',
  },
  {
    id: 'p_tee_coral', name: 'Kaos Renang Coral', category: 'cat_apparel',
    price: 189000, cost: 98000, stock: 45, unit: 'pcs', image: IMG('tshirt-coral'),
    active: true, trackStock: true, negotiable: false,
    description: 'Bahan polyester-chlorine 200gsm, cepat kering..ready stock semua warna.',
    note: 'S / M / L / XL',
  },
  {
    id: 'p_tee_mint', name: 'Kaos Renang Mint', category: 'cat_apparel',
    price: 189000, cost: 98000, stock: 38, unit: 'pcs', image: IMG('tshirt-mint'),
    active: true, trackStock: true, negotiable: false,
    description: 'Potongan regular fit dengan panel samping warna-warni. Jahitan rachel.',
    note: 'S / M / L / XL',
  },
  {
    id: 'p_tee_cobalt', name: 'Kaos Latihan Cobalt', category: 'cat_apparel',
    price: 165000, cost: 87000, stock: 0, unit: 'pcs', image: IMG('tshirt-cobalt'),
    active: true, trackStock: true, negotiable: false,
    description: 'Kaos training ringan dengan logo bordir dada. Warnanya tidak luntur بعدuci berkali-kali.',
    note: 'Stok habis — restock segera',
  },
  {
    id: 'p_shorts_ember', name: 'Celana Renang Ember', category: 'cat_apparel',
    price: 245000, cost: 132000, stock: 17, unit: 'pcs', image: IMG('shorts-ember'),
    active: true, trackStock: true, negotiable: true,
    description: 'Celana swim 7 inci dengan drawcord dan liner dalam. Quick-dry sampai 2 jam.',
    note: 'Pinggang elastic, ada pockets',
  },
  {
    id: 'p_shorts_navy', name: 'Celana Latihan Navy', category: 'cat_apparel',
    price: 210000, cost: 115000, stock: 22, unit: 'pcs', image: IMG('shorts-navy'),
    active: true, trackStock: true, negotiable: false,
    description: 'Celana pendek dengan side pocket zip dan reflektor strip untuk malam.',
    note: 'Reflective strip',
  },
  {
    id: 'p_bag_swim', name: 'Tas Renang waterproof', category: 'cat_bag',
    price: 275000, cost: 148000, stock: 14, unit: 'pcs', image: IMG('bag-swim'),
    active: true, trackStock: true, negotiable: false,
    description: 'Tas dry bag 20L, jahitan terpal, ransom strap bahu. Tahan air sampai tas terendam.',
    note: '20 liter, tutup roll-top',
  },
  {
    id: 'p_bag_daily', name: 'Tas Harian Urban', category: 'cat_bag',
    price: 320000, cost: 172000, stock: 19, unit: 'pcs', image: IMG('bag-daily'),
    active: true, trackStock: true, negotiable: true,
    description: 'Backpack 22L dengan compartment laptop 15 inci dan panel anti air.',
    note: '22 liter, laptop 15"',
  },
  {
    id: 'p_cap_ember', name: 'Topi Baseball Ember', category: 'cat_accessory',
    price: 129000, cost: 62000, stock: 52, unit: 'pcs', image: IMG('cap-ember'),
    active: true, trackStock: true, negotiable: false,
    description: 'Topi katun twill dengan buckle adjustable dan lubang anginembling. Bisa bordir nama.',
    note: 'Bisa bordir nama',
  },
  {
    id: 'p_shoe_drift', name: 'Sepatu Drift Aqua', category: 'cat_footwear',
    price: 465000, cost: 268000, stock: 11, unit: 'pcs', image: IMG('shoe-drift'),
    active: true, trackStock: true, negotiable: true,
    description: 'Sepatu air ringan dengan outsole karet anti-slip. Cocok untukholy dan beach walk.',
    note: 'Ukuran 38-44',
  },
  {
    id: 'p_jacket_storm', name: 'Jaket Windbreaker Storm', category: 'cat_apparel',
    price: 395000, cost: 215000, stock: 13, unit: 'pcs', image: IMG('jacket-storm'),
    active: true, trackStock: true, negotiable: false,
    description: 'Jaket anti angin tahan gerimis ringan dengan hood tuckable dan zip YKK.',
    note: 'Packable, hood tersembunyi',
  },
  {
    id: 'p_watch_pulse', name: 'Jam tangan Pulse', category: 'cat_accessory',
    price: 540000, cost: 318000, stock: 7, unit: 'pcs', image: IMG('watch-pulse'),
    active: true, trackStock: true, negotiable: true,
    description: 'Jam tangan digital anti air 50 meter dengan layar backlight dan stopwatch.',
    note: 'Anti air 50m',
  },
  {
    id: 'p_bottle_steel', name: 'Botol Air Steel 750ml', category: 'cat_equipment',
    price: 95000, cost: 38000, stock: 64, unit: 'pcs', image: IMG('bottle-steel'),
    active: true, trackStock: true, negotiable: false,
    description: 'Botol minum stainless steel 750ml dengan tutup anti bocor dan lapisan double-wall insulation.',
    note: '750ml, insulated 12 jam',
  },
  {
    id: 'p_towel_sand', name: 'Handuk Microfiber', category: 'cat_equipment',
    price: 65000, cost: 22000, stock: 3, unit: 'pcs', image: IMG('towel-sand'),
    active: true, trackStock: true, negotiable: false,
    description: 'Handuk microfiber 80x150cm, cepat kering dan tidak berbulu.',
    note: '80 x 150 cm',
  },
  {
    id: 'p_ball_pro', name: 'Bola Pro Match', category: 'cat_equipment',
    price: 185000, cost: 92000, stock: 26, unit: 'pcs', image: IMG('ball-pro'),
    active: true, trackStock: true, negotiable: false,
    description: 'Bola mangan latex dengan permukaan anti slip dan grip khusus.',
    note: 'Ukuran 5, latex premium',
  },
];

const SEED_SETTINGS = {
  storeName: 'My Kasir Aquatic',
  storeTagline: 'PerlengkapanIOC swim dan Apostolic',
  storeAddress: 'Jl. Merdeka No. 12, Bandung 40115',
  storePhone: '0812-3456-7890',
  currency: 'Rp',

  // feature switches — each one removes UI entirely when off
  featureCustomerName: true,
  featureTableNumber: false,
  featureQueue: true,
  featureDineIn: true,
  featureOnlineOrder: true,
  featureDelivery: true,
  featureRecipe: false,

  // editable terminology (no hardcoded F&B vocabulary)
  termProduct: 'Produk',
  termCategory: 'Kategori',
  termOrder: 'Pesanan',
  termDineIn: 'Makan di Tempat',
  termTakeAway: 'Bawa Pulang',
  termTable: 'Nomor',
  termQueue: 'Antrean',
  termIngredient: 'Stok',
  termCustomer: 'Pelanggan',

  allowNegotiable: true,
  allowDiscount: true,
  maxDiscountPercent: 30,
  requireCustomerName: false,

  deliveryFee: 12000,
  deliveryPerKm: 0,          // >0 → ongkir = jarak(km) × tarif ini
  deliveryRadiusKm: 12,
  storeLat: -6.9147,
  storeLng: 107.6098,
  storeAddressShort: 'Merdeka 12, Bandung',

  storeLogo: '',             // data-URL logo toko (upload di Pengaturan)
  qrisImage: '',             // data-URL foto QRIS statis (upload di Pengaturan)
  couriers: '[]',            // JSON string [{ name, phone }] — sama seperti mode GAS

  portalPin: '258000',
  qrisMerchant: 'MYKASIR AQUATIC',
  qrisNmid: 'ID1024398712345',
  receiptFooter: 'Terima kasih sudah belanja di My Kasir Aquatic!',
  receiptHeader: 'My Kasir Aquatic',
};

const SEED_USERS = [
  { id: 'u_owner', username: 'owner', password: 'owner123', name: 'Rani Kusuma', role: 'owner', active: true },
  { id: 'u_kasir1', username: 'kasir', password: 'kasir123', name: 'Dimas Pratama', role: 'kasir', active: true },
];

/* Deterministic PRNG so the demo dataset is identical on every load. */
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedTransactions() {
  const rnd = mulberry(20261105);
  const tx = [];
  const products = SEED_PRODUCTS.filter((p) => p.active);
  const cashiers = ['Dimas Pratama', 'Online'];
  const channels = ['offline', 'offline', 'offline', 'online'];
  const customers = ['Budi Santoso', 'Siti Rahayu', 'Andi Wijaya', 'Dewi Lestari', '', 'Agus Salim', 'Maya Puspa', ''];

  for (let dayOffset = 44; dayOffset >= 0; dayOffset--) {
    const day = startOfDay(addDays(new Date(), -dayOffset));
    const weekend = [0, 6].includes(day.getDay());
    const base = weekend ? 14 : 9;
    const count = base + Math.floor(rnd() * (weekend ? 12 : 8));

    for (let i = 0; i < count; i++) {
      const nItems = 1 + Math.floor(rnd() * 3);
      const picked = [];
      for (let k = 0; k < nItems; k++) {
        const p = products[Math.floor(rnd() * products.length)];
        if (!picked.find((x) => x.id === p.id)) picked.push(p);
      }
      const items = picked.map((p) => {
        const qty = 1 + Math.floor(rnd() * 3);
        return {
          id: p.id, name: p.name, price: p.price, qty,
          unit: p.unit, image: p.image, category: p.category,
          total: p.price * qty,
        };
      });
      const subtotal = items.reduce((s, it) => s + it.total, 0);
      const discount = rnd() > 0.82 ? Math.round(subtotal * (0.05 + rnd() * 0.1)) : 0;
      const delivery = channels[i % 4] === 'online' ? 12000 : 0;
      const total = subtotal - discount + delivery;

      const hour = 9 + Math.floor(rnd() * 11);
      const minute = Math.floor(rnd() * 60);
      const ts = new Date(day);
      ts.setHours(hour, minute, Math.floor(rnd() * 60), 0);

      const channel = channels[Math.floor(rnd() * channels.length)];
      tx.push({
        id: uid('tx'),
        ts: ts.toISOString(),
        code: `MK-${Math.floor(rnd() * 90000 + 10000)}`,
        items,
        subtotal, discount, deliveryFee: delivery, total,
        payment: rnd() > 0.42 ? 'QRIS' : 'Cash',
        cashier: channel === 'online' ? 'Online' : cashiers[0],
        channel,
        customer: channel === 'online' ? customers[Math.floor(rnd() * customers.length)] : '',
        table: '',
        status: 'paid',
      });
    }
  }
  return tx.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

function seedOrders() {
  const rnd = mulberry(771103);
  const codes = ['MK-A7K2X', 'MK-R9M4D', 'MK-Q3T8P', 'MK-L6V1N', 'MK-Z8B5W'];
  const statuses = ['pending', 'paid', 'paid', 'preparing', 'ready', 'cancelled'];
  const orders = [];

  const products = SEED_PRODUCTS.filter((p) => p.active && p.stock > 0);
  for (let i = 0; i < codes.length; i++) {
    const p = products[Math.floor(rnd() * products.length)];
    const qty = 1 + Math.floor(rnd() * 2);
    const ts = new Date(Date.now() - (i + 1) * 37 * 60 * 1000);
    const subtotal = p.price * qty;
    const delivery = rnd() > 0.5 ? 12000 : 0;
    const status = statuses[i];
    orders.push({
      code: codes[i],
      ts: ts.toISOString(),
      status,
      payment: status === 'pending' ? 'QRIS' : rnd() > 0.5 ? 'QRIS' : 'Cash',
      paymentStatus: status === 'cancelled' ? 'expired' : status === 'pending' ? 'unpaid' : 'paid',
      items: [{
        id: p.id, name: p.name, price: p.price, qty,
        unit: p.unit, image: p.image, category: p.category, total: p.price * qty,
      }],
      subtotal,
      discount: 0,
      deliveryFee: delivery,
      total: subtotal + delivery,
      customer: ['Budi Santoso', 'Siti Rahayu', 'Andi Wijaya', 'Dewi Lestari', 'Agus Salim'][i],
      channel: 'online',
      fulfilment: rnd() > 0.5 ? 'delivery' : 'pickup',
      address: rnd() > 0.5 ? 'Jl. Melati No. 4, Bandung' : '',
      note: '',
      expiresAt: new Date(ts.getTime() + 10 * 60 * 1000).toISOString(),
      paidAt: status === 'pending' ? null : new Date(ts.getTime() + 4 * 60 * 1000).toISOString(),
    });
  }
  return orders;
}

function seedQueue() {
  const rnd = mulberry(4242);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const ts = new Date(Date.now() - (12 - i) * 4 * 60 * 1000);
    const status = i < 3 ? 'ready' : i < 8 ? 'processing' : 'waiting';
    out.push({
      number: 21 + i,
      ts: ts.toISOString(),
      status,
      code: `MK-Q${100 + i}`,
      label: i % 2 ? 'Ambil di tempat' : 'Delivery',
    });
  }
  return out;
}

function buildSeed() {
  return {
    version: 1,
    settings: { ...SEED_SETTINGS },
    categories: SEED_CATEGORIES.map((c) => ({ ...c })),
    products: SEED_PRODUCTS.map((p) => ({ ...p })),
    users: SEED_USERS.map((u) => ({ ...u })),
    transactions: seedTransactions(),
    orders: seedOrders(),
    queue: seedQueue(),
    counter: { order: 0, queue: 33 },
  };
}

/* ==========================================================================
   Persistence
   ========================================================================== */

let state = null;
const listeners = new Set();

function read() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) {
        state = parsed;
        return state;
      }
    }
  } catch {
    /* corrupt payload — fall through to a fresh seed */
  }
  state = buildSeed();
  persist();
  return state;
}

function persist() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('My Kasir: gagal menyimpan data lokal', err);
  }
}

function commit() {
  persist();
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  });
}

/** Subscribe to data changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function db() {
  return read();
}

export function resetDatabase() {
  state = buildSeed();
  commit();
  return state;
}

export function exportDatabase() {
  return JSON.stringify(read(), null, 2);
}

export function importDatabase(json) {
  const parsed = JSON.parse(json);
  if (!parsed || parsed.version !== 1) throw new Error('Format berkas tidak dikenali');
  state = parsed;
  commit();
}

/* ==========================================================================
   Settings
   ========================================================================== */

export function settings() {
  return { ...read().settings };
}

export function setSetting(key, value) {
  read().settings[key] = value;
  commit();
}

export function setSettings(patch) {
  Object.assign(read().settings, patch);
  commit();
}

/** Feature switch helper — a disabled feature removes its UI entirely. */
export function featureOn(key) {
  return !!read().settings[key];
}

/** Owner-editable vocabulary, always falls back to a sensible default. */
export function term(key) {
  const s = read().settings;
  const fallback = {
    termProduct: 'Produk', termCategory: 'Kategori', termOrder: 'Pesanan',
    termDineIn: 'Makan di Tempat', termTakeAway: 'Bawa Pulang', termTable: 'Nomor',
    termQueue: 'Antrean', termIngredient: 'Stok', termCustomer: 'Pelanggan',
  };
  return s[key] || fallback[key] || key;
}

/* ==========================================================================
   Categories & products
   ========================================================================== */

export function categories() {
  return read().categories.map((c) => ({ ...c }));
}

export function saveCategory(cat) {
  const d = read();
  if (cat.id) {
    const i = d.categories.findIndex((c) => c.id === cat.id);
    if (i >= 0) d.categories[i] = { ...d.categories[i], ...cat };
  } else {
    d.categories.push({
      id: uid('cat'),
      name: cat.name || 'Kategori baru',
      icon: cat.icon || 'tag',
      color: cat.color || '#2F4BFF',
    });
  }
  commit();
}

export function deleteCategory(id) {
  const d = read();
  const used = d.products.filter((p) => p.category === id);
  if (used.length) {
    return { ok: false, reason: `${used.length} produk masih memakai kategori ini` };
  }
  d.categories = d.categories.filter((c) => c.id !== id);
  commit();
  return { ok: true };
}

export function products({ activeOnly = false } = {}) {
  const d = read();
  const list = activeOnly ? d.products.filter((p) => p.active) : d.products;
  return list.map((p) => ({ ...p }));
}

export function product(id) {
  const p = read().products.find((x) => x.id === id);
  return p ? { ...p } : null;
}

export function saveProduct(p) {
  const d = read();
  if (p.id) {
    const i = d.products.findIndex((x) => x.id === p.id);
    if (i >= 0) d.products[i] = { ...d.products[i], ...p };
  } else {
    d.products.push({
      id: uid('p'),
      name: 'Produk baru',
      category: d.categories[0]?.id || '',
      price: 0,
      cost: 0,
      stock: 0,
      unit: 'pcs',
      image: '',
      active: true,
      trackStock: true,
      negotiable: false,
      description: '',
      note: '',
      ...p,
    });
  }
  commit();
}

export function deleteProduct(id) {
  const d = read();
  d.products = d.products.filter((p) => p.id !== id);
  commit();
}

export function adjustStock(id, delta) {
  const d = read();
  const p = d.products.find((x) => x.id === id);
  if (!p) return null;
  p.stock = Math.max(0, (p.stock || 0) + delta);
  commit();
  return p.stock;
}

/* ==========================================================================
   Users
   ========================================================================== */

export function users() {
  return read().users.map((u) => ({ ...u }));
}

export function saveUser(u) {
  const d = read();
  if (u.id) {
    const i = d.users.findIndex((x) => x.id === u.id);
    if (i >= 0) d.users[i] = { ...d.users[i], ...u };
  } else {
    d.users.push({
      id: uid('u'), username: '', password: '', name: '', role: 'kasir', active: true, ...u,
    });
  }
  commit();
}

export function deleteUser(id) {
  const d = read();
  d.users = d.users.filter((u) => u.id !== id);
  commit();
}

/* ==========================================================================
   Transactions & orders
   ========================================================================== */

export function transactions() {
  return read().transactions.map((t) => ({ ...t }));
}

export function addTransaction(tx) {
  const d = read();
  const record = { id: uid('tx'), ts: new Date().toISOString(), status: 'paid', ...tx };
  d.transactions.unshift(record);
  commit();
  return record;
}

export function deleteTransaction(id) {
  const d = read();
  d.transactions = d.transactions.filter((t) => t.id !== id);
  commit();
}

export function orders() {
  return read().orders.map((o) => ({ ...o }));
}

export function findOrder(code) {
  const key = String(code || '').trim().toUpperCase();
  const o = read().orders.find((x) => x.code.toUpperCase() === key);
  return o ? { ...o } : null;
}

export function saveOrder(order) {
  const d = read();
  const i = d.orders.findIndex((o) => o.code === order.code);
  if (i >= 0) d.orders[i] = { ...d.orders[i], ...order };
  else d.orders.unshift(order);
  commit();
}

export function updateOrderStatus(code, status, extra = {}) {
  const d = read();
  const o = d.orders.find((x) => x.code === code);
  if (!o) return null;
  o.status = status;
  if (status === 'paid' && !o.paidAt) o.paidAt = new Date().toISOString();
  if (extra && extra.courier !== undefined) o.courier = extra.courier || '';
  if (extra && extra.courierPhone !== undefined) o.courierPhone = extra.courierPhone || '';
  commit();
  return { ...o };
}

/** Cancel orders whose QRIS window closed — mirrors cancelExpiredOnlineOrders. */
export function cancelExpiredOrders(now = Date.now()) {
  const d = read();
  let changed = 0;
  for (const o of d.orders) {
    if (o.status === 'pending' && o.expiresAt && new Date(o.expiresAt).getTime() < now) {
      o.status = 'cancelled';
      o.paymentStatus = 'expired';
      changed += 1;
    }
  }
  if (changed) commit();
  return changed;
}

/* ==========================================================================
   Queue
   ========================================================================== */

export function queue() {
  return read().queue.map((q) => ({ ...q }));
}

export function pushQueue(entry) {
  const d = read();
  d.counter.queue += 1;
  const record = {
    number: d.counter.queue,
    ts: new Date().toISOString(),
    status: 'waiting',
    code: '',
    label: '',
    ...entry,
  };
  d.queue.push(record);
  commit();
  return record;
}

export function setQueueStatus(number, status) {
  const d = read();
  const q = d.queue.find((x) => x.number === number);
  if (!q) return null;
  q.status = status;
  commit();
  return { ...q };
}

export function clearQueue() {
  const d = read();
  d.queue = d.queue.filter((q) => q.status !== 'ready');
  commit();
}

/* ==========================================================================
   Reports
   ========================================================================== */

export function reportDaily(days = 14) {
  const d = read();
  const today = startOfDay(new Date());
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    buckets.set(isoDay(day), {
      key: isoDay(day),
      label: day.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
      weekday: day.toLocaleDateString('id-ID', { weekday: 'short' }),
      total: 0, orders: 0, cash: 0, qris: 0, online: 0, offline: 0,
    });
  }

  for (const t of d.transactions) {
    const key = isoDay(new Date(t.ts));
    const b = buckets.get(key);
    if (!b) continue;
    b.total += t.total;
    b.orders += 1;
    if (t.payment === 'Cash') b.cash += t.total;
    else b.qris += t.total;
    if (t.channel === 'online') b.online += 1;
    else b.offline += 1;
  }

  return Array.from(buckets.values());
}

export function reportTopProducts(limit = 5, days = 14) {
  const since = startOfDay(addDays(new Date(), -(days - 1))).getTime();
  const tally = new Map();
  for (const t of read().transactions) {
    if (new Date(t.ts).getTime() < since) continue;
    for (const it of t.items || []) {
      const cur = tally.get(it.id) || { id: it.id, name: it.name, qty: 0, revenue: 0, image: it.image, color: it.color };
      cur.qty += it.qty;
      cur.revenue += it.total || 0;
      tally.set(it.id, cur);
    }
  }
  return Array.from(tally.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export function reportHourly() {
  const d = read();
  const hours = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 9}:00`, total: 0, orders: 0 }));
  const since = startOfDay(addDays(new Date(), -6)).getTime();
  for (const t of d.transactions) {
    const ts = new Date(t.ts).getTime();
    if (ts < since) continue;
    const hr = new Date(t.ts).getHours();
    if (hr < 9 || hr > 20) continue;
    const slot = hours[hr - 9];
    slot.total += t.total;
    slot.orders += 1;
  }
  return hours;
}

export function reportChannels(days = 14) {
  const since = startOfDay(addDays(new Date(), -(days - 1))).getTime();
  let offline = 0;
  let online = 0;
  for (const t of read().transactions) {
    if (new Date(t.ts).getTime() < since) continue;
    if (t.channel === 'online') online += t.total;
    else offline += t.total;
  }
  return { offline, online };
}

export function summaryToday() {
  const d = read();
  const start = startOfDay(new Date()).getTime();
  const today = d.transactions.filter((t) => new Date(t.ts).getTime() >= start);
  const revenue = today.reduce((s, t) => s + t.total, 0);
  const pending = d.orders.filter((o) => o.status === 'pending').length;
  const ready = d.queue.filter((q) => q.status === 'ready').length;
  const lowStock = d.products.filter((p) => p.active && p.trackStock && p.stock > 0 && p.stock <= 5);
  const outStock = d.products.filter((p) => p.active && p.trackStock && p.stock <= 0);
  return {
    revenue,
    orders: today.length,
    average: today.length ? Math.round(revenue / today.length) : 0,
    pending,
    ready,
    lowStock: lowStock.length,
    outStock: outStock.length,
    itemsSold: today.reduce((s, t) => s + (t.items || []).reduce((a, i) => a + i.qty, 0), 0),
  };
}

/** Split today's transactions by hour for the dashboard sparkline. */
export function todayByHour() {
  const start = startOfDay(new Date()).getTime();
  const slots = Array.from({ length: 13 }, (_, i) => ({ label: `${i + 8}:00`, value: 0 }));
  for (const t of read().transactions) {
    if (new Date(t.ts).getTime() < start) break;
    const hr = new Date(t.ts).getHours();
    if (hr >= 8 && hr <= 20) slots[hr - 8].value += t.total;
  }
  return slots;
}
