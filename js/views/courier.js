/* My Kasir — portal kurir.
 *
 * Layar khusus kurir: bukan dasbor, tapi "tugas jalan". Satu pesanan aktif
 * jadi fokus, aksi satu sentuhan, dan tautan tujuan/pelanggan yang besar
 * karena dipakai sambil di jalan (jarip, satu tangan, layar kotor).
 *
 * Isi:
 *   - daftar pesanan yang ditugaskan ke akun kurir ini
 *   - nama pelanggan, alamat (link Google Maps), nomor (link WhatsApp)
 *   - penanda status: diantar -> selesai (tidak perlu kasir)
 *   - COD: delivery + Cash -> tagih di lokasi, bayar dicatat saat selesai
 */

import {
  h, icon, toast, rupiah, fmtDateTime, relTime, emptyState, confirmDialog,
  whatsappHref, mapsHref,
} from '../util.js';
import * as api from '../api.js';

/** Status pesanan yang masih punya pekerjaan bagi kurir. */
const ACTIVE_STATUSES = ['preparing', 'ready', 'delivering'];

/**
 * Status "selesai diantar".
 *
 * PENTING: bukan 'ready'. Untuk delivery, 'ready' berarti "siap diantar"
 * (barang sudah dikemas, kurir belum datang). Status akhir delivery
 * dipisah agar tidak tertukar — kalau sama, COD bisa tercatat saat pesanan
 * baru saja ditandai siap, bukan saat benar-benar sampai.
 */
const DONE_STATUS = 'delivered';

const STATUS_LABEL = {
  pending: 'Menunggu bayar',
  paid: 'Terbayar',
  preparing: 'Disiapkan toko',
  ready: 'Siap diantar',
  delivering: 'Sedang diantar',
  delivered: 'Selesai',
  cancelled: 'Batal',
};

/**
 * Tampilan kurir.
 *
 * @param {object} courier - { id, name, username, phone } dari sesi portal.
 */
export async function courierView(courier) {
  const host = h('div.courier');
  const listHost = h('div');

  let orders = [];
  let pollTimer = null;

  const isCod = (o) => o.payment === 'Cash' && o.fulfilment === 'delivery';

  /** Pesanan yang masih aktif (belum selesai & belum batal). */
  const active = () => orders.filter(
    (o) => ACTIVE_STATUSES.includes(o.status) && o.status !== DONE_STATUS
  );

  /** Pesanan yang sudah selesai — tetap ditampilkan sebagai riwayat. */
  const done = () => orders.filter((o) => o.status === DONE_STATUS);

  /**
   * Kartu satu pesanan.
   *
   * Elemen penting (alamat & telepon) dibuat besar dan bisa diklik langsung:
   * kurir membukanya sambilavigate, jadi tidak boleh berupa teks kecil.
   */
  const orderCard = (o) => {
    const gmap = mapsHref(o.lat, o.lng, o.address);
    const wa = whatsappHref(
      o.phone,
      `Halo ${o.customer || 'Pelanggan'}, saya kurir ${courier?.name || ''} dari ${''}toko. Pesanan ${o.code} sedang saya antar.`
    );
    const cod = isCod(o);

    const statusBadge = o.status === 'delivering'
      ? h('span.badge.badge--info', null, 'Sedang diantar')
      : o.status === DONE_STATUS
        ? h('span.badge.badge--ok', null, 'Selesai')
        : h('span.badge.badge--warn', null, 'Disiapkan toko');

    const actions = [];
    const isDone = o.status === DONE_STATUS;
    const isDelivering = o.status === 'delivering';
    const canStart = ACTIVE_STATUSES.includes(o.status) && !isDone && !isDelivering;

    if (isDone) {
      actions.push(
        h('div.callout.callout--ok', null,
          icon('checkCircle'),
          cod ? 'Pesanan selesai — pembayaran COD sudah dicatat.' : 'Pesanan selesai diantar.'
        )
      );
    } else if (isDelivering) {
      actions.push(
        h('button.btn.btn--primary.btn--lg.btn--block', {
          onclick: () => markDone(o),
        }, icon('checkCircle'), 'Pesanan selesai & uang diterima')
      );
    } else if (canStart) {
      actions.push(
        h('div.callout.callout--warn', null,
          icon('clock'),
          o.status === 'ready'
            ? 'Pesanan siap diantar — tekan "Mulai antar" saat barang diambil.'
            : 'Toko sedang menyiapkan pesanan. Tunggu sampai kasir menandai siap.'
        ),
        h('button.btn.btn--primary.btn--lg.btn--block', {
          onclick: () => startDelivering(o),
        }, icon('truck'), 'Mulai antar')
      );
    }

    return h('div.courier__card', null,
      h('div.courier__card-top', null,
        h('div', null,
          h('div.courier__code', null, o.code),
          h('div.t-xs', null, fmtDateTime(o.ts))
        ),
        statusBadge
      ),

      // --- tujuan: nama, alamat, peta -----------------------------------
      h('div.courier__block', null,
        h('div.courier__label', null, 'Antar ke'),
        h('div.courier__name', null, o.customer || 'Pelanggan tanpa nama'),
        o.address
          ? h('div.courier__addr', null, o.address)
          : h('div.t-xs', null, 'Alamat tidak diisi — hubungi pelanggan'),
        h('div.courier__links', null,
          gmap
            ? h('a.btn.btn--soft.btn--block', {
              href: gmap, target: '_blank', rel: 'noopener noreferrer',
            }, icon('pin'), 'Buka di Google Maps')
            : null,
          wa
            ? h('a.btn.btn--soft.btn--block', {
              href: wa, target: '_blank', rel: 'noopener noreferrer',
            }, icon('phone'), `WhatsApp ${o.customer || 'pelanggan'}`)
            : null
        )
      ),

      // --- barang ---------------------------------------------------------
      h('div.courier__block', null,
        h('div.courier__label', null, 'Barang'),
        h('div.courier__items', null,
          o.items.map((it) =>
            h('div.courier__item', null,
              h('span.courier__qty', null, `${it.qty}×`),
              h('span.grow', null, it.name)
            )
          )
        ),
        o.note
          ? h('div.courier__note', null, icon('info'), o.note)
          : null
      ),

      // --- uang ------------------------------------------------------------
      h('div.courier__block.courier__block--money', null,
        h('div', null,
          h('div.courier__label', null, cod ? 'Tagih di lokasi (COD)' : 'Sudah dibayar QRIS'),
          h('div.courier__total', null, rupiah(o.total))
        ),
        cod
          ? h('span.badge.badge--warn', null, 'COD')
          : h('span.badge.badge--ok', null, 'Lunas')
      ),

      h('div.courier__actions', null, actions)
    );
  };

  const startDelivering = async (o) => {
    const res = await api.setOrderStatus(o.code, 'delivering');
    if (!res || res.ok === false) {
      toast(res?.error || 'Gagal memperbarui status', 'err');
      return;
    }
    toast(`Pesanan ${o.code} sedang diantar`, 'ok');
    refresh();
  };

  const markDone = async (o) => {
    const cod = isCod(o);
    const ok = await confirmDialog({
      title: 'Pesanan selesai?',
      body: cod
        ? `Pastikan uang ${rupiah(o.total)} sudah diterima dari ${o.customer || 'pelanggan'}. Pembayaran dicatat saat pesanan ditandai selesai.`
        : `Pesanan ${o.code} sudah diserahkan ke ${o.customer || 'pelanggan'}?`,
      confirmLabel: 'Sudah, selesai',
      danger: false,
    });
    if (!ok) return;

    const res = await api.setOrderStatus(o.code, DONE_STATUS);
    if (!res || res.ok === false) {
      toast(res?.error || 'Gagal memperbarui status', 'err');
      return;
    }
    toast(cod ? `Pembayaran ${rupiah(o.total)} tercatat` : `Pesanan ${o.code} selesai`, 'ok');
    refresh();
  };

  const render = () => {
    listHost.innerHTML = '';
    const todo = active();
    const history = done();

    if (!orders.length) {
      listHost.append(
        emptyState(
          'truck',
          'Belum ada tugas',
          'Kasir akan menugaskan pesanan ke akun ini. Buka aplikasi ini lagi setelah menerima tugas.'
        )
      );
      return;
    }

    if (todo.length) {
      listHost.append(
        h('div.courier__section-label', null, `Perlu diantar (${todo.length})`),
        ...todo.map(orderCard)
      );
    } else {
      listHost.append(
        h('div.callout.callout--ok', null,
          icon('checkCircle'),
          'Semua tugas selesai. Pesanan baru akan muncul di sini secara otomatis.'
        )
      );
    }

    if (history.length) {
      listHost.append(
        h('div.courier__section-label', null, `Sudah selesai (${history.length})`),
        ...history.map(orderCard)
      );
    }
  };

  const refresh = async () => {
    try {
      const res = await api.getCourierOrders(courier?.id);
      const list = Array.isArray(res) ? res : (res?.orders || []);
      orders = list.filter((o) => o.fulfilment === 'delivery');
      render();
    } catch (err) {
      toast(err.message || 'Gagal memuat tugas', 'err');
    }
  };

  host.append(
    h('div.courier__header', null,
      h('div.grow', null,
        h('div.courier__hello', null, 'Tugas pengantaran'),
        h('div.t-sm', null, `${courier?.name || 'Kurir'} · ${orders.length} pesanan`)
      ),
      h('button.btn.btn--icon.btn--ghost', {
        'aria-label': 'Segarkan',
        title: 'Segarkan tugas',
        onclick: () => refresh(),
      }, icon('refresh'))
    ),
    listHost
  );

  render();
  await refresh();

  // Polling ringan: pesanan baru & perubahan status masuk tanpa perlu reload.
  // Berhenti saat tab disembunyikan supaya tidak membebani Apps Script.
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    refresh();
  }, 15_000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });

  return host;
}

/** Berhenti polling (dipanggil saat portal ditutup). */
export function stopCourierPolling() {
  // Polling dihentikan oleh portal; fungsi ini kept sebagai titik jeda bila
  // nanti diperlukan.
}
