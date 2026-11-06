# My Kasir — PWA Etalase & Point of Sale

Aplikasi web progresif (**PWA**) untuk etalase publik, kasir POS, dashboard pemilik, antrean layar, dan pelacakan pesanan. Layout otomatis menyesuaikan **desktop/lanscape** (grid lebar, sidebar portal) dan **ponsel/portrait** (nav bawah, chip kategori, drawer keranjang).

## Fitur utama

| Area | Rute | Isi |
|------|------|-----|
| Etalase | `/`, `/belanja` | Katalog, pencarian, keranjang, checkout pickup/antar, QRIS dinamis, lacak pesanan |
| Lacak | `/lacak`, `/lacak/:kode` | Status pesanan dengan stepper |
| Portal internal | `/portal` | Gate PIN → POS, dashboard, pesanan online, antrean, produk, laporan, transaksi, pengguna, pengaturan |
| Layar antrean | `/antrean` | Nomor antrean fullscreen + bell + TTS (Web Speech) |

## Sumber data: Google Spreadsheet

Seluruh data aplikasi — produk, kategori, transaksi, pesanan online, antrean,
pengguna, dan pengaturan — berada di **Google Spreadsheet**, diakses lewat
**Google Apps Script Web App** (`/exec`). Tidak ada basis data lokal.

Perangkat hanya menyimpan:
- **cache baca** (`mykasir.cache.v1`) — salinan sementara supaya halaman tampil
  instan tanpa menunggu Apps Script (±2 detik); isinya selalu diambil ulang dari
  server,
- **preferensi** — tema, sesi login, dan keranjang yang sedang berjalan.

Keduanya bisa dibersihkan kapan saja dari **Portal → Pengaturan → Data**.

> **PIN portal awal:** `2580` (ubah lewat **Portal → Pengaturan**).

### Menjalankan secara lokal

```bash
cd my-kasir-pwa
python3 -m http.server 8080
# Buka http://localhost:8080
```

> Wajib dilayani lewat HTTP(S), bukan `file://`, agar service worker dan ES modules berjalan.
> Aplikasi tetap membutuhkan backend Apps Script yang sudah ter-deploy.

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
│   ├── api.js    # API facade (Google Apps Script)
│   ├── api.gas.js# implementasi GAS: JSONP + cache berlapis
│   ├── qr.js     # generator QR ISO 18004 (CRC16 + Reed–Solomon)
│   ├── charts.js # grafik SVG (area, bar, donut, heatmap)
│   ├── cart.js   # keranjang & struk termal 80mm
│   └── views/    # storefront, portal, queue
├── gas/          # backend Google Apps Script (Code.gs)
├── assets/products/  # ilustrasi produk WebP
├── icons/            # ikon PWA
├── fonts/            # Plus Jakarta Sans, JetBrains Mono
├── vendor/           # Leaflet (peta pengaturan)
└── docs/screenshots/ # cuplikan UI (17 layar)
```

## Pengaturan bisnis

Di **Portal → Pengaturan** Anda dapat mengubah nama toko, istilah (bukan hardcoded F&B), koordinat peta (Leaflet/OSM), template QRIS, dan PIN portal. QRIS checkout membangun payload EMV TLV + **CRC16-CCITT** di klien (`js/qr.js`).

### QRIS dinamis

Backend dapat meminta QR ke acquiring bank (Xendit, Midtrans, atau gateway
sendiri) sehingga **nominal terkunci di dalam QR** dan status pembayaran masuk
otomatis lewat webhook. Bila gateway tidak aktif, aplikasi jatuh ke QRIS
statis. Panduan lengkap: **`TUTORIAL-QRIS-DINAMIS.md`**.

## Keamanan portal

Sesi portal hanya hidup di memori tab: **setiap kali `/portal` dibuka, PIN 6
digit diminta lagi**, dan me-refresh/menutup tab mengakhiri sesi.

## Screenshot

Pratinjau lengkap ada di folder `docs/screenshots/` (01–17): etalase, keranjang, checkout, antrean, portal PIN, dashboard, POS, dan modul admin.

## Produksi

1. Deploy folder statis ke hosting HTTPS (Netlify, Cloudflare Pages, Firebase Hosting, nginx, dll.).
2. Pastikan `Content-Type` benar untuk `.webmanifest` dan `.woff2`.
3. Deploy `gas/Code.gs` sebagai Web App (`/exec`) dan isi `SPREADSHEET_ID` di Apps Script → Script properties. Jalankan **setupDatabase()** sekali lewat Portal → Pengaturan → Data.
4. Bump versi cache di `sw.js` (`mykasir-v*`) setiap rilis agar klien memperbarui aset.

## Lisensi & aset

Font self-hosted; peta © OpenStreetMap contributors; kode aplikasi vanilla ES modules tanpa framework UI.
