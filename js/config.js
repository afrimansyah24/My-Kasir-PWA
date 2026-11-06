/**
 * My Kasir — konfigurasi runtime (frontend / PWA).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  HANYA isi GAS_URL di file ini. Spreadsheet TIDAK di sini.              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Mode demo (tanpa server):
 *   Biarkan GAS_URL kosong → data di localStorage perangkat.
 *
 * Mode produksi (Google Sheets):
 *   1. Spreadsheet — buat Google Sheet baru.
 *      Salin **ID** (bukan URL penuh) dari bilah alamat browser:
 *
 *        https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit
 *                                              └──────── ID ────────┘
 *
 *      Tempel ID itu di **Google Apps Script** (bukan di file ini):
 *      Project Settings (ikon roda gigi) → Script properties → Add property
 *      Name: SPREADSHEET_ID   Value: 1AbCdEfGhIjKlMnOpQrStUvWxYz
 *
 *   2. Web App URL — deploy backend `gas/Code.gs` sebagai Web App:
 *      Deploy → Manage deployments → ikon pensil / New deployment
 *      Type: Web app, Execute as: Me, Who has access: Anyone
 *      Salin **URL deployment** (harus berakhiran `/exec`, bukan `/dev`):
 *
 *        https://script.google.com/macros/s/AKfycb…/exec
 *
 *      Tempel URL itu ke GAS_URL di bawah.
 *
 * Kesalahan umum: menempel URL spreadsheet (`docs.google.com/spreadsheets/…`)
 * ke GAS_URL — aplikasi akan menunggu server yang tidak pernah menjawab.
 */

export const GAS_URL = 'https://script.google.com/macros/s/AKfycbxGGOG-qsWzG1Wl2fDUuKCjFv5evCORQmty7fN3qLImmJjiqP4H6XWqDHib7aIyq0iu7w/exec';

/** Token opsional untuk backend Apps Script. Kosongkan bila tidak dipakai. */
export const GAS_TOKEN = '';

/** URL Web App GAS valid untuk mode produksi. */
export function isGasConfigured() {
  const raw = String(GAS_URL || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const okHost =
      host === 'script.google.com' ||
      host.endsWith('.script.google.com') ||
      host === 'script.googleusercontent.com' ||
      host.endsWith('.script.googleusercontent.com');
    if (!okHost) return false;
    if (!u.pathname.includes('/macros/')) return false;
    return u.pathname.endsWith('/exec') || u.pathname.endsWith('/dev');
  } catch {
    return false;
  }
}

/**
 * Pesan singkat jika GAS_URL terisi tapi tidak valid (mis. URL spreadsheet).
 * Dipakai layar boot agar tidak “loading” tanpa akhir.
 */
export function gasConfigHint() {
  const raw = String(GAS_URL || '').trim();
  if (!raw) return null;
  if (isGasConfigured()) return null;

  const lower = raw.toLowerCase();
  if (lower.includes('spreadsheets') || lower.includes('/spreadsheets/d/')) {
    return (
      'GAS_URL berisi link Spreadsheet, bukan Web App. ' +
      'ID spreadsheet (bagian /d/…/edit) dimasukkan di Apps Script → Script properties ' +
      'dengan nama SPREADSHEET_ID. GAS_URL harus URL Deploy Web App (script.google.com/…/exec).'
    );
  }
  if (lower.includes('docs.google.com') && !lower.includes('script.google.com')) {
    return 'GAS_URL harus URL Web App Apps Script (…/macros/s/…/exec), bukan link Google Docs/Sheets.';
  }
  return 'GAS_URL tidak valid. Salin URL dari Apps Script → Deploy → Manage deployments (akhiran /exec).';
}
