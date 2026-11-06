# My Kasir — PWA Etalase & Point of Sale

Aplikasi web progresif (**PWA**) untuk etalase publik, kasir POS, dashboard pemilik, antrean layar, dan pelacakan pesanan. Layout otomatis menyesuaikan **desktop/lanscape** (grid lebar, sidebar portal) dan **ponsel/portrait** (nav bawah, chip kategori, drawer keranjang).

## Fitur utama

| Area | Rute | Isi |
|------|------|-----|
| Etalase | `/`, `/belanja` | Katalog, pencarian, keranjang, checkout pickup/antar, QRIS dinamis, lacak pesanan |
| Lacak | `/lacak`, `/lacak/:kode` | Status pesanan dengan stepper |
| Portal internal | `/portal` | Gate PIN → POS, dashboard, pesanan online, antrean, produk, laporan, transaksi, pengguna, pengaturan |
| Layar antrean | `/antrean` | Nomor antrean fullscreen + bell + TTS (Web Speech) |

## Demo lokal

Data disimpan di **localStorage** (mode demo). Backend Google Apps Script dapat dihubungkan lewat `js/api.js` (facade sudah mengikuti bentuk respons GAS).

**PIN portal demo:** `2580`

```bash
cd my-kasir-pwa
python3 -m http.server 8080
# Buka http://localhost:8080
```

> Wajib dilayani lewat HTTP(S), bukan `file://`, agar service worker dan ES modules berjalan.

## Instalasi PWA

1. Buka situs di Chrome / Edge / Safari (Android/iOS).
2. Pilih **Install** / **Add to Home Screen** saat prompt muncul, atau dari menu browser.
3. `manifest.webmanifest` + `sw.js` meng-cache shell, font, ikon, dan tile peta (Leaflet).

## Struktur proyek

```
my-kasir-pwa/
├── index.html
├── manifest.webmanifest
├── sw.js
├── css/          # design system (aurora, glass, layout responsif)
├── js/
│   ├── app.js    # router & PWA bootstrap
│   ├── store.js  # skema data + seed demo
│   ├── api.js    # API facade
│   ├── qr.js     # generator QR ISO 18004 (CRC16 + Reed–Solomon)
│   ├── charts.js # grafik SVG (area, bar, donut, heatmap)
│   ├── cart.js   # keranjang & struk termal 80mm
│   └── views/    # storefront, portal, queue
├── assets/products/  # ilustrasi produk WebP
├── icons/            # ikon PWA
├── fonts/            # Plus Jakarta Sans, JetBrains Mono
├── vendor/           # Leaflet (peta pengaturan)
└── docs/screenshots/ # cuplikan UI (17 layar)
```

## Pengaturan bisnis

Di **Portal → Pengaturan** Anda dapat mengubah nama toko, istilah (bukan hardcoded F&B), koordinat peta (Leaflet/OSM), template QRIS, dan PIN portal. QRIS checkout membangun payload EMV TLV + **CRC16-CCITT** di klien (`js/qr.js`).

## Screenshot

Pratinjau lengkap ada di folder `docs/screenshots/` (01–17): etalase, keranjang, checkout, antrean, portal PIN, dashboard, POS, dan modul admin.

## Produksi

1. Deploy folder statis ke hosting HTTPS (Netlify, Cloudflare Pages, Firebase Hosting, nginx, dll.).
2. Pastikan `Content-Type` benar untuk `.webmanifest` dan `.woff2`.
3. Ganti endpoint GAS di `js/api.js` bila backend siap; seed demo dapat di-reset lewat **Setup database** di portal.
4. Bump versi cache di `sw.js` (`mykasir-v*`) setiap rilis agar klien memperbarui aset.

## Lisensi & aset

Font self-hosted; peta © OpenStreetMap contributors; kode aplikasi vanilla ES modules tanpa framework UI.
