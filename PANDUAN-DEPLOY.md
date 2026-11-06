# Panduan Deploy My Kasir (GitHub + Google Apps Script)

Dokumen ini menjelaskan **file mana yang di GitHub**, **file mana yang di Google Apps Script (GAS)**, dan **langkah instalasi** tanpa Cloudflare. Cocok untuk PWA `my-kasir-pwa` yang ada di folder ini.

---

## Ringkasan arsitektur

| Lapisan | Di mana di-host | Fungsi |
|--------|------------------|--------|
| **Frontend (PWA)** | **GitHub Pages** (HTTPS gratis) | Etalase, portal, antrean, QRIS di browser, service worker |
| **Backend (API)** | **Google Apps Script → Web App** | Baca/tulis Google Sheets, auth PIN, pesanan online, laporan |
| **Database** | **Google Spreadsheet** | Produk, transaksi, pesanan, antrean, pengaturan |
| **Gambar produk (produksi)** | **Google Drive** *(opsional, sesuai PRD)* | URL foto di sheet; folder `assets/products/` di GitHub cukup untuk demo |

```
Pelanggan / kasir (browser)
        │
        ▼
GitHub Pages  ──HTTPS──►  index.html + js/ + css/ …
        │
        │  fetch JSON (nanti)
        ▼
GAS Web App URL  ──►  Spreadsheet + Drive
```

**Mode saat ini:** aplikasi **wajib** memakai Google Spreadsheet sebagai satu-satunya sumber data. Tidak ada lagi mode demo / basis data lokal. `js/api.js` memakai `js/api.gas.js` (JSONP ke Web App Apps Script) dan data bisnis dibaca/tulis lewat Spreadsheet. Perangkat hanya menyimpan cache baca sementara + preferensi (tema, sesi login, keranjang).

---

## 1. Yang di-upload ke GitHub (repositori)

GitHub = **sumber kebenaran kode** + **hosting frontend** lewat GitHub Pages.

### 1.1 Wajib ada di repo (untuk Pages)

| Path | Keterangan |
|------|------------|
| `index.html` | Entry PWA |
| `manifest.webmanifest` | Install ke home screen |
| `sw.js` | Cache offline |
| `css/` | Semua stylesheet |
| `js/` | `app.js`, `api.js`, `store.js`, `views/`, dll. |
| `assets/products/` | Gambar demo WebP |
| `icons/` | Ikon PWA |
| `fonts/` | Font self-hosted |
| `vendor/` | Leaflet, Chart.js, QR libs |
| `README.md` | Dokumentasi singkat |
| `PANDUAN-DEPLOY.md` | File ini |
| `docs/screenshots/` | Opsional — dokumentasi UI |

### 1.2 Boleh di repo, tidak dipublish ke Pages

| Path | Alasan |
|------|--------|
| `gas/` | Backend untuk `clasp push`, bukan file statis Pages |
| `tools/` | Skrip Python generate aset (dev only) |
| `.github/workflows/` | CI clasp (opsional) |
| `docs/tmp/`, `.tmp-debug/` | Screenshot sementara — **jangan commit** |

> **Perubahan v1.8.0:** `js/store.js` dan `js/api.local.js` (mode demo) sudah
> **dihapus**. Hanya `js/api.gas.js` yang tersisa sebagai sumber data.

### 1.3 Contoh `.gitignore`

```gitignore
.tmp-debug/
docs/tmp/
tools/__pycache__/
*.pyc
.clasp.json
# Jangan commit token clasp — buat lokal saja
```

> **Catatan:** `.clasp.json` berisi ID project GAS — aman di repo **pribadi**; untuk repo publik pertimbangkan secret/ENV di CI saja.

---

## 2. Yang di-upload ke Google Apps Script

Isi folder **`gas/`** (setelah backend `.gs` dibuat) — **bukan** seluruh folder PWA.

### 2.1 File tipikal di project GAS

| File GAS | Isi |
|----------|-----|
| `appsscript.json` | Timezone, `webapp`, OAuth scopes (Spreadsheet, Drive, …) |
| `Code.gs` (atau pecahan) | `doGet`, `doPost`, routing `action`, CORS |
| Modul sheet | `setupDatabase`, baca/tulis baris per tab |

**Jangan** unggah ke GAS: `css/`, `js/` PWA, `sw.js`, `vendor/` — itu tetap di GitHub Pages.

### 2.2 Fungsi backend yang harus mirror `js/api.js`

Implementasi GAS harus mengembalikan JSON dengan **nama fungsi & bentuk respons** yang sama seperti di `js/api.js` (lihat komentar di bagian atas file itu). Minimal untuk produksi:

| Publik | Portal / admin |
|--------|----------------|
| `getPublicCatalogData` | `verifyPortalPin`, `login` |
| `createOnlineOrder` | `getDashboardData`, `getReport` |
| `payOrder`, `trackOrder` | `getProducts`, `saveProductRecord`, … |
| `cancelExpiredOnlineOrders` | `saveSettings`, `setupDatabase` |
| | `getQueue`, `setQueueEntryStatus`, … |

**POS offline di portal** saat ini menulis lewat `cart.js` → `store.js` langsung. Saat backend hidup, tambahkan endpoint mis. `saveTransaction` di GAS dan panggil dari `cart.js` / `api.js`.

### 2.3 Spreadsheet

1. Buat Spreadsheet baru (mis. "My Kasir DB").
2. Simpan **Spreadsheet ID** di Properties Service GAS (`ScriptProperties`).
3. Setelah deploy, buka **Portal → Pengaturan → Setup database** (memanggil `setupDatabase()`).

Tab yang disiapkan (sesuai demo): Settings, Categories, Products, Users, Transactions, OnlineOrders, Queue.

### 2.4 Mode server: mengaktifkan & mempercepat

**Aktifkan server.** Ada dua cara (yang kedua lebih mudah):

| Cara | Langkah |
|------|---------|
| Edit berkas | `js/config.js` → isi `GAS_URL` dengan URL Web App (`…/exec`) |
| Lewat UI | **Portal → Pengaturan → Data → "Hubungkan Google Spreadsheet"** → tempel URL → **Simpan & hubungkan** |

> **Catatan service worker.** `js/config.js` pernah tersaji basi dari cache sehingga
> aplikasi tetap berjalan di mode demo walau server sudah aktif. Sekarang
> `config.js` selalu diambil dari jaringan (lihat `sw.js`), dan badge
> **Server aktif / Mode demo** di Pengaturan → Data menunjukkan mode yang
> benar-benar dipakai.

**Kenapa sebelumnya lambat, dan apa yang berubah:**

| Sebab | Perbaikan |
|-------|-----------|
| Setiap permintaan = 1 eksekusi Apps Script (2–3 detik) | Permintaan yang muncul bersamaan digabung jadi **satu** aksi `getPortalBundle` |
| Dashboard membaca sheet `Transactions` 5× | Cache baca di server (TTL 5 detik) + bundle |
| Cache lama "menunggu" 20 detik tanpa pembaruan | **Stale-while-revalidate**: data lama langsung tampil, diperbarui di belakang layar |
| `cancelExpiredOnlineOrders` tiap 60 detik | Setiap 5 menit, dan hanya saat tab terlihat |

**Cache berlapis di sisi peramban (v1.7.0):**

| Lapisan | Isi | Lama hidup |
|---------|-----|------------|
| **L1** | cache memori di tabbrowser | TTL pendek per aksi |
| **L2** | snapshot `localStorage` (`mykasir.cache.v1`) | bertahan setelah tab ditutup |

- Data L2 yang sudah basi **langsung ditampilkan**, lalu diperbarui di latar belakang.
- **Revalidasi otomatis**: katalog, pengaturan, dashboard, transaksi, kategori, produk.
- **Jaringan gagal** → snapshot lama tetap tampil (bukan halaman kosong).
- Tombol **Segarkan** (ikon ↻) memaksa baca **langsung ke server** selama 5 detik,
  sehingga hasil yang tampil benar-benar data terbaru.
- Halaman yang gagal dimuat tidak lagi menggantung: setelah 12 detik muncul
  tombol *Coba lagi* + *Bersihkan cache*.

**Catatan:** snapshot L2 sengaja tidak dihapus total saat ada penulisan — ia
dipertahankan sebagai cadangan agar layar berikutnya tetap tampil seketika,
serta ditandai *basi* agar revalidasi ke server pasti dijalankan. Entri
`getSettings` justru dihapus agar hasil “Simpan” selalu dibaca ulang dari
server.

**Langkah wajib setelah memperbarui backend:** `gas/Code.gs` versi baru menambah
aksi `getPortalBundle` + cache..apps Script harus **di-deploy ulang**:

```
Apps Script → Deploy → Manage deployments → ikon pensil (Edit) →
Version: New version → Deploy
```

Tanpa deploy ulang, aplikasi tetap jalan (otomatis fallback ke permintaan
biasa), hanya belum mendapat kecepatan penuh.

**Data tetap real time.** Halaman **Pesanan Online** melakukan polling tiap 12
detik (berhenti saat tab disembunyikan) sehingga pesanan baru dari pelanggan
langsung terlihat.

---

## 3. Instalasi langkah demi langkah (tanpa Cloudflare)

### Tahap A — Frontend di GitHub Pages

1. **Buat repositori** di GitHub (mis. `my-kasir-pwa`).
2. **Push** isi folder proyek (kecuali `.tmp-debug/`, `docs/tmp/`):

   ```bash
   cd my-kasir-pwa
   git init
   git add index.html manifest.webmanifest sw.js css js assets icons fonts vendor README.md PANDUAN-DEPLOY.md docs/screenshots
   git add gas/   # jika sudah ada backend
   git commit -m "Initial My Kasir PWA"
   git branch -M main
   git remote add origin git@github.com:USERNAME/my-kasir-pwa.git
   git push -u origin main
   ```

3. Di GitHub: **Settings → Pages**.
   - Source: **Deploy from a branch**
   - Branch: `main` / folder **`/ (root)`**
   - Save.
4. Tunggu URL: `https://USERNAME.github.io/my-kasir-pwa/`
5. Buka URL tersebut (bukan `file://`). Uji etalase dan **Install PWA** dari browser.
6. Setiap rilis, **naikkan** string cache di `sw.js` (mis. `mykasir-v2`) agar pengguna dapat versi baru.

**Alternatif hosting statis (tanpa Cloudflare):** Firebase Hosting, Netlify, VPS + nginx — prinsipnya sama: unggah folder frontend, wajib **HTTPS**.

---

### Tahap B — Backend di Google Apps Script (manual, tanpa GitHub Actions)

Cocok jika Anda **tidak** memakai Cloudflare **dan** belum memakai CI.

1. Buka [script.google.com](https://script.google.com) → **New project**.
2. **Salin/tempel** isi file dari folder `gas/` (`.gs` + `appsscript.json` via **Project settings → appsscript.json** di editor).
3. **Services / Advanced Google services:** aktifkan **Google Sheets API** jika diperlukan script.
4. **Project Settings → Script properties:**
   - `SPREADSHEET_ID` = ID spreadsheet Anda.
5. **Deploy → New deployment → Type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** *(agar PWA di GitHub Pages bisa memanggil API)*
6. Salin **URL Web App** (bentuk `https://script.google.com/macros/s/...../exec`).
7. Update **`js/api.js`**: ganti implementasi localStorage dengan `fetch` ke URL tersebut, contoh pola:

   ```javascript
   const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';

   async function gas(action, payload = {}) {
     const res = await fetch(GAS_URL, {
       method: 'POST',
       headers: { 'Content-Type': 'text/plain;charset=utf-8' },
       body: JSON.stringify({ action, ...payload }),
     });
     return res.json();
   }

   export async function getPublicCatalogData() {
     return gas('getPublicCatalogData');
   }
   ```

   Di `Code.gs`, `doPost(e)` parse `JSON.parse(e.postData.contents)`, `switch (action)`, return `ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)` plus header CORS jika perlu.

8. **Commit & push** perubahan `js/api.js` ke GitHub → Pages otomatis ter-update.

**PIN demo (localStorage):** `2580` — ganti di sheet Settings / Portal setelah backend aktif.

---

### Tahap C — Backend via clasp (opsional, tetap tanpa Cloudflare)

Jika ingin edit backend di VS Code lalu sync ke GAS:

```bash
npm install -g @google/clasp
clasp login
clasp create --type standalone --title "My Kasir API"
# atau: clasp clone <SCRIPT_ID>
# salin isi gas/ ke root clasp
clasp push
clasp deploy --description "Production"
```

GitHub Actions + `clasp` **tidak wajib**; Cloudflare **tidak dipakai** di alur ini.

---

## 4. Checklist setelah go-live

- [ ] GitHub Pages HTTPS terbuka, PWA ter-install di HP
- [ ] Web App GAS deployed "Anyone", URL diset di `api.js`
- [ ] `setupDatabase()` dijalankan sekali
- [ ] Ganti PIN portal & password user default
- [ ] Uji: pesanan online → antrean → bayar QRIS (simulasi) → lacak kode
- [ ] Uji portal: POS, dashboard, stok
- [ ] Bump versi `sw.js` setiap deploy frontend

---

## 5. Troubleshooting singkat

| Gejala | Penyebab umum | Solusi |
|--------|----------------|--------|
| Layar putih / module error | Buka lewat `file://` | Pakai GitHub Pages atau `python3 -m http.server` |
| API gagal dari Pages | CORS / deployment GAS | Web app "Anyone"; `doPost` return JSON + CORS |
| Data tidak sinkron | Spreadsheet salah / cache basi | **Portal → Segarkan** (ikon ↻) atau **Pengaturan → Data → Bersihkan cache** |
| "Backend GAS belum dikonfigurasi" | `GAS_URL` kosong/tidak valid | Isi URL Web App `/exec` di `js/config.js` atau lewat UI |
| Halaman lama masih muncul | Cache service worker | Naikkan `mykasir-v*` di `sw.js`, hard refresh |
| Font/icon rusak | MIME type | Pages biasanya OK; VPS perlu `.woff2` & `.webmanifest` benar |

---

## 6. Referensi cepat

- **Wajib backend:** GitHub Pages (frontend) + GAS Web App (backend) + Spreadsheet (+ Drive untuk foto).
- Tidak ada lagi mode tanpa server — data toko hanya bisa di-host di Spreadsheet.
- PRD lengkap: `PRD-My-Kasir-Revisi.md` (strategi clasp + GitHub sebagai sumber kebenaran).

---

*Terakhir diselaraskan dengan struktur proyek `my-kasir-pwa` (PWA vanilla ES modules, folder `gas/` siap diisi backend GAS).*

---

## 7. Ringkasan rilis

### v1.8.0 — full Spreadsheet (mode demo dihapus)

- **Seluruh data bisnis ada di Google Spreadsheet**: produk, kategori, transaksi,
  pesanan online, antrean, pengguna, pengaturan.
- `js/store.js` (skema + seed lokal) dan `js/api.local.js` (mode demo)
  **dihapus**; `js/api.js` kini khusus GAS.
- Transaksi POS **selalu** divalidasi & dicatat di server (stok dipotong di
  Spreadsheet), bukan di perangkat.
- Portal → Pengaturan → Data punya panel baru **“Data di perangkat ini”**:
  tombol *Bersihkan cache baca* dan *Hapus semua data perangkat*.
- Label “Mode demo” di UI dihapus; status server kini selalu “Server aktif”.

### v1.7.0 — kecepatan muat & Kebersahan Pengaturan

- Halaman tidak lagi menggantung di “Memuat…” (failsafe + tombol coba lagi).
- Katalog tampil instan dari snapshot lokal, diperbarui di belakang layar.
- Pengaturan memakai **draf + tombol Simpan**; ada stempel “terakhir disimpan”
  dan tombol Batalkan.
- Etalase bisa dikunci lewat fitur **Pesanan Online**.
- Header toko & portal rapi di **portrait** maupun **landscape**.
