/**
 * My Kasir — konfigurasi runtime.
 *
 * Kosongkan GAS_URL untuk tetap berjalan mode demo (localStorage).
 * Isi dengan URL Web App Apps Script untuk mode produksi:
 *
 *   https://script.google.com/macros/s/AKfycbXXXXXXXXXXXX/exec
 *
 * Perhatikan: URL harus berakhiran /exec (bukan /dev).
 */

export const GAS_URL = '';

/** Token opsional untuk backend Apps Script. Kosongkan bila tidak dipakai. */
export const GAS_TOKEN = '';

/** Bataskan GAS_URL ke host Google agar tidak menjadi vektor open-redirect. */
export function isGasConfigured() {
  if (!GAS_URL) return false;
  try {
    const u = new URL(GAS_URL);
    return u.hostname.endsWith('google.com') || u.hostname.endsWith('googleusercontent.com');
  } catch {
    return false;
  }
}
