/* My Kasir — internal portal.
 *
 * Three roles share one shell:
 *   Owner  — everything a cashier can do, plus dashboard, CRUD and settings
 *   Kasir  — POS, payments, receipts, stock, queue, online orders, reports
 *   Antrean — a PIN-only queue display, no login
 */

import {
  $, h, icon, iconSvg, toast, rupiah, esc, debounce, fmtDate, fmtTime,
  fmtDateTime, relTime, initials, modal, confirmDialog, emptyState, copyText,
  fileToDataUrl, numberShort,
} from '../util.js';
import * as api from '../api.js';
import { settings, refreshSettings } from '../settings.js';
import * as cart from '../cart.js';
import { areaChart, barChart, hBarChart, donutChart, sparkline, legend, ringChart, heatMap } from '../charts.js';
import { go, withBase, toggleTheme, currentTheme } from '../app.js';
import { mountQueueScreen } from './queue.js';

const ROLE_KEY = 'mykasir.role';

let session = null; // { role, name }

export function getSession() {
  return session;
}

/* -------------------------------------------------------------------------
   PIN gate
   ---------------------------------------------------------------------- */

export function mountPortal(view, params = []) {
  const sub = params[0] || '';

  if (sub === 'antrean' || sub === 'queue') {
    mountQueueScreen(view);
    return;
  }

  if (!session) {
    view.append(pinGate());
    return;
  }

  view.append(portalShell(sub));
}

function pinGate() {
  let pin = '';
  const host = h('div.gate');
  const dots = h('div.pin-display');
  const error = h('div.gate__error');

  const renderDots = () => {
    dots.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      dots.append(h('div', { class: `pin-dot ${i < pin.length ? 'is-filled' : ''}` }));
    }
  };

  const press = async (d) => {
    if (pin.length >= 4) return;
    pin += d;
    renderDots();
    error.textContent = '';

    if (pin.length === 4) {
      const res = await api.verifyPortalPin(pin);
      if (res.ok) {
        session = { role: 'owner', name: 'Owner' };
        try { sessionStorage.setItem(ROLE_KEY, JSON.stringify(session)); } catch { /* ignore */ }
        const host = document.getElementById('app');
        host.innerHTML = '';
        host.append(portalShell(''));
        toast('Selamat datang kembali', 'ok');
      } else {
        error.textContent = res.error || 'PIN salah';
        pin = '';
        renderDots();
        setTimeout(() => { error.textContent = ''; }, 2200);
      }
    }
  };

  const back = () => {
    if (pin.length) {
      pin = pin.slice(0, -1);
      renderDots();
      error.textContent = '';
    } else {
      go('/');
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const keypad = h('div.keypad');
  for (const k of keys) {
    keypad.append(h('button.keypad__key', { onclick: () => press(k) }, k));
  }
  keypad.append(
    h('button.keypad__key.keypad__key--fn', { onclick: back, 'aria-label': 'Hapus' }, icon('chevronLeft')),
    h('button.keypad__key', { onclick: () => press('0') }, '0'),
    h('button.keypad__key.keypad__key--fn', { onclick: () => { pin = ''; renderDots(); error.textContent = ''; }, 'aria-label': 'Hapus semua' }, icon('refresh'))
  );

  host.append(
    h('div.gate__card', null,
      h('div.gate__logo', null, icon('lock')),
      h('h1.t-h1', null, 'Portal Internal'),
      h('p.t-body.mt-2', null, 'Masukkan PIN untuk masuk sebagai kasir, owner, atau membuka layar antrean.'),
      dots,
      error,
      keypad,
      h('div.row.gap-2.mt-5', null,
        h('button.btn.btn--ghost.btn--sm.grow', { onclick: () => go('/') }, icon('arrowLeft'), 'Kembali ke toko'),
        h('button.btn.btn--ghost.btn--sm.grow', {
          onclick: () => { pin = ''; renderDots(); error.textContent = ''; },
        }, icon('refresh'), 'Bersihkan')
      )
    )
  );

  // keyboard support
  const onKey = (e) => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') back();
    else if (e.key === 'Enter' && pin.length === 4) press('');
  };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.removeEventListener('keydown', onKey), 600000);

  return host;
}

/* -------------------------------------------------------------------------
   Portal shell
   ---------------------------------------------------------------------- */

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'chart', roles: ['owner', 'kasir'] },
  { key: 'pos', label: 'Kasir / POS', icon: 'cash', roles: ['owner', 'kasir'] },
  { key: 'orders', label: 'Pesanan Online', icon: 'receipt', roles: ['owner', 'kasir'] },
  { key: 'queue', label: 'Antrean', icon: 'list', roles: ['owner', 'kasir'] },
  { key: 'products', label: 'Katalog & Stok', icon: 'box', roles: ['owner'] },
  { key: 'reports', label: 'Laporan', icon: 'chart', roles: ['owner', 'kasir'] },
  { key: 'transactions', label: 'Transaksi', icon: 'receipt', roles: ['owner', 'kasir'] },
  { key: 'users', label: 'Pengguna', icon: 'users', roles: ['owner'] },
  { key: 'settings', label: 'Pengaturan', icon: 'settings', roles: ['owner'] },
];

function portalShell(active = '') {
  const shell = h('div.portal');
  const nav = h('aside.rail-nav');
  const main = h('main.portal__main');

  let current = active || 'dashboard';
  const body = h('div.portal__body');
  const titleEl = h('h1.t-h2');
  const subEl = h('div.t-sm');

  const renderNav = () => {
    nav.innerHTML = '';
    nav.append(
      h('div.rail-nav__brand', null,
        h('a.brand', { href: withBase('/') },
          h('span.brand__mark', null, icon('store')),
          h('span', null, 'My Kasir')
        )
      )
    );

    const visible = NAV.filter((n) => n.roles.includes(session.role));
    const label = 'Operasional';
    nav.append(h('div.rail-nav__label', null, label));

    for (const item of visible) {
      nav.append(
        h('button.rail-nav__item', {
          class: current === item.key ? 'is-active' : '',
          onclick: () => {
            current = item.key;
            renderNav();
            renderView();
            nav.classList.remove('is-open');
          },
        }, icon(item.icon), item.label)
      );
    }

    nav.append(
      h('div.rail-nav__foot', null,
        h('a.rail-nav__item', { href: withBase('/'), onclick: () => go('/') }, icon('store'), 'Lihat toko'),
        h('a.rail-nav__item', { href: withBase('/antrean') }, icon('monitor'), 'Layar antrean'),
        h('button.rail-nav__item', {
          onclick: () => {
            const next = toggleTheme();
            toast(`Mode ${next === 'dark' ? 'gelap' : 'terang'} aktif`, 'info', 1600);
          },
        }, icon(currentTheme() === 'dark' ? 'sun' : 'moon'), 'Ganti tema'),
        h('button.rail-nav__item', {
          onclick: async () => {
            await confirmDialog({
              title: 'Keluar dari portal?',
              body: 'Sesi PIN akan diakhiri.',
              confirmLabel: 'Keluar',
            });
            session = null;
            try { sessionStorage.removeItem(ROLE_KEY); } catch { /* ignore */ }
            go('/');
          },
        }, icon('logout'), 'Keluar')
      )
    );
  };

  const renderView = () => {
    const item = NAV.find((n) => n.key === current);
    titleEl.textContent = item?.label || 'Portal';
    body.innerHTML = '';
    body.append(h('div.row.gap-2.mb-4', null, h('span.spinner'), h('span.t-sm', null, 'Memuat…')));

    Promise.resolve(viewFactory[current]?.())
      .then((node) => {
        body.innerHTML = '';
        body.append(node);
      })
      .catch((err) => {
        console.error(err);
        body.innerHTML = '';
        body.append(emptyState('alert', 'Gagal memuat', err.message || 'Terjadi kesalahan.'));
      });
  };

  main.append(
    h('div.portal__top', null,
      h('button.btn.btn--icon.btn--ghost.rail-toggle', {
        'aria-label': 'Menu',
        onclick: () => nav.classList.toggle('is-open'),
      }, icon('list')),
      h('div.grow', null, titleEl, subEl),
      h('div.row.gap-2', null,
        h('span.badge.badge--info', null, h('span.dot.dot--live'), session?.role === 'owner' ? 'Owner' : 'Kasir'),
        h('div.avatar', null, initials(session?.name || 'O'))
      )
    ),
    body
  );

  shell.append(nav, main);

  renderNav();
  renderView();
  return shell;
}

/* ==========================================================================
   Dashboard
   ========================================================================== */

async function dashboardView() {
  const data = await api.getDashboardData(14);
  const { summary, daily, top, hourly, channels } = data;

  const totalRevenue = daily.reduce((s, d) => s + d.total, 0);
  const prevRevenue = daily.slice(0, 7).reduce((s, d) => s + d.total, 0);
  const lastRevenue = daily.slice(7).reduce((s, d) => s + d.total, 0);
  const delta = prevRevenue ? Math.round(((lastRevenue - prevRevenue) / prevRevenue) * 100) : 0;

  const metric = (iconName, tone, label, value, deltaValue, spark) =>
    h('div.metric', null,
      h('div.metric__head', null,
        h('div', { class: `metric__ico metric__ico--${tone}` }, icon(iconName)),
        deltaValue !== null
          ? h('span', { class: `metric__delta ${deltaValue >= 0 ? 'metric__delta--up' : 'metric__delta--down'}` },
              icon(deltaValue >= 0 ? 'chevronDown' : 'chevronDown'),
              `${deltaValue >= 0 ? '+' : ''}${deltaValue}%`)
          : null
      ),
      h('div.metric__value', null, value),
      h('div.t-sm', null, label),
      spark ? h('div.metric__spark', null, spark) : null
    );

  const revenueChart = areaChart(
    daily.map((d) => ({ label: d.label, value: d.total })),
    { height: 260, color: '#2F4BFF' }
  );

  const channelData = [
    { label: 'Toko (offline)', value: channels.offline, color: '#2F4BFF' },
    { label: 'Online', value: channels.online, color: '#FF5C7A' },
  ];
  const donut = donutChart(channelData, {
    size: 190,
    centerValue: numberShort(totalRevenue),
    centerLabel: '14 hari',
  });

  const hourlyChart = barChart(
    hourly.map((h2) => ({ label: h2.label, value: h2.total })),
    { height: 200, color: '#0FBFA8' }
  );

  return h('div', null,
    h('div.metrics', null,
      metric('wallet', 'cobalt', 'Pendapatan hari ini', rupiah(summary.revenue), null,
        sparkline(daily.slice(-10).map((d) => ({ value: d.total })), { color: '#2F4BFF' })),
      metric('receipt', 'teal', 'Transaksi hari ini', String(summary.orders), null,
        sparkline(daily.slice(-10).map((d) => ({ value: d.orders })), { color: '#0FBFA8' })),
      metric('chart', 'violet', 'Rata-rata per transaksi', rupiah(summary.average), delta, null),
      metric('box', 'amber', 'Item terjual', String(summary.itemsSold), null, null)
    ),

    h('div.dash.dash--split.mt-4', null,
      h('div.panel.dash--main', null,
        h('div.panel__head', null,
          h('div', null,
            h('h3.t-h3', null, 'Pendapatan 14 hari'),
            h('div.t-sm', null, `Total ${rupiah(totalRevenue)}`)
          ),
          h('div.legend', null,
            h('div.legend__item', null,
              h('span.legend__dot', { style: { background: '#2F4BFF' } }),
              h('span.legend__label', null, 'Penjualan')
            )
          )
        ),
        h('div.panel__body', null, h('div.chart', null, revenueChart))
      ),

      h('div.panel.dash--side', null,
        h('div.panel__head', null, h('h3.t-h3', null, 'Kanal penjualan')),
        h('div.panel__body', null,
          h('div.row.gap-4', null,
            h('div', { style: { flex: '0 0 auto' } }, donut),
            h('div.grow', null,
              legend(channelData.map((d) => ({
                color: d.color, label: d.label, value: rupiah(d.value),
              })))
            )
          )
        )
      )
    ),

    h('div.dash.dash--split.mt-4', null,
      h('div.panel', null,
        h('div.panel__head', null, h('h3.t-h3', null, 'Jam tersibuk (7 hari)')),
        h('div.panel__body', null, h('div.chart', null, hourlyChart))
      ),

      h('div.panel', null,
        h('div.panel__head', null, h('h3.t-h3', null, 'Produk terlaris')),
        h('div.panel__body', null,
          hBarChart(top.map((t) => ({
            label: t.name, value: t.revenue, color: '#7C5CFF',
          })), { format: rupiah })
        )
      )
    ),

    h('div.dash.dash--split.mt-4', null,
      h('div.panel', null,
        h('div.panel__head', null, h('h3.t-h3', null, 'Perlu perhatian')),
        h('div.panel__body', null,
          h('div.col.gap-3', null,
            summary.pending ? h('div.callout.callout--warn', null,
              icon('clock'), h('span', null, h('b', null, String(summary.pending)), ' pesanan online menunggu pembayaran')) : null,
            summary.ready ? h('div.callout.callout--ok', null,
              icon('checkCircle'), h('span', null, h('b', null, String(summary.ready)), ' pesanan siap diambil')) : null,
            summary.outStock ? h('div.callout.callout--err', null,
              icon('alert'), h('span', null, h('b', null, String(summary.outStock)), ' produk kehabisan stok')) : null,
            summary.lowStock ? h('div.callout', null,
              icon('info'), h('span', null, h('b', null, String(summary.lowStock)), ' produk berstok menipis')) : null,
            !summary.pending && !summary.ready && !summary.outStock && !summary.lowStock
              ? h('div.callout.callout--ok', null, icon('checkCircle'), 'Semua beres — tidak ada hal yang perlu ditindaklanjuti.') : null
          )
        )
      ),

      h('div.panel', null,
        h('div.panel__head', null, h('h3.t-h3', null, 'Transaksi terbaru')),
        h('div.panel__body.panel__body--flush', null,
          (await api.getTransactions()).slice(0, 6).map((t) =>
            h('div.list-row', null,
              h('div.avatar', { class: t.channel === 'online' ? 'avatar--violet' : 'avatar--teal' },
                icon(t.channel === 'online' ? 'qr' : 'cash')),
              h('div.grow', null,
                h('div', { style: { fontSize: '13.5px', fontWeight: '600' } }, t.code),
                h('div.t-xs', null, `${t.items?.length || 0} item · ${fmtTime(t.ts)} · ${t.payment}`)
              ),
              h('div.t-mono', { style: { fontSize: '13px', fontWeight: '700' } }, rupiah(t.total))
            )
          )
        )
      )
    )
  );
}

/* ==========================================================================
   POS
   ========================================================================== */

async function posView() {
  const [products, categories, settings] = await Promise.all([
    api.getProducts(), api.getCategories(), api.getSettings(),
  ]);

  let query = '';
  let category = 'all';

  const catalogHost = h('div.pos-grid');
  const ticketItems = h('div.ticket__items');
  const ticketFoot = h('div.ticket__foot');
  const searchInput = h('input.input.input--icon', {
    type: 'search', placeholder: 'Cari produk…', 'data-search': true,
  });

  const renderCatalog = () => {
    let list = products.filter((p) => p.active);
    if (category !== 'all') list = list.filter((p) => p.category === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }

    catalogHost.innerHTML = '';
    if (!list.length) {
      catalogHost.append(emptyState('search', 'Tidak ada produk', 'Coba kata kunci atau kategori lain.'));
      return;
    }

    list.forEach((p, i) => {
      const out = p.trackStock && p.stock <= 0;
      catalogHost.append(
        h('button.pos-item', {
          style: { animationDelay: `${Math.min(i, 14) * 30}ms` },
          disabled: out,
          onclick: () => {
            cart.addItem(p, 1);
            renderTicket();
            toast(`${p.name} ditambahkan`, 'ok', 1600);
          },
        },
          h('div.pos-item__media', null,
            p.image ? h('img', { src: p.image, alt: '', loading: 'lazy' }) : null),
          h('div.pos-item__body', null,
            h('div.pos-item__name', null, p.name),
            h('div.pos-item__price', null, rupiah(p.price)),
            h('div.pos-item__stock', null, out ? 'Stok habis' : p.trackStock ? `Stok ${p.stock}` : 'Stok tak terbatas')
          )
        )
      );
    });
  };

  const renderTicket = () => {
    const c = cart.cart();
    ticketItems.innerHTML = '';
    ticketFoot.innerHTML = '';

    if (!c.items.length) {
      ticketItems.append(emptyState('cart', 'Belum ada item', 'Pilih produk di sebelah kiri untuk menambahkannya.'));
      return;
    }

    for (const it of c.items) {
      ticketItems.append(
        h('div.ticket__line', null,
          h('div.grow', null,
            h('div.ticket__line-name', null, it.name),
            h('div.ticket__line-meta', null, `${rupiah(it.price)} × ${it.qty}`)
          ),
          h('div.qty', null,
            h('button', { onclick: () => { cart.setQty(it.id, it.qty - 1); renderTicket(); } }, icon('minus')),
            h('span.qty__val', null, String(it.qty)),
            h('button', { onclick: () => { cart.setQty(it.id, it.qty + 1); renderTicket(); } }, icon('plus'))
          ),
          h('div.t-mono', { style: { width: '86px', textAlign: 'right', fontSize: '13px', fontWeight: '700' } },
            rupiah(it.price * it.qty))
        )
      );
    }

    ticketFoot.append(
      h('div.sum', null,
        h('div.sum__row', null, h('span', null, `Subtotal (${c.count})`), h('b', null, rupiah(c.subtotal))),
        h('div.sum__row.sum__row--total', null, h('span', null, 'Total'), h('b', null, rupiah(c.total)))
      ),
      h('div.row.gap-2.mt-4', null,
        h('button.btn.btn--ghost', {
          onclick: () => { cart.clearCart(); renderTicket(); },
        }, icon('trash'), 'Kosongkan'),
        h('button.btn.btn--primary.grow', { onclick: openPayment }, icon('cash'), 'Bayar')
      )
    );
  };

  const openPayment = () => {
    const c = cart.cart();
    if (!c.items.length) return;

    let method = 'Cash';
    const cashInput = h('input.input', { type: 'number', placeholder: '0', min: '0', value: String(c.total) });
    const customerInput = h('input.input', { type: 'text', placeholder: 'Nama pelanggan (opsional)' });

    modal((close) => {
      const cashOpt = h('button.pay__opt', {
        onclick: () => { method = 'Cash'; sync(); },
      },
        h('span.pay__ico', null, icon('cash')),
        h('div.grow', null, h('b', null, 'Cash'), h('span', null, 'Uang tunai'))
      );
      const qrisOpt = h('button.pay__opt', {
        onclick: () => { method = 'QRIS'; sync(); },
      },
        h('span.pay__ico', null, icon('qr')),
        h('div.grow', null, h('b', null, 'QRIS'), h('span', null, 'Pindai dengan e-wallet pelanggan'))
      );

      function sync() {
        cashOpt.classList.toggle('is-active', method === 'Cash');
        qrisOpt.classList.toggle('is-active', method === 'QRIS');
        cashField.classList.toggle('hidden', method !== 'Cash');
      }

      const cashField = h('div.field.mt-4', null,
        h('label', null, 'Uang diterima'),
        cashInput,
        h('div.field__hint', null, 'Kembalian dihitung otomatis')
      );
      const changeEl = h('div.callout.mt-3');

      const updateChange = () => {
        const paid = Number(cashInput.value) || 0;
        const change = paid - c.total;
        changeEl.innerHTML = '';
        changeEl.className = 'callout mt-3 ' + (change < 0 ? 'callout--err' : 'callout--ok');
        changeEl.append(
          icon(change < 0 ? 'alert' : 'wallet'),
          change < 0
            ? h('span', null, 'Kurang ', h('b', null, rupiah(Math.abs(change))))
            : h('span', null, 'Kembalian ', h('b', null, rupiah(change)))
        );
      };
      cashInput.addEventListener('input', updateChange);

      sync();
      updateChange();

      return h('div', null,
        h('div.modal__head', null,
          h('div.grow', null,
            h('h3.t-h2', null, 'Pembayaran'),
            h('p.t-body', { style: { marginTop: '4px' } }, `${c.count} item · ${rupiah(c.total)}`)
          ),
          h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
        ),
        h('div.modal__body', null,
          h('div.pay', null, cashOpt, qrisOpt),
          cashField,
          changeEl,
          h('div.field.mt-4', null,
            h('label', null, 'Nama pelanggan (opsional)'),
            customerInput
          )
        ),
        h('div.modal__foot', null,
          h('button.btn.btn--ghost.grow', { onclick: close }, 'Batal'),
          h('button.btn.btn--primary.grow', {
            onclick: () => {
              if (method === 'Cash') {
                const paid = Number(cashInput.value) || 0;
                if (paid < c.total) {
                  toast('Uang diterima kurang dari total', 'err');
                  return;
                }
              }
              finish(method, customerInput.value.trim());
              close();
            },
          }, icon('check'), 'Selesaikan')
        )
      );
    });

    const finish = async (method, customer) => {
      try {
        const { receipt } = await cart.checkoutOffline({
          payment: method,
          cashier: session?.name || 'Kasir',
          customer,
          fulfilment: 'pickup',
        });
        cart.clearCart();
        renderTicket();
        renderCatalog();
        showReceipt(receipt);
        toast('Transaksi tersimpan', 'ok');
      } catch (err) {
        toast(err.message || 'Gagal menyimpan transaksi', 'err');
      }
    };
  };

  const catChips = [h('button.chip.is-active', {
    onclick: (e) => { category = 'all'; syncCats(e.currentTarget); renderCatalog(); },
  }, 'Semua')];

  for (const cat of categories) {
    catChips.push(h('button.chip', {
      onclick: (e) => { category = cat.id; syncCats(e.currentTarget); renderCatalog(); },
    }, cat.name));
  }

  function syncCats(active) {
    catChips.forEach((c) => c.classList.toggle('is-active', c === active));
  }

  searchInput.addEventListener('input', debounce(() => {
    query = searchInput.value;
    renderCatalog();
  }, 160));

  renderCatalog();
  renderTicket();

  return h('div.pos', null,
    h('div.pos__catalog', null,
      h('div.pos__search.input-group', null,
        icon('search', 'input-group__ico'),
        searchInput
      ),
      h('div.pos__cats.rail', null, catChips),
      catalogHost
    ),
    h('div.ticket', null,
      h('div.ticket__head', null,
        h('div', null,
          h('h3.t-h3', null, 'Pesanan berjalan'),
          h('div.t-xs', null, 'Klik produk untuk menambah')
        ),
        h('span.badge.badge--info', { 'data-cart-count': true }, String(cart.cart().count))
      ),
      ticketItems,
      ticketFoot
    )
  );
}

/* -------------------------------------------------------------------------
   Receipt
   ---------------------------------------------------------------------- */

function showReceipt(receipt) {
  modal((close) => {
    const cv = cart.receiptCanvas(receipt, { width: 320 });
    const holder = h('div', {
      style: {
        background: '#fff', padding: '12px', borderRadius: 'var(--r-md)',
        border: '1px solid var(--line)', maxWidth: '340px', margin: '0 auto',
      },
    }, cv);

    return h('div', null,
      h('div.modal__head', null,
        h('div.grow', null,
          h('h3.t-h2', null, 'Struk'),
          h('p.t-body', { style: { marginTop: '4px' } }, receipt.code)
        ),
        h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
      ),
      h('div.modal__body', null, holder),
      h('div.modal__foot', null,
        h('button.btn.btn--ghost.grow', {
          onclick: () => {
            cv.toBlob((blob) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `struk-${receipt.code}.png`;
              a.click();
              URL.revokeObjectURL(url);
            });
          },
        }, icon('download'), 'Unduh'),
        h('button.btn.btn--primary.grow', {
          onclick: () => { window.print(); },
        }, icon('printer'), 'Cetak')
      )
    );
  });
}

/* ==========================================================================
   Online orders
   ========================================================================== */

async function ordersView() {
  const orders = await api.getOnlineOrders();

  const tabs = [
    { key: 'all', label: 'Semua' },
    { key: 'pending', label: 'Menunggu bayar' },
    { key: 'paid', label: 'Terbayar' },
    { key: 'preparing', label: 'Diproses' },
    { key: 'ready', label: 'Siap' },
    { key: 'cancelled', label: 'Batal' },
  ];
  let tab = 'all';

  const listHost = h('div');

  const badgeFor = (o) => {
    if (o.status === 'cancelled') return h('span.badge.badge--err', null, 'Kedaluwarsa');
    if (o.status === 'pending') return h('span.badge.badge--warn', null, 'Menunggu bayar');
    if (o.status === 'paid') return h('span.badge.badge--info', null, 'Terbayar');
    if (o.status === 'preparing') return h('span.badge.badge--violet', null, 'Diproses');
    return h('span.badge.badge--ok', null, 'Siap');
  };

  const render = () => {
    const list = tab === 'all' ? orders : orders.filter((o) => o.status === tab);
    listHost.innerHTML = '';

    if (!list.length) {
      listHost.append(emptyState('receipt', 'Tidak ada pesanan', 'Belum ada pesanan online pada kategori ini.'));
      return;
    }

    listHost.append(
      h('div.panel', null,
        h('div.panel__body.panel__body--flush', null,
          list.map((o) =>
            h('div.list-row', null,
              h('div.avatar', { class: o.status === 'pending' ? 'avatar--amber' : o.status === 'cancelled' ? 'avatar--coral' : 'avatar--teal' },
                icon(o.status === 'pending' ? 'clock' : o.status === 'cancelled' ? 'xCircle' : 'checkCircle')),
              h('div.grow', null,
                h('div.row.gap-2', null,
                  h('span', { style: { fontSize: '13.5px', fontWeight: '700' } }, o.code),
                  badgeFor(o)
                ),
                h('div.t-xs', null,
                  `${o.customer || 'Tanpa nama'} · ${o.items.length} item · ${fmtDateTime(o.ts)}`
                ),
                h('div.t-xs', null,
                  o.fulfilment === 'delivery'
                    ? `Delivery · ${o.address || 'tanpa alamat'}`
                    : 'Ambil di tempat'
                )
              ),
              h('div.col.gap-2', { style: { alignItems: 'flex-end' } },
                h('div.t-mono', { style: { fontSize: '14px', fontWeight: '700' } }, rupiah(o.total)),
                h('div.row.gap-1', null,
                  o.status === 'pending' ? h('button.btn.btn--sm.btn--mint', {
                    onclick: async () => {
                      const res = await api.payOrder(o.code, 'QRIS');
                      if (res.ok) { toast('Pembayaran dikonfirmasi', 'ok'); refresh(); }
                      else toast(res.error || 'Gagal', 'err');
                    },
                  }, 'Konfirmasi bayar') : null,
                  o.status === 'paid' ? h('button.btn.btn--sm.btn--soft', {
                    onclick: async () => { await api.setOrderStatus(o.code, 'preparing'); refresh(); },
                  }, 'Proses') : null,
                  o.status === 'preparing' ? h('button.btn.btn--sm.btn--soft', {
                    onclick: async () => { await api.setOrderStatus(o.code, 'ready'); refresh(); },
                  }, 'Tandai siap') : null
                )
              )
            )
          )
        )
      )
    );
  };

  const refresh = () => {
    const fresh = api.getOnlineOrders().then((o) => {
      orders.length = 0;
      orders.push(...o);
      render();
    });
    return fresh;
  };

  const tabBar = h('div.sr-tabs');
  for (const t of tabs) {
    const count = t.key === 'all' ? orders.length : orders.filter((o) => o.status === t.key).length;
    tabBar.append(
      h('button.sr-tab', {
        class: tab === t.key ? 'is-active' : '',
        onclick: (e) => {
          tab = t.key;
          tabBar.querySelectorAll('.sr-tab').forEach((el) => el.classList.toggle('is-active', el === e.currentTarget));
          render();
        },
      }, t.label, h('span.count-pill', null, String(count)))
    );
  }

  render();
  return h('div', null, tabBar, listHost);
}

/* ==========================================================================
   Queue management
   ========================================================================== */

async function queueView() {
  const entries = await api.getQueue();
  let filter = 'all';

  const host = h('div');

  const badgeFor = (e) => {
    if (e.status === 'ready') return h('span.badge.badge--ok', null, 'Siap diambil');
    if (e.status === 'processing') return h('span.badge.badge--info', null, 'Sedang diproses');
    return h('span.badge', null, 'Menunggu');
  };

  const render = () => {
    const list = filter === 'all' ? entries : entries.filter((e) => e.status === filter);
    host.innerHTML = '';

    if (!list.length) {
      host.append(emptyState('list', 'Antrean kosong', 'Belum ada pesanan yang masuk antrean.'));
      return;
    }

    host.append(
      h('div.panel', null,
        h('div.panel__body.panel__body--flush', null,
          list.map((e) =>
            h('div.list-row', null,
              h('div.avatar.avatar--lg', { class: e.status === 'ready' ? 'avatar--teal' : e.status === 'processing' ? 'avatar--violet' : '' },
                String(e.number)),
              h('div.grow', null,
                h('div.row.gap-2', null,
                  h('span', { style: { fontSize: '14px', fontWeight: '700' } }, `Nomor ${e.number}`),
                  badgeFor(e)
                ),
                h('div.t-xs', null, `${e.code || '—'} · ${e.label || '—'} · ${relTime(e.ts)}`)
              ),
              h('div.row.gap-1', null,
                e.status === 'waiting' ? h('button.btn.btn--sm.btn--soft', {
                  onclick: async () => { await api.setQueueEntryStatus(e.number, 'processing'); refresh(); },
                }, 'Proses') : null,
                e.status !== 'ready' ? h('button.btn.btn--sm.btn--mint', {
                  onclick: async () => { await api.setQueueEntryStatus(e.number, 'ready'); refresh(); },
                }, 'Siap') : null,
                h('a.btn.btn--sm.btn--ghost', { href: withBase('/antrean'), target: '_blank' }, icon('monitor'))
              )
            )
          )
        )
      )
    );
  };

  const refresh = async () => {
    const fresh = await api.getQueue();
    entries.length = 0;
    entries.push(...fresh);
    render();
  };

  const tabs = [
    { key: 'all', label: 'Semua' },
    { key: 'waiting', label: 'Menunggu' },
    { key: 'processing', label: 'Diproses' },
    { key: 'ready', label: 'Siap diambil' },
  ];

  const tabBar = h('div.sr-tabs');
  for (const t of tabs) {
    const count = t.key === 'all' ? entries.length : entries.filter((e) => e.status === t.key).length;
    tabBar.append(
      h('button.sr-tab', {
        class: filter === t.key ? 'is-active' : '',
        onclick: (e) => {
          filter = t.key;
          tabBar.querySelectorAll('.sr-tab').forEach((el) => el.classList.toggle('is-active', el === e.currentTarget));
          render();
        },
      }, t.label, h('span.count-pill', null, String(count)))
    );
  }

  render();
  return h('div', null, tabBar, host);
}

/* ==========================================================================
   Products (Owner)
   ========================================================================== */

async function productsView() {
  const [products, categories] = await Promise.all([api.getProducts(), api.getCategories()]);
  let query = '';
  let category = 'all';

  const listHost = h('div');
  const searchInput = h('input.input.input--icon', { type: 'search', placeholder: 'Cari produk…' });

  const render = () => {
    let list = products.slice();
    if (category !== 'all') list = list.filter((p) => p.category === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }

    listHost.innerHTML = '';

    if (!list.length) {
      listHost.append(emptyState('box', 'Tidak ada produk', 'Belum ada produk yang cocok.'));
      return;
    }

    listHost.append(
      h('div.panel', null,
        h('div.panel__body.panel__body--flush', null,
          h('div.table-wrap', { style: { border: 'none', borderRadius: '0' } },
            h('table.table', null,
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Produk'),
                  h('th', null, 'Kategori'),
                  h('th', { class: 't-right' }, 'Harga'),
                  h('th', { class: 't-right' }, 'Modal'),
                  h('th', { class: 't-right' }, 'Stok'),
                  h('th', null, 'Status'),
                  h('th', null, '')
                )
              ),
              h('tbody', null,
                list.map((p) => {
                  const cat = categories.find((c) => c.id === p.category);
                  const out = p.trackStock && p.stock <= 0;
                  const low = p.trackStock && p.stock > 0 && p.stock <= 5;
                  return h('tr', null,
                    h('td', null,
                      h('div.row.gap-3', null,
                        h('div.thumb-sm', null, p.image ? h('img', { src: p.image, alt: '' }) : null),
                        h('div', null,
                          h('div', { style: { fontWeight: '600' } }, p.name),
                          h('div.t-xs', null, p.description?.slice(0, 46) || '')
                        )
                      )
                    ),
                    h('td', null, cat?.name || '—'),
                    h('td', { class: 't-right t-num' }, rupiah(p.price)),
                    h('td', { class: 't-right t-num' }, rupiah(p.cost)),
                    h('td', { class: 't-right t-num' }, p.trackStock ? String(p.stock) : '∞'),
                    h('td', null,
                      !p.active
                        ? h('span.badge', null, 'Nonaktif')
                        : out
                          ? h('span.badge.badge--err', null, 'Habis')
                          : low
                            ? h('span.badge.badge--warn', null, 'Menipis')
                            : h('span.badge.badge--ok', null, 'Aktif')
                    ),
                    h('td', { class: 't-right' },
                      h('div.row.gap-1', { style: { justifyContent: 'flex-end' } },
                        h('button.btn.btn--sm.btn--icon.btn--ghost', {
                          'aria-label': 'Ubah', onclick: () => openProductForm(p),
                        }, icon('edit')),
                        h('button.btn.btn--sm.btn--icon.btn--ghost', {
                          'aria-label': 'Hapus',
                          onclick: async () => {
                            const ok = await confirmDialog({
                              title: `Hapus "${p.name}"?`,
                              body: 'Produk akan dihapus dari katalog. Transaksi lama tetap tersimpan.',
                            });
                            if (!ok) return;
                            await api.deleteProductRecord(p.id);
                            toast('Produk dihapus', 'ok');
                            go('/portal/products', { replace: true });
                            location.reload();
                          },
                        }, icon('trash'))
                      )
                    )
                  );
                })
              )
            )
          )
        )
      )
    );
  };

  const openProductForm = (existing) => {
    const isNew = !existing;
    const draft = existing
      ? { ...existing }
      : { name: '', category: categories[0]?.id || '', price: 0, cost: 0, stock: 0, unit: 'pcs', image: '', active: true, trackStock: true, description: '', note: '', negotiable: false };

    modal((close) => {
      const nameInput = h('input.input', { type: 'text', value: draft.name, placeholder: 'Nama produk' });
      const priceInput = h('input.input', { type: 'number', value: String(draft.price), min: '0' });
      const costInput = h('input.input', { type: 'number', value: String(draft.cost), min: '0' });
      const stockInput = h('input.input', { type: 'number', value: String(draft.stock), min: '0' });
      const unitInput = h('input.input', { type: 'text', value: draft.unit });
      const descInput = h('textarea.textarea', { placeholder: 'Deskripsi singkat' });
      descInput.value = draft.description || '';
      const noteInput = h('input.input', { type: 'text', value: draft.note || '', placeholder: 'Catatan (ukuran, varian, dll)' });
      const catSelect = h('select.select', null,
        categories.map((c) => h('option', { value: c.id, selected: c.id === draft.category }, c.name))
      );
      const imagePreview = h('div', {
        style: {
          width: '96px', height: '96px', borderRadius: 'var(--r-md)', background: 'var(--surface-3)',
          display: 'grid', placeItems: 'center', padding: '8px', flex: 'none',
        },
      });
      let imageData = draft.image || '';

      const paint = () => {
        imagePreview.innerHTML = '';
        if (imageData) imagePreview.append(h('img', { src: imageData, alt: '', style: { width: '100%', height: '100%', objectFit: 'contain' } }));
      };
      paint();

      const fileInput = h('input', {
        type: 'file', accept: 'image/*', style: { display: 'none' },
        onchange: async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            imageData = await fileToDataUrl(file, 640);
            paint();
          } catch (err) {
            toast(err.message || 'Gagal memuat gambar', 'err');
          }
        },
      });

      const trackSwitch = h('input', { type: 'checkbox', checked: draft.trackStock });
      const activeSwitch = h('input', { type: 'checkbox', checked: draft.active });
      const negoSwitch = h('input', { type: 'checkbox', checked: draft.negotiable });

      const sw = (input, label) =>
        h('label.switch', null, input, h('span.t-sm', null, label));

      return h('div', null,
        h('div.modal__head', null,
          h('div.grow', null,
            h('h3.t-h2', null, isNew ? 'Tambah produk' : 'Ubah produk'),
            h('p.t-body', { style: { marginTop: '4px' } }, isNew ? 'Produk baru langsung tampil di katalog' : draft.name)
          ),
          h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
        ),

        h('div.modal__body', null,
          h('div.row.gap-4', null,
            imagePreview,
            h('div.grow.col.gap-3', null,
              h('div.field', null, h('label', null, 'Nama produk'), nameInput),
              h('div.field', null, h('label', null, 'Kategori'), catSelect),
              h('button.btn.btn--soft.btn--sm', {
                onclick: () => fileInput.click(),
              }, icon('upload'), 'Pilih gambar'),
              fileInput
            )
          ),

          h('div.split-2.mt-4', null,
            h('div.field', null, h('label', null, 'Harga jual (Rp)'), priceInput),
            h('div.field', null, h('label', null, 'Harga modal (Rp)'), costInput)
          ),

          h('div.split-2.mt-3', null,
            h('div.field', null, h('label', null, 'Stok'), stockInput),
            h('div.field', null, h('label', null, 'Satuan'), unitInput)
          ),

          h('div.field.mt-3', null, h('label', null, 'Deskripsi'), descInput),
          h('div.field.mt-3', null, h('label', null, 'Catatan'), noteInput),

          h('div.col.gap-3.mt-4', null,
            sw(trackSwitch, 'Lacak stok produk ini'),
            sw(activeSwitch, 'Tampilkan di katalog'),
            sw(negoSwitch, 'Harga bisa dinegosiasikan')
          )
        ),

        h('div.modal__foot', null,
          h('button.btn.btn--ghost.grow', { onclick: close }, 'Batal'),
          h('button.btn.btn--primary.grow', {
            onclick: async () => {
              const name = nameInput.value.trim();
              if (!name) { toast('Nama produk wajib diisi', 'err'); return; }
              const price = Number(priceInput.value) || 0;
              if (price <= 0) { toast('Harga jual harus lebih dari 0', 'err'); return; }

              await api.saveProductRecord({
                ...draft,
                name,
                price,
                cost: Number(costInput.value) || 0,
                stock: Number(stockInput.value) || 0,
                unit: unitInput.value.trim() || 'pcs',
                description: descInput.value.trim(),
                note: noteInput.value.trim(),
                image: imageData,
                category: catSelect.value,
                trackStock: trackSwitch.checked,
                active: activeSwitch.checked,
                negotiable: negoSwitch.checked,
              });

              toast(isNew ? 'Produk ditambahkan' : 'Produk diperbarui', 'ok');
              close();
              location.reload();
            },
          }, icon('check'), 'Simpan')
        )
      );
    }, { wide: true });
  };

  const cats = [h('button.chip.is-active', {
    onclick: (e) => { category = 'all'; sync(e.currentTarget); render(); },
  }, 'Semua')];
  for (const cat of categories) {
    cats.push(h('button.chip', {
      onclick: (e) => { category = cat.id; sync(e.currentTarget); render(); },
    }, cat.name));
  }
  function sync(active) { cats.forEach((c) => c.classList.toggle('is-active', c === active)); }

  searchInput.addEventListener('input', debounce(() => {
    query = searchInput.value;
    render();
  }, 160));

  render();

  return h('div', null,
    h('div.toolbar', null,
      h('div.toolbar__search.input-group', null, icon('search', 'input-group__ico'), searchInput),
      h('div.rail', { style: { padding: 0, flex: 'none' } }, cats),
      h('button.btn.btn--primary', { onclick: () => openProductForm(null) }, icon('plus'), 'Tambah produk')
    ),
    listHost
  );
}

/* ==========================================================================
   Reports (Kasir + Owner)
   ========================================================================== */

async function reportsView() {
  const range = await api.getReport(14);
  const { daily, top, hourly, channels, summary } = range;

  const total = daily.reduce((s, d) => s + d.total, 0);
  const orders = daily.reduce((s, d) => s + d.orders, 0);

  // busiest hour per day → heat map
  const heatCells = [];
  for (let d = 0; d < 7; d++) {
    const day = hourly[d % hourly.length];
    heatCells.push({ label: day.label, value: day.total });
  }

  const paymentSplit = [
    { label: 'QRIS', value: daily.reduce((s, d) => s + d.qris, 0), color: '#2F4BFF' },
    { label: 'Cash', value: daily.reduce((s, d) => s + d.cash, 0), color: '#0FBFA8' },
  ];

  const growth = daily.length > 1 && daily[0].total
    ? Math.round(((daily[daily.length - 1].total - daily[0].total) / daily[0].total) * 100)
    : 0;

  return h('div', null,
    h('div.metrics', null,
      h('div.metric', null,
        h('div.metric__head', null, h('div', { class: 'metric__ico metric__ico--cobalt' }, icon('wallet'))),
        h('div.metric__value', null, rupiah(total)),
        h('div.t-sm', null, 'Pendapatan 14 hari')
      ),
      h('div.metric', null,
        h('div.metric__head', null, h('div', { class: 'metric__ico metric__ico--teal' }, icon('receipt'))),
        h('div.metric__value', null, String(orders)),
        h('div.t-sm', null, 'Total transaksi')
      ),
      h('div.metric', null,
        h('div.metric__head', null, h('div', { class: 'metric__ico metric--ico--violet metric__ico--violet' }, icon('chart'))),
        h('div.metric__value', null, rupiah(orders ? Math.round(total / orders) : 0)),
        h('div.t-sm', null, 'Rata-rata transaksi')
      ),
      h('div.metric', null,
        h('div.metric__head', null,
          h('div', { class: 'metric__ico metric__ico--amber' }, icon('percent')),
          h('span', { class: `metric__delta ${growth >= 0 ? 'metric__delta--up' : 'metric__delta--down'}` },
            `${growth >= 0 ? '+' : ''}${growth}%`)
        ),
        h('div.metric__value', null, `${numberShort(summary.itemsSold)}`),
        h('div.t-sm', null, 'Item terjual hari ini')
      )
    ),

    h('div.panel.mt-4', null,
      h('div.panel__head', null,
        h('h3.t-h3', null, 'Pendapatan harian'),
        h('div.legend', null,
          h('div.legend__item', null, h('span.legend__dot', { style: { background: '#2F4BFF' } }), h('span.legend__label', null, 'Penjualan'))
        )
      ),
      h('div.panel__body', null,
        h('div.chart', null,
          areaChart(daily.map((d) => ({ label: d.label, value: d.total })), { height: 280, color: '#2F4BFF' })
        )
      )
    ),

    h('div.dash.dash--split.mt-4', null,
      h('div.panel', null,
        h('div.panel__head', null, h('h3.t-h3', null, 'Penjualan per jam')),
        h('div.panel__body', null,
          h('div.chart', null,
            barChart(hourly.map((x) => ({ label: x.label, value: x.total })), { height: 220, color: '#7C5CFF' })
          )
        )
      ),
      h('div.panel', null,
        h('div.panel__head', null, h('h3.t-h3', null, 'Metode pembayaran')),
        h('div.panel__body', null,
          h('div.row.gap-4', null,
            h('div', { style: { flex: '0 0 auto' } },
              donutChart(paymentSplit, {
                size: 180,
                centerValue: numberShort(total),
                centerLabel: 'total',
              })
            ),
            h('div.grow', null,
              legend(paymentSplit.map((d) => ({ color: d.color, label: d.label, value: rupiah(d.value) }))),
              h('div.divider'),
              h('div.t-sm', null, 'Penjualan per kanal'),
              h('div.mt-2', null,
                legend([
                  { color: '#2F4BFF', label: 'Toko', value: rupiah(channels.offline) },
                  { color: '#FF5C7A', label: 'Online', value: rupiah(channels.online) },
                ])
              )
            )
          )
        )
      )
    ),

    h('div.panel.mt-4', null,
      h('div.panel__head', null, h('h3.t-h3', null, '10 produk terlaris')),
      h('div.panel__body', null,
        hBarChart(top.map((t) => ({ label: t.name, value: t.revenue, color: '#2F4BFF' })), { format: rupiah })
      )
    )
  );
}

/* ==========================================================================
   Transactions
   ========================================================================== */

async function transactionsView() {
  const transactions = await api.getTransactions();
  let query = '';
  let filter = 'all';

  const listHost = h('div');
  const searchInput = h('input.input.input--icon', { type: 'search', placeholder: 'Cari kode, kasir, pelanggan…' });

  const render = () => {
    let list = transactions.slice();
    if (filter === 'online') list = list.filter((t) => t.channel === 'online');
    if (filter === 'offline') list = list.filter((t) => t.channel === 'offline');
    if (filter === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      list = list.filter((t) => new Date(t.ts).getTime() >= start.getTime());
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((t) =>
        t.code?.toLowerCase().includes(q) ||
        t.cashier?.toLowerCase().includes(q) ||
        t.customer?.toLowerCase().includes(q)
      );
    }

    listHost.innerHTML = '';
    if (!list.length) {
      listHost.append(emptyState('receipt', 'Tidak ada transaksi', 'Coba ubah filter atau kata kunci pencarian.'));
      return;
    }

    listHost.append(
      h('div.panel', null,
        h('div.panel__body.panel__body--flush', null,
          h('div.table-wrap', { style: { border: 'none', borderRadius: '0' } },
            h('table.table', null,
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Kode'),
                  h('th', null, 'Waktu'),
                  h('th', null, 'Item'),
                  h('th', null, 'Kasir'),
                  h('th', null, 'Bayar'),
                  h('th', { class: 't-right' }, 'Total'),
                  session.role === 'owner' ? h('th', null, '') : null
                )
              ),
              h('tbody', null,
                list.slice(0, 200).map((t) =>
                  h('tr', null,
                    h('td', null, h('span.t-mono', { style: { fontWeight: '600' } }, t.code)),
                    h('td', null, h('span.t-sm', null, fmtDateTime(t.ts))),
                    h('td', null, h('span.t-sm', null, `${t.items?.length || 0} item`)),
                    h('td', null, h('span.t-sm', null, t.cashier || '—')),
                    h('td', null,
                      h('span', { class: `badge ${t.payment === 'Cash' ? 'badge--warn' : 'badge--info'}` }, t.payment)
                    ),
                    h('td', { class: 't-right t-num', style: { fontWeight: '700' } }, rupiah(t.total)),
                    session.role === 'owner'
                      ? h('td', { class: 't-right' },
                          h('button.btn.btn--sm.btn--icon.btn--ghost', {
                            'aria-label': 'Hapus',
                            onclick: async () => {
                              const ok = await confirmDialog({
                                title: `Hapus transaksi ${t.code}?`,
                                body: 'Data transaksi akan hilang permanen dari laporan.',
                              });
                              if (!ok) return;
                              await api.deleteTransactionRecord(t.id);
                              toast('Transaksi dihapus', 'ok');
                              location.reload();
                            },
                          }, icon('trash'))
                        )
                      : null
                  )
                )
              )
            )
          )
        )
      )
    );
  };

  const filters = [
    { key: 'all', label: 'Semua' },
    { key: 'today', label: 'Hari ini' },
    { key: 'offline', label: 'Toko' },
    { key: 'online', label: 'Online' },
  ];
  const tabBar = h('div.sr-tabs');
  for (const f of filters) {
    tabBar.append(
      h('button.sr-tab', {
        class: filter === f.key ? 'is-active' : '',
        onclick: (e) => {
          filter = f.key;
          tabBar.querySelectorAll('.sr-tab').forEach((el) => el.classList.toggle('is-active', el === e.currentTarget));
          render();
        },
      }, f.label)
    );
  }

  searchInput.addEventListener('input', debounce(() => {
    query = searchInput.value;
    render();
  }, 160));

  render();

  return h('div', null,
    h('div.toolbar', null,
      h('div.toolbar__search.input-group', null, icon('search', 'input-group__ico'), searchInput)
    ),
    tabBar,
    listHost
  );
}

/* ==========================================================================
   Users (Owner)
   ========================================================================== */

async function usersView() {
  const users = await api.getUsers();
  const listHost = h('div');

  const render = () => {
    listHost.innerHTML = '';
    listHost.append(
      h('div.panel', null,
        h('div.panel__body.panel__body--flush', null,
          h('div.table-wrap', { style: { border: 'none', borderRadius: '0' } },
            h('table.table', null,
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Pengguna'),
                  h('th', null, 'Username'),
                  h('th', null, 'Peran'),
                  h('th', null, 'Status'),
                  h('th', null, '')
                )
              ),
              h('tbody', null,
                users.map((u) =>
                  h('tr', null,
                    h('td', null,
                      h('div.row.gap-3', null,
                        h('div.avatar', { class: u.role === 'owner' ? 'avatar--violet' : 'avatar--teal' }, initials(u.name)),
                        h('span', { style: { fontWeight: '600' } }, u.name)
                      )
                    ),
                    h('td', null, h('span.t-mono.t-sm', null, u.username)),
                    h('td', null,
                      h('span', { class: `badge ${u.role === 'owner' ? 'badge--violet' : 'badge--info'}` },
                        u.role === 'owner' ? 'Owner' : 'Kasir')
                    ),
                    h('td', null,
                      u.active
                        ? h('span.badge.badge--ok', null, 'Aktif')
                        : h('span.badge', null, 'Nonaktif')
                    ),
                    h('td', { class: 't-right' },
                      h('div.row.gap-1', { style: { justifyContent: 'flex-end' } },
                        h('button.btn.btn--sm.btn--icon.btn--ghost', {
                          'aria-label': 'Ubah', onclick: () => openForm(u),
                        }, icon('edit')),
                        h('button.btn.btn--sm.btn--icon.btn--ghost', {
                          'aria-label': 'Hapus',
                          onclick: async () => {
                            if (users.filter((x) => x.role === 'owner').length <= 1 && u.role === 'owner') {
                              toast('Minimal satu owner harus ada', 'err');
                              return;
                            }
                            const ok = await confirmDialog({
                              title: `Hapus pengguna "${u.name}"?`,
                              body: 'Pengguna tidak akan bisa masuk portal.',
                            });
                            if (!ok) return;
                            await api.deleteUserRecord(u.id);
                            toast('Pengguna dihapus', 'ok');
                            location.reload();
                          },
                        }, icon('trash'))
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    );
  };

  const openForm = (existing) => {
    const isNew = !existing;
    const draft = existing ? { ...existing } : { name: '', username: '', password: '', role: 'kasir', active: true };

    modal((close) => {
      const nameInput = h('input.input', { type: 'text', value: draft.name, placeholder: 'Nama lengkap' });
      const userInput = h('input.input', { type: 'text', value: draft.username, placeholder: 'Username', autocapitalize: 'none' });
      const passInput = h('input.input', { type: 'text', value: draft.password, placeholder: 'Kata sandi' });
      const roleSelect = h('select.select', null,
        h('option', { value: 'kasir', selected: draft.role === 'kasir' }, 'Kasir'),
        h('option', { value: 'owner', selected: draft.role === 'owner' }, 'Owner')
      );
      const activeSwitch = h('input', { type: 'checkbox', checked: draft.active });

      return h('div', null,
        h('div.modal__head', null,
          h('div.grow', null,
            h('h3.t-h2', null, isNew ? 'Tambah pengguna' : 'Ubah pengguna'),
            h('p.t-body', { style: { marginTop: '4px' } }, isNew ? 'Kasir baru bisa langsung masuk dengan PIN portal' : draft.name)
          ),
          h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
        ),
        h('div.modal__body', null,
          h('div.field', null, h('label', null, 'Nama lengkap'), nameInput),
          h('div.field.mt-3', null, h('label', null, 'Username'), userInput),
          h('div.field.mt-3', null, h('label', null, 'Kata sandi'), passInput),
          h('div.field.mt-3', null, h('label', null, 'Peran'), roleSelect),
          h('label.switch.mt-4', null, activeSwitch, h('span.t-sm', null, 'Akun aktif'))
        ),
        h('div.modal__foot', null,
          h('button.btn.btn--ghost.grow', { onclick: close }, 'Batal'),
          h('button.btn.btn--primary.grow', {
            onclick: async () => {
              const name = nameInput.value.trim();
              const username = userInput.value.trim();
              const password = passInput.value.trim();
              if (!name || !username || !password) {
                toast('Nama, username, dan kata sandi wajib diisi', 'err');
                return;
              }
              await api.saveUserRecord({
                ...draft, name, username, password,
                role: roleSelect.value,
                active: activeSwitch.checked,
              });
              toast(isNew ? 'Pengguna ditambahkan' : 'Pengguna diperbarui', 'ok');
              close();
              location.reload();
            },
          }, icon('check'), 'Simpan')
        )
      );
    });
  };

  render();

  return h('div', null,
    h('div.toolbar', null,
      h('div.grow', null, h('div.t-sm', null, 'Kelola akses kasir dan owner ke portal internal.')),
      h('button.btn.btn--primary', { onclick: () => openForm(null) }, icon('plus'), 'Tambah pengguna')
    ),
    listHost
  );
}

/* ==========================================================================
   Settings (Owner)
   ========================================================================== */

async function settingsView() {
  const s = await api.getSettings();
  const tab = 'umum';
  const host = h('div');

  const switchRow = (key, label, hint) => {
    const input = h('input', { type: 'checkbox', checked: !!s[key] });
    input.addEventListener('change', async () => {
      await api.saveSettings({ [key]: input.checked });
      refreshSettings();
      toast('Pengaturan disimpan', 'ok', 1400);
    });
    return h('div.row-between', { style: { padding: '12px 0', borderBottom: '1px solid var(--line-2)' } },
      h('div.grow', null,
        h('div', { style: { fontWeight: '600', fontSize: '13.5px' } }, label),
        hint ? h('div.t-xs', { style: { marginTop: '2px' } }, hint) : null
      ),
      h('label.switch', null, input)
    );
  };

  const textRow = (key, label, hint, type = 'text') => {
    const input = h('input.input', { type, value: s[key] ?? '' });
    input.addEventListener('change', async () => {
      await api.saveSettings({ [key]: type === 'number' ? Number(input.value) || 0 : input.value });
      refreshSettings();
      toast('Disimpan', 'ok', 1400);
    });
    return h('div.field', null,
      h('label', null, label),
      input,
      hint ? h('div.field__hint', null, hint) : null
    );
  };

  const render = () => {
    host.innerHTML = '';

    if (tab === 'umum') {
      host.append(
        h('div.split-2', null,
          h('div.panel', null,
            h('div.panel__head', null, h('h3.t-h3', null, 'Identitas toko')),
            h('div.panel__body', null,
              textRow('storeName', 'Nama toko', 'Ditampilkan di header dan struk'),
              h('div.mt-3', null, textRow('storeTagline', 'Tagline', 'Kalimat singkat di halaman depan')),
              h('div.mt-3', null, textRow('storeAddress', 'Alamat', 'Alamat lengkap toko')),
              h('div.mt-3', null, textRow('storeAddressShort', 'Alamat ringkas', 'Dipakai di pilihan pengambilan')),
              h('div.mt-3', null, textRow('storePhone', 'Telepon', 'Kontak pelanggan'))
            )
          ),

          h('div.panel', null,
            h('div.panel__head', null, h('h3.t-h3', null, 'Pengiriman & pembayaran')),
            h('div.panel__body', null,
              textRow('deliveryFee', 'Ongkir flat (Rp)', 'Dipakai untuk pesanan delivery', 'number'),
              h('div.mt-3', null, textRow('deliveryRadiusKm', 'Radius delivery (km)', 'Batas jarak pengiriman', 'number')),
              h('div.mt-3', null, textRow('qrisMerchant', 'Nama merchants QRIS', 'Ditampilkan di struk')),
              h('div.mt-3', null, textRow('qrisNmid', 'NMID QRIS', 'Nomor merchants dinamis')),
              h('div.mt-3', null, textRow('portalPin', 'PIN portal', 'PIN untuk masuk ke portal internal', 'text'))
            )
          )
        ),

        h('div.panel.mt-4', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Fitur yang aktif')),
          h('div.panel__body', null,
            switchRow('featureOnlineOrder', 'Pesanan online', 'Tampilkan checkout di storefront'),
            switchRow('featureDelivery', 'Pengiriman', 'Sembunyikan pilihan delivery bila nonaktif'),
            switchRow('featureDineIn', 'Makan di tempat / ambil', 'Sembunyikan pilihan ambil di tempat'),
            switchRow('featureCustomerName', 'Nama pelanggan', 'Tampilkan kolom nama pelanggan'),
            switchRow('featureQueue', 'Layar antrean', 'Sediakan layar nomor antrean untuk pelanggan'),
            switchRow('allowNegotiable', 'Harga bisa dinegosiasikan', 'Tampilkan label “bisa nego” pada produk'),
            switchRow('allowDiscount', 'Diskon', 'Izinkan diskon pada transaksi'),
            switchRow('requireCustomerName', 'Nama pelanggan wajib diisi', 'Gagalkan checkout bila nama kosong')
          )
        ),

        h('div.panel.mt-4', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Istilah (dapat disesuaikan)')),
          h('div.panel__body', null,
            h('div.split-2', null,
              textRow('termProduct', 'Istilah produk', 'Mis. Produk, Barang, Menu'),
              textRow('termCategory', 'Istilah kategori', 'Mis. Kategori, Jenis, Grup'),
              textRow('termOrder', 'Istilah pesanan', 'Mis. Pesanan, Order'),
              textRow('termCustomer', 'Istilah pelanggan', 'Mis. Pelanggan, Pembeli'),
              textRow('termDineIn', 'Istilah ambil di tempat', 'Mis. Makan di Tempat, Dine In'),
              textRow('termTakeAway', 'Istilah bawa pulang', 'Mis. Bawa Pulang, Take Away'),
              textRow('termTable', 'Istilah nomor', 'Mis. Nomor, Meja'),
              textRow('termQueue', 'Istilah antrean', 'Mis. Antrean, Queue')
            )
          )
        ),

        h('div.panel.mt-4', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Struk')),
          h('div.panel__body', null,
            textRow('receiptHeader', 'Judul struk', 'Dicetak di bagian atas struk'),
            h('div.mt-3', null, textRow('receiptFooter', 'Pesan kaki struk', 'Dicetak di bagian bawah struk')),
            textRow('maxDiscountPercent', 'Maksimum diskon (%)', 'Batas diskon yang boleh diberikan', 'number')
          )
        )
      );
    } else if (tab === 'lokasi') {
      host.append(
        h('div.panel', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Lokasi toko & titik delivery')),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Pilih lokasi dengan klik pada peta. Titik ini menentukan jarak ongkir dan_area_ delivery yang ditampilkan kepada pelanggan.'
            ),
            h('div.split-2', null,
              textRow('storeLat', 'Latitude', 'Diperbarui saat memilih titik pada peta', 'number'),
              textRow('storeLng', 'Longitude', 'Diperbarui saat memilih titik pada peta', 'number')
            ),
            h('div.mt-4', { id: 'map-holder', style: { height: '380px', borderRadius: 'var(--r-lg)', overflow: 'hidden', border: '1px solid var(--line)' } }),
            h('div.callout.mt-4', null,
              icon('info'),
              'Peta memakai OpenStreetMap — gratis tanpa kunci API. Pilih titik baru dengan mengeklik lokasi yang diinginkan.'
            )
          )
        )
      );

      setTimeout(() => mountMap(), 60);
    } else if (tab === 'data') {
      host.append(
        h('div.panel', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Database & data')),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Seluruh data tersimpan di perangkat ini (localStorage) dengan struktur yang sama persis seperti sheet Google: Products, Categories, Transactions, OnlineOrders, Users, Queue, dan Settings.'
            ),

            h('div.col.gap-3', null,
              h('button.btn.btn--primary', {
                onclick: async () => {
                  const res = await api.setupDatabase();
                  const m = modal((close) =>
                    h('div', null,
                      h('div.modal__head', null,
                        h('div.grow', null,
                          h('h3.t-h2', null, 'Setup database selesai'),
                          h('p.t-body', { style: { marginTop: '4px' } }, `Dibuat pada ${fmtDateTime(res.at)}`)
                        ),
                        h('button.btn.btn--icon.btn--ghost', { onclick: close }, icon('close'))
                      ),
                      h('div.modal__body', null,
                        h('div.panel', null,
                          h('div.panel__body.panel__body--flush', null,
                            res.sheets.map((sh) =>
                              h('div.list-row', null,
                                h('div.avatar.avatar--teal', null, icon('fileText')),
                                h('div.grow', null,
                                  h('div', { style: { fontWeight: '600' } }, sh.name),
                                  h('div.t-xs', null, sh.headers.join(', '))
                                ),
                                h('span.badge', null, `${sh.rows} baris`)
                              )
                            )
                          )
                        )
                      ),
                      h('div.modal__foot', null,
                        h('button.btn.btn--primary.grow', { onclick: close }, 'Selesai')
                      )
                    )
                  );
                },
              }, icon('settings'), 'Jalankan setupDatabase()'),

              h('button.btn.btn--soft', {
                onclick: async () => {
                  const json = await api.exportDatabase();
                  const ok = await copyText(json);
                  toast(ok ? 'Data disalin ke clipboard' : 'Gagal menyalin', ok ? 'ok' : 'err');
                },
              }, icon('copy'), 'Salin data (JSON)'),

              h('button.btn.btn--soft', {
                onclick: async () => {
                  const blob = new Blob([await api.exportDatabase()], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `mykasir-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                },
              }, icon('download'), 'Unduh cadangan'),

              h('button.btn.btn--soft', {
                onclick: async () => {
                  const input = h('input', { type: 'file', accept: 'application/json' });
                  input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const res = await api.importDatabase(text);
                      if (!res.ok) throw new Error(res.error || 'Gagal memulihkan data');
                      toast('Data berhasil dipulihkan', 'ok');
                      setTimeout(() => location.reload(), 700);
                    } catch (err) {
                      toast(err.message || 'Berkas tidak valid', 'err');
                    }
                  };
                  input.click();
                },
              }, icon('upload'), 'Pulihkan dari cadangan'),

              h('div.divider'),

              h('button.btn.btn--ghost', {
                style: { color: 'var(--coral)', borderColor: 'rgba(255,92,122,0.4)' },
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: 'Reset ke data contoh?',
                    body: 'Semua transaksi, produk, dan pengaturan Anda akan diganti dengan data awal.',
                    confirmLabel: 'Reset sekarang',
                  });
                  if (!ok) return;
                  await api.resetDemoData();
                  toast('Data direset', 'ok');
                  setTimeout(() => location.reload(), 700);
                },
              }, icon('refresh'), 'Reset ke data contoh')
            )
          )
        )
      );
    }
  };

  const tabs = [
    { key: 'umum', label: 'Umum', icon: 'settings' },
    { key: 'lokasi', label: 'Lokasi', icon: 'map' },
    { key: 'data', label: 'Data', icon: 'database' },
  ];

  const tabBar = h('div.sr-tabs');
  for (const t of tabs) {
    tabBar.append(
      h('button.sr-tab', {
        class: tab === t.key ? 'is-active' : '',
        onclick: (e) => {
          tab = t.key;
          tabBar.querySelectorAll('.sr-tab').forEach((el) => el.classList.toggle('is-active', el === e.currentTarget));
          render();
        },
      }, t.label)
    );
  }

  render();
  return h('div', null, tabBar, host);
}

/* -------------------------------------------------------------------------
   Point-and-click map (free OpenStreetMap)
   ---------------------------------------------------------------------- */

function mountMap() {
  const holder = document.getElementById('map-holder');
  if (!holder || holder.dataset.ready) return;
  holder.dataset.ready = '1';

  const s = settings();
  const lat = Number(s.storeLat) || -6.9147;
  const lng = Number(s.storeLng) || 107.6098;

  // Load Leaflet from the vendored copy (offline-capable).
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './vendor/leaflet.css';
  document.head.append(css);

  const script = document.createElement('script');
  script.src = './vendor/leaflet.js';
  script.onload = () => {
    const L = window.L;
    if (!L) {
      holder.append(h('div.callout.callout--warn', null, icon('alert'), 'Peta tidak dapat dimuat.'));
      return;
    }

    const map = L.map(holder, { zoomControl: true }).setView([lat, lng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      api.saveSettings({ storeLat: pos.lat, storeLng: pos.lng }).then(refreshSettings);
      toast('Lokasi toko diperbarui', 'ok', 1800);
    });

    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      api.saveSettings({ storeLat: e.latlng.lat, storeLng: e.latlng.lng }).then(refreshSettings);
      toast('Lokasi toko diperbarui', 'ok', 1800);
    });
  };
  script.onerror = () => {
    holder.append(h('div.callout.callout--warn', null, icon('alert'), 'Gagal memuat pustaka peta.'));
  };
  document.head.append(script);
}

/* ==========================================================================
   View registry
   ========================================================================== */

const viewFactory = {
  dashboard: dashboardView,
  pos: posView,
  orders: ordersView,
  queue: queueView,
  products: productsView,
  reports: reportsView,
  transactions: transactionsView,
  users: usersView,
  settings: settingsView,
};

