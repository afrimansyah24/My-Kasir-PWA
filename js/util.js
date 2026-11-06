/* My Kasir — shared utilities. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Tiny hyperscript. h('div.card', {onclick}, child, child) */
export function h(tag, props = null, ...kids) {
  let el;
  const [name, ...classes] = String(tag).split('.');
  if (name.startsWith('#')) {
    el = document.createElement('div');
    el.id = name.slice(1);
  } else {
    el = document.createElement(name || 'div');
  }
  if (classes.length) el.className = classes.join(' ');

  // A bare string/number in the props slot is a child, not a props bag. Without
  // this guard `h('div.x', 'hello')` would iterate the string's indices and
  // throw on setAttribute('0', …).
  if (typeof props === 'string' || typeof props === 'number') {
    kids = [props, ...kids];
    props = null;
  }

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = el.className ? `${el.className} ${v}` : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'disabled' || k === 'checked' || k === 'selected') {
        el[k] = !!v;
      } else {
        el.setAttribute(k, v === true ? '' : v);
      }
    }
  }

  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Escape untrusted text before it goes near innerHTML. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* --- numbers ------------------------------------------------------------ */
export function rupiah(n, { sign = false, decimals = false } = {}) {
  const v = Number(n) || 0;
  const s = v % 1 === 0 && !decimals ? String(Math.round(v)) : v.toFixed(2);
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefix = sign && v > 0 ? '+' : '';
  return `${prefix}Rp${grouped}`;
}

export function numberShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}rb`;
  return String(Math.round(v));
}

export function pct(part, whole) {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/* --- dates -------------------------------------------------------------- */
export function fmtDate(d, opt) {
  return new Date(d).toLocaleDateString('id-ID', opt || { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtTime(d) {
  return new Date(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(d) {
  return `${fmtDate(d)} · ${fmtTime(d)}`;
}

export function relTime(d) {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} hari lalu`;
  return fmtDate(d);
}

export function isoDay(d = new Date()) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

export function startOfDay(d = new Date()) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

/* --- ids & codes -------------------------------------------------------- */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Human-readable order code, e.g. MK-7G4K2 */
export function orderCode() {
  const chars = 'ACDEFGHJKLMNPQRTUVWXY349';
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `MK-${out}`;
}

/* --- misc --------------------------------------------------------------- */
export function debounce(fn, ms = 240) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function uid_seed() {
  return Math.random().toString(36).slice(2, 10);
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** Deterministic 0..1 hash — used for stable pseudo-random product colours. */
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Pick from a palette deterministically. */
export function pick(list, seed) {
  return list[Math.floor(hash01(seed) * list.length) % list.length];
}

/* --- icons (inline SVG, stroke-based) ----------------------------------- */
const ICONS = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 8H6M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
  chevronRight: 'm9 18 6-6-6-6',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronDown: 'm6 9 6 6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  lock: 'M5 11h14v10H5V11Zm3 0V7a4 4 0 1 1 8 0v4',
  unlock: 'M5 11h14v10H5V11Zm3 0V7a4 4 0 0 1 7.5-2',
  chart: 'M3 3v18h18M7 15l3-4 3 3 5-7',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  box: 'M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8ZM3.3 7 12 12l8.7-5M12 22V12',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a7.5 7.5 0 0 0-2-1.2L14.4 2h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.5-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.5 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  receipt: 'M4 3h16v18l-3-2-2 2-3-2-3 2-2-2-3 2V3Zm4 6h8M8 13h8',
  wallet: 'M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v1M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M3 7h16m1 6h-4a2 2 0 0 1 0-4h4v4Z',
  cash: 'M2 6h20v12H2V6Zm10 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  qr: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm12 0h3v3h-3v-3Zm4 4h2v3h-2v-3Z',
  pin: 'M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  heart: 'M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.6 12 20 12 20Z',
  gift: 'M3 11h18v10H3V11Zm9 0v10M12 7.5C12 7.5 8.5 7 8.5 4.8A2.3 2.3 0 0 1 12 3.6a2.3 2.3 0 0 1 3.5 1.2c0 2.2-3.5 2.7-3.5 2.7ZM3 7h18',
  medal: 'M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM9.5 19 12 15l2.5 4M8 3h8l-2.5 4M8 3l2.5 4',
  bike: 'M5.5 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-13-3h5l3-8h4M9 7h3m3 0h3l1 4',
  ticket: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Zm9-2v12',
  scissors: 'M6 4l12 12M18 4L6 16M6.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  chef: 'M7 21h10M6 17h12v4H6v-4Zm-1-3a4 4 0 0 1-1-7.9A4 4 0 0 1 12 3a4 4 0 0 1 7 3.1A4 4 0 0 1 18 14H7Z',
  cup: 'M6 3h12v9a6 6 0 0 1-12 0V3Zm12 2h2a2 2 0 0 1 0 4h-2M5 21h14',
  shirt: 'M8 3 4 6v15h16V6l-4-3-4 3-4-3Zm4 3v15',
  shoe: 'M3 16V9h4l3 3h6l5 4v3H3v-3Z',
  flower: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-11c1.7 0 3 1.3 3 3s-1.3 2-3 2-2-1.3-2-3 1-2 2-2Zm0 12c1.7 0 3 1.3 3 3s-1.3 2-3 2-2-1.3-2-3 1-2 2-2ZM3 12c0-1.7 1.3-3 3-3s2 1.3 2 3-1.3 2-3 2-2-1.3-2-2Zm12 0c0-1.7 1.3-3 3-3s2 1.3 2 3-1.3 2-3 2-2-1.3-2-2Z',
  truck: 'M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  store: 'M3 9V8l2-4h14l2 4v1a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0ZM5 12v8h14v-8M10 20v-5h4v5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-9.5Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3.5 2',
  monitor: 'M3 4h18v12H3V4Zm6 16h6M12 16v4',
  smartphone: 'M7 2h10v20H7V2Zm3 17h4',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  upload: 'M12 15V3m0 0L8 7m4-4 4 4M4 19h16',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.3A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.2M6.2 6.7A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 3.5-.6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v.01M11 12h1v5h1',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-5',
  xCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6m0-6-6 6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 16v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z',
  install: 'M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  tag: 'M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a2 2 0 0 1 0 2.8ZM7.5 8.5h.01',
  layers: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
  percent: 'M19 5 5 19M7.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm9 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  sound: 'M11 5 6 9H2v6h4l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14',
  mute: 'M11 5 6 9H2v6h4l5 4V5Zm5 4 5 6m0-6-5 6',
  printer: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6v-7Z',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3m0 0L8 7m4-4 4 4',
  copy: 'M9 9h10v12H9V9Zm-4 6H3V3h12v2',
  headset: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5Zm16 0h-3v6h2a1 1 0 0 0 1-1v-5ZM17 20h-4',
  key: 'M15.5 9.5a4.5 4.5 0 1 1-4.24 6H8v3H5v-3H2v-3l9.5-9.5a4.5 4.5 0 0 1 4 3.5Z',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z',
  flame: 'M12 22c4 0 6-2.7 6-6 0-4.5-4-6.5-4-10-2 1-3 3-3 5 0 1-1 2-2 2s-1.5-.8-1.5-2C6 12 6 14 6 16c0 3.3 2 6 6 6Z',
  boxicon: 'M4 7h16v13H4V7Zm0 0 2-4h12l2 4M9 12h6',
  fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5',
  map: 'm1 6 7-3 8 3 7-3v15l-7 3-8-3-7 3V6Zm7-3v15m8-12v15',
  scale: 'M12 3v18M7 21h10M5 7h14M7 7 4 14h6L7 7Zm10 0-3 7h6l-3-7Z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3.5 2',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  minusCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12h8',
  more: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3Zm9 3c0 1.66-4.03 3-9 3s-9-1.34-9-3M3 8v8c0 1.66 4.03 3 9 3s9-1.34 9-3V8',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.21 0 4-4.03 4-9s-1.79-9-4-9-4 4.03-4 9 1.79 9 4 9ZM3.6 9h16.8M3.6 15h16.8',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z',
  image: 'M3 3h18v18H3V3Zm0 14 5-5 4 4 3-3 6 6M8.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  note: 'M4 4h16v16H4V4Zm4 4h8M8 12h8M8 16h5',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  navigation: 'M3 11 22 2l-9 19-2-8-8-2Z',
};

/** Build an inline SVG icon element. */
/** Daftar nama ikon yang tersedia (untuk pemilih ikon di pengaturan). */
export const ICON_NAMES = Object.keys(ICONS);

export function icon(name, cls = 'ico') {
  // Nama ikon yang tidak dikenal (mis. 설정 lama) jatuh ke ikon bawaan
  // supaya tidak muncul kotak kosong.
  const d = ICONS[name] || ICONS.sparkles;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  if (d) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Icon as a raw SVG string (for innerHTML contexts). */
export function iconSvg(name, cls = 'ico') {
  const d = ICONS[name] || '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/* --- toasts ------------------------------------------------------------- */
let toastWrap = null;

export function toast(message, kind = 'info', ms = 3200) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    toastWrap.setAttribute('role', 'status');
    toastWrap.setAttribute('aria-live', 'polite');
    document.body.append(toastWrap);
  }
  const map = { ok: 'checkCircle', err: 'xCircle', warn: 'alert', info: 'info' };
  const el = h('div.toast', { class: `toast--${kind}` }, icon(map[kind] || 'info'), h('span', null, message));
  toastWrap.append(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  }, ms);
  return el;
}

/* --- modal -------------------------------------------------------------- */
let openModal = null;

/**
 * Show a modal. `render` receives a close() callback and returns content.
 * Returns { close }.
 */
export function modal(render, { wide = false, tall = false, onClose = null } = {}) {
  const scrim = h('div.scrim');
  const box = h('div.modal', { class: `${wide ? 'modal--wide' : ''} ${tall ? 'modal--tall' : ''}`.trim() });

  const close = () => {
    scrim.classList.remove('is-open');
    box.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      scrim.remove();
      box.remove();
    }, 260);
    if (openModal === close) openModal = null;
    if (onClose) onClose();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const content = render(close);
  box.append(content);
  document.body.append(scrim, box);
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', close);

  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    box.classList.add('is-open');
  });

  openModal = close;
  return { close, box };
}

export function closeModal() {
  if (openModal) openModal();
}

/* --- misc UI ------------------------------------------------------------ */
export function emptyState(iconName, title, body, action) {
  return h(
    'div.empty',
    icon(iconName, 'empty__ico'),
    h('h3.t-h2', null, title),
    h('p.t-body', null, body),
    action || null
  );
}

export function confirmDialog({ title, body, confirmLabel = 'Hapus', danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const m = modal(
      (close) =>
        h(
          'div',
          h(
            'div.modal__head',
            h('div.grow', null, h('h3.t-h2', null, title), body ? h('p.t-body', { style: { marginTop: '6px' } }, body) : null),
            h('button.btn.btn--icon.btn--ghost', { onclick: () => { settle(false); close(); }, 'aria-label': 'Tutup' }, icon('close'))
          ),
          h(
            'div.modal__foot',
            h('button.btn.btn--ghost.grow', { onclick: () => { settle(false); close(); } }, 'Batal'),
            h(
              'button.btn.grow',
              {
                class: danger ? 'btn--dark' : 'btn--primary',
                style: danger ? { background: 'var(--coral)', color: '#fff' } : null,
                onclick: () => { settle(true); close(); },
              },
              confirmLabel
            )
          )
        ),
      { onClose: () => settle(false) }
    );
    return m;
  });
}

/** Copy text to clipboard with a graceful fallback. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Read a File as a data URL, downscaling large images first. */
export function fileToDataUrl(file, maxSize = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca berkas'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Berkas gambar tidak valid'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 320_000) {
          resolve(reader.result);
          return;
        }
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/webp', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------------------
   Geo & image-storage helpers
   ---------------------------------------------------------------------- */

/**
 * Normalisasi koordinat geografis.
 *
 * Beberapa Spreadsheet legacy menyimpan koordinat tanpa titik desimal,
 * contoh -7098393 / 112188021 untuk -7.098393 / 112.188021. Angka valid
 * yang sudah berada dalam rentang bumi tidak pernah diubah.
 *
 * @param {'lat'|'lng'|'latitude'|'longitude'} axis
 * @returns {number|null}
 */
export function normalizeCoordinate(value, axis = 'lat') {
  if (value === null || value === undefined || value === '') return null;
  const limit = axis === 'lng' || axis === 'longitude' ? 180 : 90;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) <= limit) return n;
  if (Number.isInteger(n)) {
    const scaled = n / 1_000_000;
    if (Math.abs(scaled) <= limit) return scaled;
  }
  return null;
}

/** Jarak dua titik GPS dalam km (haversine). */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Load gambar sebagai Promise (untuk canvas / preview). */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar gagal dimuat'));
    img.src = src;
  });
}

/**
 * Kompres gambar agar aman disimpan di sel Spreadsheet (GAS membatasi
 * ± 45.000 karakter per sel → data-URL base64 harus <= ~maxBytes).
 * Otomatis menurunkan ukuran sisi & kualitas sampai muat.
 */
export async function compressForStorage(file, { maxSize = 640, quality = 0.85, maxBytes = 44_000 } = {}) {
  let dataUrl;
  try {
    dataUrl = await fileToDataUrl(file, maxSize);
  } catch {
    dataUrl = await fileToDataUrl(file, 320);
  }

  const encode = async (w, hgt, q) => {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, w / img.width, hgt / img.height);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * scale));
    cv.height = Math.max(1, Math.round(img.height * scale));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL('image/webp', q);
    // webp tidak didukung lama -> kembali ke jpeg
    if (!url.startsWith('data:image/webp')) return cv.toDataURL('image/jpeg', q);
    return url;
  };

  let size = dataUrl.length;
  if (size <= maxBytes) return dataUrl;

  let q = quality;
  let edge = Math.min(maxSize, 480);
  for (let i = 0; i < 6 && size > maxBytes; i++) {
    const res = await encode(edge, edge, q);
    size = res.length;
    if (size <= maxBytes) return res;
    dataUrl = res;
    q = Math.max(0.4, q - 0.14);
    edge = Math.max(160, Math.round(edge * 0.75));
  }
  return dataUrl;
}

/** Data-URL gambar valid? (string kosong / non-data dianggap tidak). */
export function isImageValue(v) {
  return typeof v === 'string' && v.startsWith('data:image/');
}

/* -------------------------------------------------------------------------
   Sumber gambar: data-URL, Google Drive, atau URL biasa
   --------------------------------------------------------------------------
   Gambar hasil unggahan disimpan sebagai data-URL base64. Data-URL cukup
   panjang (±45.000 karakter) sehingga TIDAK bisa dikirim lewat URL JSONP
   — itu sebab unggahan besar gagal.

   Solusinya: simpan gambar di Google Drive, lalu simpan HANYA kode file-nya
   (kurang dari 40 karakter) di Spreadsheet. Kode ini diubah jadi URL
   thumbnail saat ditampilkan.
   ---------------------------------------------------------------------- */

/** Ambil ID file Google Drive dari diverse bentuk input. */
export function driveFileId(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v) return '';

  // https://drive.google.com/file/d/<ID>/view?usp=sharing
  let m = v.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];

  // https://drive.google.com/open?id=<ID>
  m = v.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];

  // https://drive.google.com/uc?id=<ID>&export=view
  m = v.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];

  // https://lh3.googleusercontent.com/d/<ID>=w800
  m = v.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];

  // ID mentah (tanpa garis miring) — huruf/angka/garis bawah/minus.
  if (/^[a-zA-Z0-9_-]{10,}$/.test(v)) return v;

  return '';
}

/**
 * Ubah nilai gambar yang tersimpan menjadi URL yang bisa dimuat <img>.
 *
 * - data-URL  -> dipakai langsung
 * - kode/URL Drive -> URL thumbnail Drive
 * - URL lain  -> dipakai langsung
 */
export function resolveImageSrc(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v) return '';

  if (v.startsWith('data:image/')) return v;
  if (/^https?:\/\//i.test(v) && !driveFileId(v)) return v;

  const id = driveFileId(v);
  if (id) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w800`;
  }

  return v;
}

/**
 * Perkecil data-URL sampai muat di URL JSONP.
 *
 * Batas URL browser ±32.000 karakter. Base64 membesar ±33% saat
 * di-URL-encode, jadi data-URL harus di bawah ±20.000 karakter agar
 * permintaan tidak ditolak browser.
 */
export const JSONP_SAFE_MAX_CHARS = 16_000;
