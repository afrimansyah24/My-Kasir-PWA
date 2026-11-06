/* My Kasir — peta interaktif (OpenStreetMap / Leaflet).
 *
 * Dipakai di dua tempat:
 *   1. Pengaturan owner — memilih titik lokasi toko.
 *   2. Checkout pelanggan (delivery) — memilih titik lokasi pengiriman.
 *
 * Leaflet dimuat dari salinan lokal (vendor/) agar tetap jalan offline.
 */

import { h, icon, haversineKm } from './util.js';
import { withBase } from './app.js';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; OpenStreetMap';

/** Leaflet sudah dimuat? */
export function leafletReady() {
  return typeof window !== 'undefined' && !!window.L;
}

/** Muat Leaflet (CSS + JS) sekali saja; mengembalikan Promise. */
let leafletPromise = null;
export function loadLeaflet() {
  if (leafletReady()) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet-css]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = withBase('vendor/leaflet.css');
      css.dataset.leafletCss = '1';
      document.head.append(css);
    }

    const existing = document.querySelector('script[data-leaflet-js]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L), { once: true });
      existing.addEventListener('error', () => reject(new Error('Gagal memuat pustaka peta')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = withBase('vendor/leaflet.js');
    script.dataset.leafletJs = '1';
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error('Leaflet tidak termuat')));
    script.onerror = () => reject(new Error('Gagal memuat pustaka peta (vendor/leaflet.js)'));
    document.head.append(script);
  });

  return leafletPromise;
}

/**
 * Peta pilihan titik.
 *
 * @param {object} opts
 *   lat, lng      – titik awal
 *   zoom          – level zoom awal
 *   radiusKm      – radius layanan (digambar sebagai lingkaran)
 *   height        – tinggi elemen (px)
 *   allowDrag     – marker boleh digeser (default true)
 *   onChange      – callback({ lat, lng, distanceKm })
 * @returns {{ el: HTMLElement, setPoint: Function, setRadius: Function }}
 */
export function createPickerMap(opts = {}) {
  const {
    lat = -6.9147,
    lng = 107.6098,
    zoom = 14,
    radiusKm = 0,
    height = 340,
    allowDrag = true,
    onChange = null,
  } = opts;

  const el = h('div.map-picker', {
    style: { height: `${height}px`, position: 'relative', borderRadius: 'var(--r-lg)', overflow: 'hidden', border: '1px solid var(--line)' },
  });

  const overlay = h('div.map-picker__overlay');
  el.append(overlay);

  let map = null;
  let marker = null;
  let circle = null;
  let current = { lat: Number(lat), lng: Number(lng) };

  const report = () => {
    if (onChange) onChange({ ...current });
  };

  const draw = (L) => {
    overlay.innerHTML = '';
    overlay.append(h('div.row.gap-2', { style: { alignItems: 'center' } },
      h('span.spinner'),
      h('span.t-sm', null, 'Memuat peta…')
    ));

    try {
      map = L.map(el, { zoomControl: true, attributionControl: true }).setView([current.lat, current.lng], zoom);
    } catch {
      overlay.innerHTML = '';
      overlay.append(h('div.callout.callout--warn', null, icon('alert'), 'Peta tidak dapat ditampilkan.'));
      return;
    }

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIB }).addTo(map);

    if (radiusKm > 0) {
      circle = L.circle([current.lat, current.lng], {
        radius: radiusKm * 1000,
        color: '#2F4BFF',
        weight: 1.5,
        fillColor: '#2F4BFF',
        fillOpacity: 0.08,
      }).addTo(map);
    }

    marker = L.marker([current.lat, current.lng], {
      draggable: allowDrag,
      autoPan: true,
    }).addTo(map);

    marker.on('dragend', () => {
      const p = marker.getLatLng();
      current = { lat: p.lat, lng: p.lng };
      report();
    });

    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      current = { lat: e.latlng.lat, lng: e.latlng.lng };
      report();
    });

    overlay.remove();
    setTimeout(() => map.invalidateSize(), 120);
  };

  loadLeaflet()
    .then((L) => draw(L))
    .catch((err) => {
      overlay.innerHTML = '';
      overlay.append(h('div.callout.callout--warn', null, icon('alert'), err.message || 'Peta gagal dimuat.'));
    });

  return {
    el,
    /** Pindahkan titik (mis. setelah pengguna mengetik koordinat). */
    setPoint(nextLat, nextLng) {
      const la = Number(nextLat);
      const ln = Number(nextLng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      current = { lat: la, lng: ln };
      if (marker) marker.setLatLng([la, ln]);
      if (circle) circle.setLatLng([la, ln]);
      if (map) map.setView([la, ln], map.getZoom());
    },
    /** Ubah radius layanan (km). */
    setRadius(km) {
      if (!circle || !map) return;
      const L = window.L;
      if (!L) return;
      if (Number(km) > 0) {
        circle.setRadius(Number(km) * 1000);
        circle.setStyle({ opacity: 1, fillOpacity: 0.08 });
      } else {
        circle.remove();
        circle = L.circle([current.lat, current.lng], {
          radius: 1000,
          color: '#2F4BFF',
          weight: 1.5,
          fillColor: '#2F4BFF',
          fillOpacity: 0.08,
        }).addTo(map);
      }
    },
    destroy() {
      if (map) map.remove();
      map = null;
    },
  };
}

/** Jarak dalam km antara dua titik — helper tampilan. */
export function distanceLabel(lat1, lng1, lat2, lng2) {
  const km = haversineKm(lat1, lng1, lat2, lng2);
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
