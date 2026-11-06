/* My Kasir — public queue display.
 *
 * Mounted at /antrean. Shows order numbers for customers waiting in the
 * store, announces newly-ready orders, and needs no login beyond the
 * portal PIN that opens it.
 */

import { h, icon, toast, emptyState } from '../util.js';
import * as api from '../api.js';
import * as store from '../store.js';

export function mountQueueScreen(view) {
  const host = h('div.queue-screen');
  const settings = store.settings();
  let soundOn = true;

  const head = h('div.queue-screen__head', null,
    h('div', null,
      h('div.t-eyebrow.t-cobalt', null, h('span.dot.dot--live'), 'Layar antrean'),
      h('h1.queue-screen__title.mt-2', null, settings.storeName || 'Antrean'),
      h('div.t-body.mt-2', null, 'Nomor pesanan yang siap diambil akan tampil di layar ini.')
    ),
    h('div.row.gap-2', null,
      h('button.btn.btn--ghost.btn--icon', {
        'aria-label': 'Suara',
        title: 'Suara pengumuman',
        onclick: (e) => {
          soundOn = !soundOn;
          e.currentTarget.innerHTML = '';
          e.currentTarget.append(icon(soundOn ? 'sound' : 'mute'));
          toast(soundOn ? 'Suara pengumuman aktif' : 'Suara dimatikan', 'info', 1500);
        },
      }, icon('sound')),
      h('a.btn.btn--ghost', { href: '/' }, icon('store'), 'Toko')
    )
  );

  const grid = h('div.queue-grid');
  const emptyHost = h('div');

  const speak = (text) => {
    if (!soundOn || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'id-ID';
      u.rate = 0.95;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  };

  const render = (entries) => {
    grid.innerHTML = '';
    emptyHost.innerHTML = '';

    if (!entries.length) {
      emptyHost.append(emptyState('list', 'Belum ada antrean', 'Nomor pesanan akan muncul di sini secara otomatis.'));
      return;
    }

    const ready = entries.filter((e) => e.status === 'ready');
    const others = entries.filter((e) => e.status !== 'ready');

    for (const e of ready) {
      grid.append(
        h('div.qcard.qcard--ready', null,
          h('div.qcard__num', null, String(e.number)),
          h('div.qcard__label', null, 'Siap Diambil'),
          h('div.qcard__meta', null, e.code || '')
        )
      );
    }

    for (const e of others) {
      grid.append(
        h('div.qcard.qcard--processing', null,
          h('div.qcard__num', null, String(e.number)),
          h('div.qcard__label', null, e.status === 'processing' ? 'Sedang Diproses' : 'Menunggu'),
          h('div.qcard__meta', null, e.code || '')
        )
      );
    }
  };

  let lastReady = new Set();

  const tick = async () => {
    try {
      const entries = await api.getQueue();
      render(entries);
      const nowReady = new Set(entries.filter((e) => e.status === 'ready').map((e) => e.number));
      for (const n of nowReady) {
        if (!lastReady.has(n)) speak(`Nomor ${n}, pesanan Anda siap diambil`);
      }
      lastReady = nowReady;
    } catch (err) {
      console.warn('Gagal memperbarui antrean', err);
    }
  };

  host.append(head, grid, emptyHost);
  view.append(host);

  tick();
  const timer = setInterval(tick, 5000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
}
