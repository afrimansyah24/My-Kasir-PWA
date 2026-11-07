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
 * Koordinat valid?
 *
 * Sheet bisa berisi nilai rusak (mis. kolom koordinat terisi nomor lain
 * karena salah simpan, atau angka desimal yang terpotong). Leaflet akan
 * melempar error saat menerima koordinat di luar rentang bumi, jadi nilai
 * such dibuang lebih dulu.
 */
export function isValidLatLng(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la < -90 || la > 90) return false;
  if (ln < -180 || ln > 180) return false;
  return true;
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
    lat = null,
    lng = null,
    referencePoint = null,
    zoom = 14,
    radiusKm = 0,
    height = 340,
    allowDrag = true,
    onChange = null,
  } = opts;

  // Koordinat tak sah/kosong -> pakai titik tengah Indonesia sebagai titik
  // AWAL PETA SAJA (bukan lokasi toko yang disimpan).
  //
  // Titik awal ini hanya untuk menampilkan peta; begitu owner mengetuk peta,
  // koordinat sebenarnya tersimpan. Nilai ini tidak pernah ditulis ke
  // pengaturan sebagai lokasi toko.
  const fallbackLat = -6.9147;   // Bandung — hanya titik tengah peta
  const fallbackLng = 107.6098;
  const safeLat = isValidLatLng(lat, lng) ? Number(lat) : fallbackLat;
  const safeLng = isValidLatLng(lat, lng) ? Number(lng) : fallbackLng;
  // Apakah titik awal ini milik toko, atau hanya placeholder peta?
  const hasStorePoint = isValidLatLng(lat, lng);

  const el = h('div.map-picker', {
    style: { height: `${height}px`, position: 'relative', borderRadius: 'var(--r-lg)', overflow: 'hidden', border: '1px solid var(--line)' },
  });

  const overlay = h('div.map-picker__overlay');
  el.append(overlay);

  let map = null;
  let marker = null;
  let referenceMarker = null;
  let circle = null;
  let current = { lat: safeLat, lng: safeLng };

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

    // Titik acuan (lokasi toko) pada peta pelanggan: marker TETAP yang tidak
    // bisa digeser, diberi pin merah berlabel TOKO.
    //
    // Pada peta pengaturan owner tidak ada titik acuan — marker utama justru
    // adalah titik toko yang sedang disunting (lihat `isShopMarker` di
    // bawah). Dua pin tidak boleh menumpuk di koordinat yang sama: kalau
    // begitu, pin biru menutupi pin merah dan pemilik toko tidak pernah
    // melihat penanda tokonya.
    const shopIcon = L.divIcon({
      className: 'my-kasir-map-pin my-kasir-map-pin--store',
      html: '<span class="my-kasir-map-pin__dot"></span><span class="my-kasir-map-pin__label">TOKO</span>',
      iconSize: [58, 30],
      iconAnchor: [14, 15],
    });

    if (referencePoint && isValidLatLng(referencePoint.lat, referencePoint.lng)) {
      referenceMarker = L.marker([Number(referencePoint.lat), Number(referencePoint.lng)], {
        icon: shopIcon,
        draggable: false,
        keyboard: false,
        title: referencePoint.label || 'Lokasi toko',
        zIndexOffset: 500,
      }).addTo(map);
      if (referencePoint.label && referenceMarker.bindTooltip) {
        referenceMarker.bindTooltip(referencePoint.label, { direction: 'top', offset: [0, -8] });
      }
    }

    // PENTING: `icon` TIDAK BOLEH bernilai undefined.
    //
    // Leaflet memakai `Object.create(options.icon)` saat membuat marker. Bila
    // `icon` undefined, objek ikon yang diwarisi jadi undefined, sehingga
    // `createIcon()` melempar TypeError di tengah draw() -> peta gagal,
    // marker tidak muncul, dan handler klik tidak pernah terpasang.
    //
    // Peta pengaturan owner (tanpa referencePoint) adalah kasus itu.
    // Tanpa referencePoint (peta pengaturan owner) marker utama ADALAH titik
    // toko -> pakai pin merah berlabel TOKO. Dengan referencePoint (peta
    // pelanggan) marker utama adalah titik tujuan -> pin biru.
    const isShopMarker = !referencePoint;

    const destinationIcon = isShopMarker
      ? shopIcon
      : L.divIcon({
          className: 'my-kasir-map-pin my-kasir-map-pin--destination',
          html: '<span class="my-kasir-map-pin__dot"></span>',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

    marker = L.marker([current.lat, current.lng], {
      icon: destinationIcon,
      draggable: allowDrag,
      autoPan: true,
      title: referencePoint ? 'Lokasi pengantaran Anda' : 'Lokasi toko',
    }).addTo(map);

    // Mulai tepat di lokasi toko dari Spreadsheet. Jika kedua pin berimpit
    // saat pertama dibuka, gunakan zoom dekat agar toko & area sekitar terlihat;
    // setelah pelanggan memindahkan pin, tampilan mengikuti titik terdekat.
    if (referencePoint && isValidLatLng(referencePoint.lat, referencePoint.lng)) {
      const shop = { lat: Number(referencePoint.lat), lng: Number(referencePoint.lng) };
      const gapKm = haversineKm(shop.lat, shop.lng, current.lat, current.lng);
      if (Number.isFinite(gapKm) && gapKm < 0.05) {
        map.setView([shop.lat, shop.lng], Math.max(zoom, 15));
      } else if (map.fitBounds) {
        const bounds = L.latLngBounds(
          [shop.lat, shop.lng],
          [current.lat, current.lng]
        );
        map.fitBounds(bounds.pad(0.35), { maxZoom: zoom });
      }
    }

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

    // Bila lokasi toko belum pernah diatur, beri tahu pemilik agar tahu
    // koordinat yang terlihat hanyalah titik tengah peta.
    //
    // Petanya tetap diklikable (pointer-events: none pada hint), jadi owner
    // bisa langsung mengetuk peta untuk menetapkan lokasi.
    if (!hasStorePoint) {
      el.append(h('div.map-picker__hint', null,
        h('div.callout.callout--warn', null,
          icon('alert'),
          'Lokasi toko belum diatur. Ketuk peta atau isi latitude/longitude di bawah untuk menetapkan lokasi toko.'
        )
      ));
    }

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
      // Pandangan peta TIDAK ikut digeser saat koordinat diketik. Owner
      // mengetik latitude/longitude dan tiba-tiba pandangannya melompat —
      // membuat sukar membandingkan titik lama & baru. Tampilan mengikuti
      // titik HANYA bila titik itu keluar dari area pandang saat ini.
      if (map && map.getBounds) {
        const bounds = map.getBounds();
        if (bounds && !bounds.contains([la, ln])) {
          map.setView([la, ln], map.getZoom());
        }
      }
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
