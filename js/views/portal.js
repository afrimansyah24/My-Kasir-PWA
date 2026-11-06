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
  fileToDataUrl, numberShort, compressForStorage, haversineKm,
  driveFileId, resolveImageSrc, JSONP_SAFE_MAX_CHARS,
} from '../util.js';
import * as api from '../api.js';
import { settings, refreshSettings } from '../settings.js';
import * as cart from '../cart.js';
import { areaChart, barChart, hBarChart, donutChart, sparkline, legend, ringChart, heatMap } from '../charts.js';
import { go, withBase, toggleTheme, currentTheme, app } from '../app.js';
import { createPickerMap } from '../map.js';
import { qrCanvas } from '../qr.js';
import { GAS_URL, readOverride, writeOverride } from '../config.js';
import { mountQueueScreen } from './queue.js';

/**
 * Sesi portal HANYA hidup di memori tab.
 *
 * Sengaja TIDAK disimpan ke localStorage: setiap kali portal dibuka, pengguna
 * harus memasukkan PIN 6 digit lagi. Ini menjaga keamanan akun owner &
 * kasir — membuka "Lihat toko" lalu kembali ke portal selalu meminta PIN.
 *
 * Menutup/memuat ulang tab otomatis mengakhiri sesi.
 */
let session = null; // { role, name, username, id }

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

  // Setiap kali portal dibuka, PIN 6 digit diminta lagi.
  //
  // Sesi sengaja tidak dipulihkan dari localStorage/sessionStorage:
  // kembali ke toko lalu klik "Portal" harus meminta PIN, bukan masuk
  // otomatis. Sesi hanya hidup selama tab ini terbuka.
  session = null;

  if (!session) {
    view.append(loginGate());
    return;
  }

  view.append(portalShell(sub));
}

/* -------------------------------------------------------------------------
   Login: PIN 6 digit -> pilih peran -> username + kata sandi
   ---------------------------------------------------------------------- */

const PIN_LENGTH = 6;

/** Daftar akun bawaan; bisa diubah owner lewat menu Pengguna. */
const DEFAULT_ACCOUNTS = [
  { username: 'owner', password: 'owner123', name: 'Owner', role: 'owner' },
  { username: 'kasir', password: 'kasir123', name: 'Kasir', role: 'kasir' },
];

function loginGate() {
  let step = 'pin';        // 'pin' | 'role' | 'form'
  let pin = '';
  let role = 'owner';

  const host = h('div.gate');
  const card = h('div.gate__card');

  const paint = () => {
    card.innerHTML = '';
    if (step === 'pin') return card.append(pinStep());
    if (step === 'role') return card.append(roleStep());
    return card.append(formStep());
  };

  /* --- langkah 1: PIN 6 digit ------------------------------------------- */
  const pinStep = () => {
    const dots = h('div.pin-display');
    const error = h('div.gate__error');

    const renderDots = () => {
      dots.innerHTML = '';
      for (let i = 0; i < PIN_LENGTH; i++) {
        dots.append(h('div', { class: `pin-dot ${i < pin.length ? 'is-filled' : ''}` }));
      }
    };

    const press = (d) => {
      if (pin.length >= PIN_LENGTH) return;
      pin += d;
      renderDots();
      error.textContent = '';

      if (pin.length === PIN_LENGTH) {
        api.verifyPortalPin(pin).then((res) => {
          if (res && res.ok) {
            step = 'role';
            paint();
            return;
          }
          error.textContent = (res && res.error) || 'PIN salah';
          pin = '';
          renderDots();
          setTimeout(() => { error.textContent = ''; }, 2400);
        });
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
      h('button.keypad__key.keypad__key--fn', {
        onclick: () => { pin = ''; renderDots(); error.textContent = ''; },
        'aria-label': 'Hapus semua',
      }, icon('refresh'))
    );

    renderDots();

    const onKey = (e) => {
      if (step !== 'pin') { document.removeEventListener('keydown', onKey); return; }
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    document.addEventListener('keydown', onKey);

    return h('div', null,
      h('div.gate__logo', null, icon('lock')),
      h('h1.t-h1', null, 'Portal Internal'),
      h('p.t-body.mt-2', null, `Masukkan PIN ${PIN_LENGTH} digit untuk membuka portal.`),
      dots,
      error,
      keypad,
      h('div.row.gap-2.mt-5', null,
        h('button.btn.btn--ghost.btn--sm.grow', { onclick: () => go('/') }, icon('arrowLeft'), 'Kembali ke toko'),
        h('button.btn.btn--ghost.btn--sm.grow', {
          onclick: () => { pin = ''; renderDots(); error.textContent = ''; },
        }, icon('refresh'), 'Bersihkan')
      )
    );
  };

  /* --- langkah 2: pilih peran ------------------------------------------ */
  const roleStep = () => {
    const roleCard = (value, title, desc, iconName) =>
      h('button.pay__opt', {
        type: 'button',
        style: { width: '100%', textAlign: 'left' },
        onclick: () => { role = value; step = 'form'; paint(); },
      },
        h('div.pay__ico', null, icon(iconName)),
        h('div.grow', null,
          h('b', null, title),
          h('span', null, desc)
        )
      );

    return h('div', null,
      h('div.gate__logo', null, icon('users')),
      h('h1.t-h1', null, 'Masuk sebagai'),
      h('p.t-body.mt-2', null, 'Pilih peran untuk membuka menu yang sesuai.'),
      h('div.pay.mt-5', null,
        roleCard('owner', 'Owner', 'Akses penuh: katalog, laporan, pengguna, pengaturan', 'user'),
        roleCard('kasir', 'Kasir', 'Kelola transaksi, pesanan, dan antrean saja', 'cash')
      ),
      h('button.btn.btn--ghost.btn--sm.grow.mt-4', {
        onclick: () => { step = 'pin'; pin = ''; paint(); },
      }, icon('arrowLeft'), 'Kembali ke PIN')
    );
  };

  /* --- langkah 3: username + kata sandi --------------------------------- */
  const formStep = () => {
    const error = h('div.gate__error');
    const userInput = h('input.input', {
      type: 'text',
      placeholder: 'Username',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: false,
      'aria-label': 'Username',
    });
    const passInput = h('input.input', {
      type: 'password',
      placeholder: 'Kata sandi',
      'aria-label': 'Kata sandi',
    });

    const submit = async () => {
      const username = userInput.value.trim();
      const password = passInput.value;
      if (!username || !password) {
        error.textContent = 'Username dan kata sandi wajib diisi';
        return;
      }
      error.textContent = '';
      const res = await api.login(username, password);
      if (!res || !res.ok) {
        error.textContent = (res && res.error) || 'Gagal masuk';
        return;
      }
      const user = res.user || {};
      if (user.role !== role) {
        error.textContent = `Akun ini bukan akun ${role === 'owner' ? 'owner' : 'kasir'}.`;
        return;
      }
      session = { role: user.role, name: user.name || user.username, username: user.username, id: user.id };
      const app = document.getElementById('app');
      app.innerHTML = '';
      app.append(portalShell(''));
      toast(`Selamat datang, ${session.name}`, 'ok');
    };

    userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passInput.focus(); });
    passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    const hint = role === 'owner'
      ? 'Akun bawaan: owner / owner123'
      : 'Akun bawaan: kasir / kasir123';

    setTimeout(() => userInput.focus(), 30);

    return h('div', null,
      h('div.gate__logo', null, icon(role === 'owner' ? 'user' : 'cash')),
      h('h1.t-h1', null, role === 'owner' ? 'Login Owner' : 'Login Kasir'),
      h('p.t-body.mt-2', null, 'Masukkan username dan kata sandi akun Anda.'),
      h('div.mt-5', null,
        h('div.field', null, h('label', null, 'Username'), userInput),
        h('div.field.mt-3', null, h('label', null, 'Kata sandi'), passInput)
      ),
      error,
      h('button.btn.btn--primary.btn--lg.grow.mt-4', { onclick: submit }, icon('login'), 'Masuk'),
      h('p.t-xs.mt-3', { style: { opacity: '0.75' } }, hint),
      h('div.row.gap-2.mt-4', null,
        h('button.btn.btn--ghost.btn--sm.grow', {
          onclick: () => { step = 'role'; paint(); },
        }, icon('arrowLeft'), 'Ganti peran'),
        h('button.btn.btn--ghost.btn--sm.grow', {
          onclick: () => { step = 'pin'; pin = ''; paint(); },
        }, icon('refresh'), 'Ulangi PIN')
      )
    );
  };

  paint();
  host.append(card);
  return host;
}

/* -------------------------------------------------------------------------
   Portal shell
   ---------------------------------------------------------------------- */

const NAV = [
  { key: 'pos', label: 'Kasir / POS', icon: 'cash', roles: ['kasir'] },
  { key: 'transactions', label: 'Transaksi', icon: 'receipt', roles: ['owner', 'kasir'] },
  { key: 'orders', label: 'Pesanan Online', icon: 'fileText', roles: ['owner', 'kasir'] },
  { key: 'queue', label: 'Antrean', icon: 'list', roles: ['owner', 'kasir'] },
  { key: 'dashboard', label: 'Dashboard', icon: 'chart', roles: ['owner'] },
  { key: 'reports', label: 'Laporan', icon: 'wallet', roles: ['owner'] },
  { key: 'products', label: 'Katalog & Stok', icon: 'box', roles: ['owner'] },
  { key: 'users', label: 'Pengguna', icon: 'users', roles: ['owner'] },
  { key: 'settings', label: 'Pengaturan', icon: 'settings', roles: ['owner'] },
];

/** Menu default untuk tiap peran (kasir langsung ke POS). */
const DEFAULT_VIEW = { owner: 'dashboard', kasir: 'pos' };

function portalShell(active = '') {
  const shell = h('div.portal');
  const nav = h('aside.rail-nav');
  const main = h('main.portal__main');

  // Cache view per sesi: pindah menu tidak memuat ulang data dari server.
  const viewCache = new Map();

  // Menu yang boleh dibuka depends peran; kasir hanya melihat menu operasional.
  const allowed = NAV.filter((n) => n.roles.includes(session.role)).map((n) => n.key);
  let current = allowed.includes(active)
    ? active
    : (DEFAULT_VIEW[session.role] || allowed[0] || 'pos');

  const body = h('div.portal__body');
  const titleEl = h('h1.t-h2');
  const subEl = h('div.t-sm');

  const renderNav = () => {
    nav.innerHTML = '';
    const logo = settings().storeLogo;
    nav.append(
      h('div.rail-nav__brand', null,
        h('a.brand', { href: withBase('/') },
          h('span.brand__mark', { class: 'brand__mark--img' },
            logo
              ? h('img', { src: resolveImageSrc(logo), alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' } })
              : icon('store')
          ),
          h('span', null, settings().storeName || 'My Kasir')
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
            // Bersihkan sisa sesi lama (versi sebelum sesi di-memory-only).
            try { localStorage.removeItem('mykasir.role'); } catch { /* ignore */ }
            try { sessionStorage.removeItem('mykasir.role'); } catch { /* ignore */ }
            go('/');
          },
        }, icon('logout'), 'Keluar')
      )
    );
  };

  const renderView = () => {
    const item = NAV.find((n) => n.key === current);
    titleEl.textContent = item?.label || 'Portal';

    // Kasir tidak boleh membuka menu owner walau URL/riwayat menyodorkannya.
    if (!allowed.includes(current)) {
      current = DEFAULT_VIEW[session.role] || allowed[0] || 'pos';
      titleEl.textContent = NAV.find((n) => n.key === current)?.label || 'Portal';
    }

    // View yang sudah pernah dibuat disimpan di DOM lalu hanya
    // disembunyikan/ditampilkan. Perpindahan menu jadi instan dan state di
    // dalamnya (pencarian POS, filter, dsb.) tetap utuh.
    const cached = viewCache.get(current);
    if (cached) {
      showView(cached);
      return;
    }

    body.innerHTML = '';
    const loadingRow = h('div.row.gap-2.mb-4', null, h('span.spinner'), h('span.t-sm', null, 'Memuat…'));
    body.append(loadingRow);

    // Failsafe: jangan pernah membiarkan layar "Memuat…" menggantung.
    //
    // Batasnya 30 detik, bukan 12: satu eksekusi Apps Script bisa memakan
    // 2-4 detik, dan beberapa permintaan berbaris bisa menambah itu. Batas
    // 12 detik membuat pesan "server lambat merespons" muncul padahal
    // server sebenarnya sedang bekerja.
    let settled = false;
    const failsafe = setTimeout(() => {
      if (settled) return;
      settled = true;
      body.innerHTML = '';
      body.append(
        h('div.row.gap-2.mb-4', null, h('span.spinner'), h('span.t-sm', null, 'Server lambat merespons…')),
        h('div.row.gap-2', null,
          h('button.btn.btn--primary', {
            onclick: () => {
              viewCache.delete(current);
              renderView();
            },
          }, icon('refresh'), 'Coba lagi'),
          h('button.btn.btn--ghost', {
            onclick: () => api.bustCache(),
          }, 'Bersihkan cache')
        )
      );
    }, 30_000);

    Promise.resolve(viewFactory[current]?.())
      .then((node) => {
        if (settled) return;
        settled = true;
        clearTimeout(failsafe);
        if (!node) throw new Error('Menu tidak tersedia');
        viewCache.set(current, node);
        showView(node);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(failsafe);
        console.error(err);
        body.innerHTML = '';
        body.append(
          emptyState('alert', 'Gagal memuat', err.message || 'Terjadi kesalahan.'),
          h('div.row.gap-2.mt-3', { style: { justifyContent: 'center' } },
            h('button.btn.btn--primary', {
              onclick: () => {
                viewCache.delete(current);
                renderView();
              },
            }, icon('refresh'), 'Coba lagi')
          )
        );
      });
  };

  /** Tampilkan satu view dan sembunyikan view lain yang sudah terpasang. */
  const showView = (node) => {
    body.querySelectorAll('.portal__pane').forEach((el) => {
      el.hidden = el !== node;
    });
    if (!node.classList.contains('portal__pane')) {
      node.classList.add('portal__pane');
    }
    if (!node.parentElement) body.append(node);
    node.hidden = false;
  };

  main.append(
    h('div.portal__top', null,
      h('button.btn.btn--icon.btn--ghost.rail-toggle', {
        'aria-label': 'Menu',
        onclick: () => nav.classList.toggle('is-open'),
      }, icon('list')),
      h('div.grow', null, titleEl, subEl),
      h('div.row.gap-2', null,
        // Segarkan manual: buang cache + muat ulang view yang sedang aktif.
        h('button.btn.btn--icon.btn--ghost', {
          'aria-label': 'Segarkan data',
          title: 'Segarkan data dari server',
          onclick: async (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            btn.classList.add('is-spinning');
            try {
              api.bustCache();
              await refreshSettings();
              viewCache.delete(current);     // paksa render ulang dari server
              renderView();
              toast('Data disegarkan', 'ok', 1400);
            } catch (err) {
              toast(err.message || 'Gagal menyegarkan data', 'err');
            } finally {
              setTimeout(() => {
                btn.disabled = false;
                btn.classList.remove('is-spinning');
              }, 700);
            }
          },
        }, icon('refresh')),
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
  // Ambil dashboard & transaksi BERSAMAAN — di mode GAS keduanya jadi satu
  // permintaan (bundle), jadi hanya 1 eksekusi Apps Script.
  const [data, transactions] = await Promise.all([
    api.getDashboardData(14),
    api.getTransactions(),
  ]);
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
          transactions.slice(0, 6).map((t) =>
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

      // QR yang ditampilkan saat metode QRIS dipilih.
      const qrisBox = h('div.mt-4', { style: { textAlign: 'center' } });
      const buildQris = () => {
        qrisBox.innerHTML = '';
        // `settings` di sini adalah snapshot pengaturan milik posView.
        if (settings.qrisImage) {
          // Foto QRIS hasil unggahan owner di Pengaturan → Logo & QRIS.
          qrisBox.append(
            h('div', null,
              h('img', {
                src: resolveImageSrc(settings.qrisImage),
                alt: 'QRIS',
                style: { width: '240px', maxWidth: '80%', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' },
              }),
              h('div.t-xs.mt-2', { style: { opacity: '0.75' } }, 'Pindai dengan aplikasi e-wallet/bank apa pun')
            )
          );
          return;
        }
        // Fallback: QRIS dinamis dari payload EMV.
        const payload = api.buildQrisPayload(`POS-${Date.now().toString(36).toUpperCase()}`, c.total);
        qrisBox.append(
          h('div', null,
            qrCanvas(payload, { size: 200 }),
            h('div.t-xs.mt-2', { style: { opacity: '0.75' } },
              'QRIS dinamis · nominal ', h('b', null, rupiah(c.total)),
              ' — unggah foto QRIS di Pengaturan agar tampil QR statis toko Anda'
            )
          )
        );
      };

      function sync() {
        cashOpt.classList.toggle('is-active', method === 'Cash');
        qrisOpt.classList.toggle('is-active', method === 'QRIS');
        cashField.classList.toggle('hidden', method !== 'Cash');
        qrisBox.classList.toggle('hidden', method !== 'QRIS');
        if (method === 'QRIS' && !qrisBox.dataset.built) {
          qrisBox.dataset.built = '1';
          buildQris();
        }
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
          qrisBox,
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
  const holder = h('div', {
    style: {
      background: '#fff', padding: '12px', borderRadius: 'var(--r-md)',
      border: '1px solid var(--line)', maxWidth: '340px', margin: '0 auto',
      textAlign: 'center',
    },
  }, h('div.row.gap-2', { style: { justifyContent: 'center' } }, h('span.spinner'), h('span.t-sm', null, 'Menyiapkan struk…')));

  let cv = null;

  modal((close) => h('div', null,
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
          if (!cv) {
            toast('Struk belum siap', 'warn');
            return;
          }
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
  ));

  // struk baru digambar setelah logo dimuat (async)
  cart.receiptCanvas(receipt, { width: 320 }).then((canvas) => {
    cv = canvas;
    holder.innerHTML = '';
    holder.append(canvas);
  }).catch((err) => {
    holder.innerHTML = '';
    holder.append(h('div.callout.callout--warn', null, icon('alert'), err.message || 'Struk gagal dibuat'));
  });
}

/* ==========================================================================
   Online orders
   ========================================================================== */

async function ordersView() {
  const orders = await api.getOnlineOrders();
  const settingsNow = await api.getSettings();

  let couriers = [];
  try {
    const raw = settingsNow?.couriers;
    couriers = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    if (!Array.isArray(couriers)) couriers = [];
  } catch { couriers = []; }

  const tabs = [
    { key: 'all', label: 'Semua' },
    { key: 'pending', label: 'Menunggu bayar' },
    { key: 'paid', label: 'Terbayar' },
    { key: 'preparing', label: 'Diproses' },
    { key: 'ready', label: 'Siap' },
    { key: 'delivering', label: 'Diantar' },
    { key: 'cancelled', label: 'Batal' },
  ];
  let tab = 'all';

  const listHost = h('div');

  const badgeFor = (o) => {
    if (o.status === 'cancelled') return h('span.badge.badge--err', null, 'Kedaluwarsa');
    if (o.status === 'pending') return h('span.badge.badge--warn', null, 'Menunggu bayar');
    if (o.status === 'paid') return h('span.badge.badge--info', null, 'Terbayar');
    if (o.status === 'preparing') return h('span.badge.badge--violet', null, 'Diproses');
    if (o.status === 'delivering') return h('span.badge.badge--info', null, 'Diantar');
    return h('span.badge.badge--ok', null, 'Siap');
  };

  /** Detail item pesanan (untuk kasir melihat apa yang dipesan). */
  const itemsDetail = (o) =>
    h('div.col.gap-1.mt-2', null,
      o.items.map((it) =>
        h('div.row-between', { style: { fontSize: '12.5px' } },
          h('span', null, `${it.qty}× ${it.name}`),
          h('span.t-mono', { style: { fontWeight: '600' } }, rupiah(it.total ?? it.price * it.qty))
        )
      ),
      o.note ? h('div.t-xs', { style: { marginTop: '4px', fontStyle: 'italic' } }, `Catatan: ${o.note}`) : null,
      o.customer ? h('div.t-xs', { style: { marginTop: '4px' } },
        `Pelanggan: ${o.customer}${o.phone ? ` · ${o.phone}` : ''}`
      ) : null,
      o.fulfilment === 'delivery' && o.address
        ? h('div.t-xs', { style: { marginTop: '2px' } }, `Alamat: ${o.address}`)
        : null,
      o.courier
        ? h('div.t-xs', { style: { marginTop: '2px' } }, `Kurir: ${o.courier}${o.courierPhone ? ` · ${o.courierPhone}` : ''}`)
        : null
    );

  /** Modal: pilih kurir sebelum menandai pesanan sedang diantar. */
  const pickCourier = (o) => {
    modal((close) => {
      const nameInput = h('input.input', { type: 'text', placeholder: 'Nama kurir' });
      const phoneInput = h('input.input', { type: 'tel', placeholder: 'Nomor telepon kurir' });

      const submit = async () => {
        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();
        if (!name) {
          toast('Nama kurir wajib diisi', 'warn');
          return;
        }
        const res = await api.setOrderStatus(o.code, 'delivering', { courier: name, courierPhone: phone });
        if (!res || res.ok === false) {
          toast(res?.error || 'Gagal mengubah status', 'err');
          return;
        }
        toast('Kurir ditugaskan', 'ok');
        close();
        refresh();
      };

      const preset = couriers.length
        ? h('div.col.gap-2.mb-4', null,
          h('div.t-xs', { style: { fontWeight: '600' } }, 'Pilih dari daftar kurir'),
          couriers.map((c) =>
            h('button.pick__opt', {
              type: 'button',
              onclick: () => {
                nameInput.value = c.name || '';
                phoneInput.value = c.phone || '';
              },
            },
              icon('truck'),
              h('b', null, c.name),
              h('span', null, c.phone || 'Tanpa nomor')
            )
          )
        )
        : h('div.callout.callout--warn.mb-4', null,
          icon('info'),
          'Belum ada daftar kurir. Owner bisa menambahkannya di Pengaturan → Kurir. Isi manual bila perlu.'
        );

      return h('div', null,
        h('div.modal__head', null,
          h('div.grow', null,
            h('h3.t-h2', null, 'Tugaskan kurir'),
            h('p.t-body', { style: { marginTop: '4px' } }, `Pesanan ${o.code} — ${o.customer || 'tanpa nama'}`)
          ),
          h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
        ),
        h('div.modal__body', null,
          preset,
          h('div.field', null, h('label', null, 'Nama kurir'), nameInput),
          h('div.field.mt-3', null, h('label', null, 'Nomor telepon kurir'), phoneInput)
        ),
        h('div.modal__foot', null,
          h('button.btn.btn--ghost.grow', { onclick: close }, 'Batal'),
          h('button.btn.btn--primary.grow', { onclick: submit }, icon('send'), 'Tandai diantar')
        )
      );
    });
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
                ),
                itemsDetail(o)
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
                  }, 'Tandai siap') : null,
                  o.status === 'ready' && o.fulfilment === 'delivery' ? h('button.btn.btn--sm.btn--soft', {
                    onclick: () => pickCourier(o),
                  }, icon('truck'), 'Tugaskan kurir') : null,
                  o.status === 'delivering' ? h('button.btn.btn--sm.btn--ghost', {
                    onclick: async () => { await api.setOrderStatus(o.code, 'ready'); refresh(); },
                  }, 'Selesai diantar') : null
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

  // Auto-refresh: pesanan online berubah dari sisi pelanggan. Polling
  // ringan (12 detik) + berhenti saat tab disembunyikan supaya tidak
  // membebani Apps Script.
  let pollTimer = null;
  const onVisibility = () => {
    if (document.hidden) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    } else {
      startPolling();
      refresh();
    }
  };
  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      // JANGAN bustCache() di sini.
      //
      // bustCache() membuang seluruh cache L1+L2 dan memaksa semua baca
      // berikutnya menembak server. Dipanggil tiap 12 detik, itu membuat
      // aplikasi "memuat terus" dan membebani Apps Script.
      //
      // `refresh()` sudah cukup: entri cache yang basi direvalidasi di
      // latar belakang, jadi data tetap real time tanpa membuang cache.
      refresh();
    }, 12000);
  };

  document.addEventListener('visibilitychange', onVisibility);
  startPolling();

  // Berhenti polling saat view dilepas (pindah menu).
  app.onLeave = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
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
            h('p.t-body', { style: { marginTop: '4px' } }, isNew ? 'Kasir baru masuk memakai username & kata sandi yang Anda tentukan' : draft.name)
          ),
          h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
        ),
        h('div.modal__body', null,
          h('div.field', null, h('label', null, 'Nama lengkap'), nameInput),
          h('div.field.mt-3', null, h('label', null, 'Username'), userInput),
          h('div.field.mt-3', null,
            h('label', null, 'Kata sandi'),
            passInput,
            h('div.field__hint', null, 'Owner dapat mengubah kata sandi pengguna ini kapan saja lewat tombol "Ubah".')
          ),
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
  let tab = 'umum';
  const host = h('div');

  /* ------------------------------------------------------------------
     Model draf.

     Semua perubahan Settings dikumpulkan di sini dan HANYA ditulis ke
     Spreadsheet saat tombol "Simpan" ditekan. Efeknya:
       - tidak ada request sia-sia setiap kali field disentuh,
       - label "terakhir disimpan" tidak pernah berubah sendiri,
         hanya setelah penyimpanan benar-benar berhasil.
     ---------------------------------------------------------------- */
  const draft = { ...s };
  const dirty = new Set();

  const SAVED_AT_KEY = 'mykasir.settings.savedAt';

  const savedLabel = h('div.t-xs', {
    style: { marginTop: '2px', opacity: '0.75' },
  });

  const dirtyLabel = h('span.t-xs', {
    style: { fontWeight: '600' },
  });

  const saveBtn = h('button.btn.btn--primary', {
    type: 'button',
    onclick: () => save(),
  }, icon('check'), 'Simpan perubahan');

  const updateSaveState = () => {
    const n = dirty.size;
    saveBtn.disabled = n === 0;
    dirtyLabel.textContent = n
      ? `${n} perubahan belum disimpan`
      : 'Semua perubahan tersimpan';
    dirtyLabel.style.color = n ? 'var(--amber, #d97706)' : 'var(--ink-400)';
  };

  const markDirty = (key) => {
    dirty.add(key);
    updateSaveState();
  };

  /**
   * Ubah nilai draf hanya bila benar-benar berbeda dari nilai tersimpan.
   *
   * Perbandingan dilakukan pada bentuk yang sudah dinormalisasi (angka ->
   * number, teks -> string trimmed). Tanpa ini, nilai yang berubah tipe
   * (mis. "−6.12" dari server menjadi -6.12 dari peta) dianggap sama dan
   * perubahan tidak pernah masuk draf -> tersimpan tetap nilai lama.
   */
  const normalizeValue = (v) => {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined || v === '') return '';
    const num = Number(v);
    if (Number.isFinite(num) && String(v).trim() !== '') return num;
    return String(v).trim();
  };

  const setDraft = (key, value) => {
    const next = normalizeValue(value);
    if (normalizeValue(draft[key]) === next) return;
    draft[key] = next;
    markDirty(key);
  };

  // Stempel "terakhir disimpan" disimpan di perangkat agar tidak berubah
  // saat halaman di-refresh — hanya berubah setelah penyimpanan nyata.
  let savedAt = 0;
  try {
    savedAt = Number(localStorage.getItem(SAVED_AT_KEY) || 0) || 0;
  } catch { /* ignore */ }
  savedLabel.textContent = savedAt
    ? `Terakhir disimpan: ${fmtDateTime(savedAt)}`
    : 'Belum ada penyimpanan pada perangkat ini';

  const save = async () => {
    if (!dirty.size) return;
    saveBtn.disabled = true;
    try {
      const patch = {};
      for (const key of dirty) patch[key] = draft[key];

      const res = await api.saveSettings(patch);
      if (res && res.ok === false) {
        toast(res.error || 'Gagal menyimpan pengaturan', 'err');
        return;
      }

      Object.assign(s, patch);
      dirty.clear();

      savedAt = Date.now();
      try { localStorage.setItem(SAVED_AT_KEY, String(savedAt)); } catch { /* ignore */ }
      savedLabel.textContent = `Terakhir disimpan: ${fmtDateTime(savedAt)}`;

      await refreshSettings();
      updateSaveState();
      toast('Pengaturan disimpan', 'ok');
    } catch (err) {
      toast(err.message || 'Gagal menyimpan pengaturan', 'err');
    } finally {
      saveBtn.disabled = false;
      updateSaveState();
    }
  };

  const switchRow = (key, label, hint) => {
    const input = h('input', { type: 'checkbox', checked: !!draft[key] });
    input.addEventListener('change', () => {
      if (!!draft[key] === input.checked) return;
      setDraft(key, input.checked);
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
    const input = h('input.input', { type, value: draft[key] ?? '' });
    input.addEventListener('input', () => {
      setDraft(key, type === 'number' ? (Number(input.value) || 0) : input.value);
    });
    return h('div.field', null,
      h('label', null, label),
      input,
      hint ? h('div.field__hint', null, hint) : null
    );
  };

  /**
   * Baris upload gambar (logo toko / foto QRIS).
   * Gambar dikompres dulu supaya muat di satu sel Spreadsheet.
   *
   * Berkas yang dipilih langsung tampil di preview, tetapi BARU ditulis ke
   * Spreadsheet setelah tombol "Simpan perubahan" ditekan.
   */
  /**
   * Baris pengaturan gambar.
   *
   * Tiga cara supplying gambar:
   *   1. Unggah berkas  -> dikompres. Bila hasilnya masih terlalu besar
   *      untuk dikirim lewat JSONP, otomatis dikirim ke Google Drive dan
   *      yang disimpan di Spreadsheet hanya KODE FILE-nya.
   *   2. Tempel kode file Google Drive (atau URL Drive) -> dipakai langsung.
   *   3. Tempel URL gambar biasa -> dipakai langsung.
   */
  const imageRow = (key, label, hint, { square = false, maxSize = 640 } = {}) => {
    const preview = h('div.img-preview', {
      style: square
        ? { width: '72px', height: '72px', borderRadius: 'var(--r-md)' }
        : { width: '148px', height: '148px', borderRadius: 'var(--r-md)' },
    });

    const fileInput = h('input', { type: 'file', accept: 'image/*' });
    fileInput.style.display = 'none';

    const removeBtn = h('button.btn.btn--sm.btn--ghost', {
      onclick: () => {
        preview.innerHTML = '';
        setDraft(key, '');
        removeBtn.style.display = 'none';
        driveInput.value = '';
        toast(`${label} siap dihapus`, 'ok', 1600);
      },
    }, icon('close'), 'Hapus');

    const paint = () => {
      preview.innerHTML = '';
      const v = draft[key] || '';
      if (v) {
        preview.append(h('img', { src: resolveImageSrc(v), alt: label }));
        removeBtn.style.display = '';
      } else {
        removeBtn.style.display = 'none';
      }
    };

    paint();

    /* --- Kolom kode file Google Drive ---------------------------------- */
    const driveInput = h('input.input', {
      type: 'text',
      placeholder: 'Kode file Google Drive (atau URL Drive)',
      autocomplete: 'off',
    });
    driveInput.value = '';

    const applyDrive = () => {
      const raw = driveInput.value.trim();
      if (!raw) return;
      const id = driveFileId(raw);
      if (!id) {
        toast('Kode file Google Drive tidak dikenali', 'err');
        return;
      }
      setDraft(key, id);
      paint();
      toast(`${label} memakai file Google Drive`, 'ok', 1600);
    };
    driveInput.addEventListener('change', applyDrive);

    const doUpload = async (file) => {
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        toast('Berkas harus berupa gambar', 'err');
        return;
      }
      const busy = toast('Mengunggah gambar…', 'info', 60000);
      try {
        const dataUrl = await compressForStorage(file, { maxSize });

        // Kirim ke Google Drive bila data-URL terlalu besar untuk JSONP.
        // Batas URL browser ±32.000 karakter; data-URL di-URL-encode jadi
        // ±33% lebih panjang, jadi simpan batasnya di 16.000 karakter.
        if (dataUrl.length > JSONP_SAFE_MAX_CHARS) {
          const res = await api.uploadImageToDrive(dataUrl, `${key}-${Date.now()}`);
          if (res && res.ok && res.fileId) {
            setDraft(key, res.fileId);
            paint();
            toast(`${label} disimpan di Google Drive`, 'ok', 2200);
            return;
          }
          // Backend gagal menyimpan, TAPI mungkin file sudah terlanjur
          // dibuat (hanya berbagi gagal). Tampilkan kode filenya agar owner
          // bisa membagikannya manual.
          if (res && res.fileId) {
            driveInput.value = res.fileId;
            setDraft(key, res.fileId);
            paint();
            toast(res.error || 'Bagikan file ini manual di Google Drive', 'err', 7000);
            return;
          }
          // Drive gagal -> tetap coba simpan lokal (kecilkan lagi).
          const smaller = await compressForStorage(file, { maxSize: 320, quality: 0.6, maxBytes: 14_000 });
          if (smaller.length <= JSONP_SAFE_MAX_CHARS) {
            setDraft(key, smaller);
            paint();
            toast(`${label} siap disimpan`, 'ok', 1600);
            return;
          }
          toast('Gambar terlalu besar. Tempel kode file Google Drive.', 'err', 4200);
          return;
        }

        setDraft(key, dataUrl);
        paint();
        toast(`${label} siap disimpan`, 'ok', 1600);
      } catch (err) {
        toast(err.message || 'Gagal mengunggah gambar', 'err');
      }
    };

    fileInput.addEventListener('change', () => doUpload(fileInput.files?.[0]));
    preview.addEventListener('click', () => fileInput.click());

    return h('div.field', null,
      h('label', null, label),
      h('div.row.gap-3', { style: { alignItems: 'flex-start' } },
        preview,
        h('div.grow', null,
          h('div.t-xs', null, hint),
          h('div.row.gap-2.mt-3', null,
            h('button.btn.btn--sm.btn--soft', { onclick: () => fileInput.click() }, icon('upload'), 'Pilih gambar'),
            removeBtn
          ),
          h('div.mt-3', null,
            h('label.t-xs', null, 'Atau gunakan Google Drive'),
            h('div.row.gap-2', { style: { alignItems: 'center' } },
              h('div.grow', null, driveInput),
              h('button.btn.btn--sm.btn--ghost', {
                type: 'button',
                onclick: applyDrive,
              }, icon('check'), 'Pakai')
            ),
            h('div.field__hint', null,
              'Cara mudah: unggah gambar ke Google Drive, klik kanan > Bagikan > ' +
              'Siapa saja yang memiliki link > Viewer, lalu salin tautannya ' +
              '(atau kode file di akhir URL) dan tempel di sini.'
            ),
            h('div.callout.mt-3', null,
              icon('info'),
              'Kode file Google Drive hanya kode file saja (bukan tautan penuh). ' +
              'Contoh kode: 1AbCdEfGhIjKlMnOpQrStUvWxYz'
            )
          )
        )
      ),
      fileInput
    );
  };

  /**
   * Daftar kurir (dipakai kasir saat menugaskan kurir).
   * Disimpan sebagai JSON string agar cocok dengan sheet Settings.
   */
  const courierRow = () => {
    let list = [];
    try {
      const raw = draft.couriers;
      list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
      if (!Array.isArray(list)) list = [];
    } catch { list = []; }

    const listHost = h('div.col.gap-2');
    const nameInput = h('input.input', { type: 'text', placeholder: 'Nama kurir' });
    const phoneInput = h('input.input', { type: 'tel', placeholder: 'Nomor telepon (mis. 0812-3456-7890)' });

    const syncDraft = () => {
      setDraft('couriers', JSON.stringify(list));
    };

    const renderList = () => {
      listHost.innerHTML = '';
      if (!list.length) {
        listHost.append(h('div.t-xs', { style: { opacity: '0.7' } }, 'Belum ada kurir. Tambahkan minimal satu agar kasir bisa menugaskan kurir.'));
        return;
      }
      list.forEach((c, i) => {
        listHost.append(
          h('div.list-row', null,
            h('div.avatar', null, icon('truck')),
            h('div.grow', null,
              h('div', { style: { fontSize: '13.5px', fontWeight: '600' } }, c.name),
              h('div.t-xs', null, c.phone || 'Tanpa nomor telepon')
            ),
            h('button.btn.btn--sm.btn--icon.btn--ghost', {
              'aria-label': 'Hapus kurir',
              onclick: () => {
                list.splice(i, 1);
                syncDraft();
                renderList();
              },
            }, icon('close'))
          )
        );
      });
    };

    const add = () => {
      const name = nameInput.value.trim();
      const phone = phoneInput.value.trim();
      if (!name) {
        toast('Nama kurir wajib diisi', 'warn');
        return;
      }
      list.push({ name, phone });
      nameInput.value = '';
      phoneInput.value = '';
      syncDraft();
      renderList();
    };

    renderList();

    return h('div', null,
      listHost,
      h('div.row.gap-2.mt-3', null,
        h('div.grow', null, nameInput),
        h('div.grow', null, phoneInput)
      ),
      h('button.btn.btn--sm.btn--soft.mt-3', { onclick: add }, icon('plus'), 'Tambah kurir')
    );
  };

  const render = () => {
    host.innerHTML = '';

    if (tab === 'umum') {
      host.append(
        h('div.callout.mb-4', null,
          icon('info'),
          api.mode === 'gas'
            ? 'Mode server aktif — data dibaca & ditulis ke Google Spreadsheet.'
            : 'Server belum terhubung — isi GAS_URL di js/config.js untuk memakai Google Spreadsheet.'
        ),

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
              textRow('deliveryFee', 'Ongkir flat (Rp)', 'Dipakai bila tarif per km kosong', 'number'),
              h('div.mt-3', null, textRow('deliveryPerKm', 'Ongkir per km (Rp)', 'Isi > 0 untuk ongkir otomatis sesuai jarak', 'number')),
              h('div.mt-3', null, textRow('deliveryRadiusKm', 'Radius delivery (km)', 'Batas jarak pengiriman; 0 = tanpa batas', 'number')),
              h('div.mt-3', null, textRow('qrisMerchant', 'Nama merchants QRIS', 'Ditampilkan di struk')),
              h('div.mt-3', null, textRow('qrisNmid', 'NMID QRIS', 'Nomor merchants dinamis')),
              h('div.mt-3', null, textRow('portalPin', 'PIN portal', 'PIN 6 digit untuk membuka portal internal', 'text'))
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
      // Tampilkan koordinat yang benar-benar valid (data rusak disamarkan).
      // Baca dari DRAFT supaya perubahan belum disimpan tidak hilang saat
      // tab dipindah.
      // Helper: koordinat valid atau null. `|| fallback` TIDAK boleh dipakai
      // di sini — nilai 0 (bujur nol) adalah koordinat sah dan akan tertimpa
      // titik awal bila memakai `||`.
      const readCoord = (raw, limit) => {
        if (raw === null || raw === undefined || raw === '') return null;
        const num = Number(raw);
        if (!Number.isFinite(num)) return null;
        if (Math.abs(num) > limit) return null;
        return num;
      };

      const initLat = readCoord(draft.storeLat, 90);
      const initLng = readCoord(draft.storeLng, 180);
      // Bila lokasi belum pernah diatur, input dikosongkan — BUKAN diisi titik
      // tengah peta. Kalau diisi, owner bisa saja tanpa sengaja menyimpan
      // koordinat titik tengah peta sebagai lokasi toko.
      const hasPoint = initLat !== null && initLng !== null;
      const startLat = initLat ?? -6.9147;   // hanya titik awal peta
      const startLng = initLng ?? 107.6098;
      const initRadius = Number(draft.deliveryRadiusKm);
      const startRadius = Number.isFinite(initRadius) ? initRadius : 0;

      const latInput = h('input.input', {
        type: 'number',
        value: hasPoint ? initLat : '',
        step: 'any',
        placeholder: 'contoh: -6.9147',
      });
      const lngInput = h('input.input', {
        type: 'number',
        value: hasPoint ? initLng : '',
        step: 'any',
        placeholder: 'contoh: 107.6098',
      });
      const radiusInput = h('input.input', { type: 'number', value: startRadius, step: '0.1', min: '0' });
      const coordLabel = h('div.t-xs', { style: { marginTop: '6px', opacity: '0.75' } });
      coordLabel.textContent = hasPoint
        ? `Titik toko: ${initLat.toFixed(6)}, ${initLng.toFixed(6)}`
        : 'Lokasi toko belum diatur — ketuk peta atau isi koordinat di bawah.';

      const picker = createPickerMap({
        lat: startLat,
        lng: startLng,
        zoom: 15,
        radiusKm: startRadius,
        height: 400,
        onChange: ({ lat, lng }) => {
          latInput.value = lat.toFixed(6);
          lngInput.value = lng.toFixed(6);
          coordLabel.textContent = `Titik toko: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          // Langsung masukkan ke draf: pin yang digeser HARUS ikut tersimpan
          // saat tombol Simpan ditekan. Sebelumnya perubahan ini hanya
          // mengisi input, sehingga draf tetap berisi koordinat lama.
          setDraft('storeLat', lat);
          setDraft('storeLng', lng);
        },
      });

      const savePoint = () => {
        const lat = Number(latInput.value);
        const lng = Number(lngInput.value);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)
          || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          toast('Koordinat tidak valid', 'err');
          return;
        }
        setDraft('storeLat', lat);
        setDraft('storeLng', lng);
        coordLabel.textContent = `Titik toko: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      };

      latInput.addEventListener('change', () => {
        picker.setPoint(latInput.value, lngInput.value);
        savePoint();
      });
      lngInput.addEventListener('change', () => {
        picker.setPoint(latInput.value, lngInput.value);
        savePoint();
      });
      radiusInput.addEventListener('change', () => {
        const km = Number(radiusInput.value);
        const safeKm = Number.isFinite(km) ? km : 0;
        picker.setRadius(safeKm);
        setDraft('deliveryRadiusKm', safeKm);
      });

      host.append(
        h('div.panel', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Lokasi toko & titik delivery')),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Ketuk / klik pada peta untuk menandai lokasi toko, atau seret pinnya. Titik ini menjadi acuan jarak ongkir dan batas radius layanan.'
            ),
            h('div.split-2', null,
              h('div.field', null, h('label', null, 'Latitude'), latInput),
              h('div.field', null, h('label', null, 'Longitude'), lngInput)
            ),
            coordLabel,
            h('div.mt-4', null, picker.el),
            h('div.field.mt-4', null,
              h('label', null, 'Radius layanan (km)'),
              radiusInput,
              h('div.field__hint', null, 'Lingkaran biru pada peta adalah area layanan. 0 = tanpa batas jarak. Kasir/pelanggan otomatis ditolak bila titik tujuan di luar radius.')
            ),
            h('div.row.gap-2.mt-3', null,
              h('button.btn.btn--soft', {
                onclick: () => {
                  navigator.geolocation?.getCurrentPosition((pos) => {
                    const { latitude, longitude } = pos.coords;
                    latInput.value = latitude.toFixed(6);
                    lngInput.value = longitude.toFixed(6);
                    picker.setPoint(latitude, longitude);
                    savePoint();
                  }, () => toast('Lokasi GPS tidak dapat diakses', 'err'));
                },
              }, icon('navigation'), 'Gunakan GPS saya')
            ),
            h('div.callout.mt-4', null,
              icon('info'),
              'Peta memakai OpenStreetMap — gratis tanpa kunci API, bisa dipakai untuk produksi.'
            )
          )
        )
      );
    } else if (tab === 'tampilan') {
      /* --- Tampilan toko online ---------------------------------------- */
      const titleInput = h('input.input', {
        type: 'text',
        value: draft.heroTitle || '',
        placeholder: 'Belanja mudah,',
      });
      const highlightInput = h('input.input', {
        type: 'text',
        value: draft.heroTitleHighlight || '',
        placeholder: 'produk pilihan',
      });
      const subtitleInput = h('textarea.input', {
        rows: '3',
        placeholder: 'Pilih produk favorit Anda, tentukan pengiriman, dan lacak pesanan Anda dengan kode sederhana.',
      });
      subtitleInput.value = draft.heroSubtitle || '';

      const badgeInput = h('input.input', {
        type: 'text',
        value: draft.heroBadgeText || '',
        placeholder: 'Belanja tanpa ribet, kirim hari ini',
      });
      const ctaInput = h('input.input', {
        type: 'text',
        value: draft.heroButtonText || '',
        placeholder: 'Lihat katalog',
      });
      const trackInput = h('input.input', {
        type: 'text',
        value: draft.heroTrackButtonText || '',
        placeholder: 'Lacak pesanan',
      });
      const footerInput = h('textarea.input', { rows: '2' });
      footerInput.value = draft.footerNote || '';

      titleInput.addEventListener('input', () => setDraft('heroTitle', titleInput.value));
      highlightInput.addEventListener('input', () => setDraft('heroTitleHighlight', highlightInput.value));
      subtitleInput.addEventListener('input', () => setDraft('heroSubtitle', subtitleInput.value));
      badgeInput.addEventListener('input', () => setDraft('heroBadgeText', badgeInput.value));
      ctaInput.addEventListener('input', () => setDraft('heroButtonText', ctaInput.value));
      trackInput.addEventListener('input', () => setDraft('heroTrackButtonText', trackInput.value));
      footerInput.addEventListener('input', () => setDraft('footerNote', footerInput.value));

      const badgeToggle = h('input', { type: 'checkbox' });
      badgeToggle.checked = String(draft.heroShowBadge ?? 'true') !== 'false';
      badgeToggle.addEventListener('change', () => setDraft('heroShowBadge', badgeToggle.checked ? 'true' : 'false'));

      const statsToggle = h('input', { type: 'checkbox' });
      statsToggle.checked = String(draft.heroShowStats ?? 'true') !== 'false';
      statsToggle.addEventListener('change', () => setDraft('heroShowStats', statsToggle.checked ? 'true' : 'false'));

      host.append(
        h('div.panel', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Tampilan toko online')),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Atur kalimat dan gambar yang tampil di bagian atas toko online. ' +
              'Semua kolom opsional — yang dikosongkan memakai teks bawaan yang umum, sehingga toko ini ' +
              'bukan terkunci ke satu jenis produk.'
            ),

            h('div.field', null,
              h('label', null, 'Judul utama (bagian sebelum kata bergradien)'),
              titleInput,
              h('div.field__hint', null, 'Contoh: "Belanja mudah,"')
            ),

            h('div.field.mt-3', null,
              h('label', null, 'Kata bergradien'),
              highlightInput,
              h('div.field__hint', null, 'Kata ini yang diberi warna gradien. Contoh: "produk pilihan"')
            ),

            h('div.field.mt-3', null,
              h('label', null, 'Kalimat penjelasan'),
              subtitleInput,
              h('div.field__hint', null,
                'Bila kosong, memakai nama toko + tagline Anda, lalu kalimat bawaan.')
            ),

            h('div.field.mt-3', null,
              h('label', null, 'Teks kecil di atas judul'),
              badgeInput
            ),

            h('div.row.gap-3.mt-3', null,
              h('div.field.grow', null,
                h('label', null, 'Teks tombol katalog'),
                ctaInput
              ),
              h('div.field.grow', null,
                h('label', null, 'Teks tombol lacak pesanan'),
                trackInput
              )
            ),

            h('div.divider'),

            h('h4.t-h3', null, 'Gambar banner'),
            h('p.t-body.mt-2.mb-4', null,
              'Gambar besar di sisi kanan bagian atas. Bila kosong, aplikasi memakai foto-foto produk pilihan sebagai pengganti.'
            ),

            imageRow('heroImage', 'Banner toko online', 'Disarankan gambar landscape (mis. 1200×800 px).', { maxSize: 900 }),

            h('div.divider'),

            h('h4.t-h3', null, 'Elemen yang ditampilkan'),
            h('div.row.gap-4.mt-3', null,
              h('label.row.gap-2', { style: { cursor: 'pointer' } },
                badgeToggle, h('span.t-sm', null, 'Tampilkan teks kecil (badge) di atas judul')
              ),
              h('label.row.gap-2', { style: { cursor: 'pointer' } },
                statsToggle, h('span.t-sm', null, 'Tampilkan barisan ringkasan (jumlah produk, ongkir)')
              )
            ),

            h('div.divider'),

            h('div.field', null,
              h('label', null, 'Catatan di footer'),
              footerInput,
              h('div.field__hint', null, 'Tampil di bagian bawah halaman toko online.')
            )
          )
        )
      );
    } else if (tab === 'branding') {
      host.append(
        h('div.panel', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Logo toko & QRIS')),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Logo dipakai pada header web, halaman muka, dan bagian atas struk. Foto QRIS otomatis muncul di layar pembayaran — pelanggan tinggal-scan.'
            ),

            imageRow('storeLogo', 'Logo toko', 'Disarankan gambar persegi (512×512 px) dengan latar transparan.', { square: true, maxSize: 400 }),

            h('div.divider'),

            imageRow('qrisImage', 'Foto QRIS statis', 'Unggah foto QRIS dari provider Anda. Tampil otomatis saat pelanggan memilih pembayaran QRIS.', { square: true, maxSize: 640 }),

            h('div.callout.mt-4', null,
              icon('info'),
              'Bila foto QRIS belum diunggah, aplikasi tetap membuat QRIS dinamis dari payload EMV (merchant + nominal + CRC) seperti sebelumnya.'
            ),

            h('div.divider'),

            /* --- QRIS DINAMIS (gateway) ---------------------------------- */
            h('div', null,
              h('h3.t-h3', null, 'QRIS dinamis (gateway)'),
              h('p.t-body.mt-2.mb-4', null,
                'QRIS dinamis berarti QR dibuat oleh server acquiring bank, sehingga nominal terkunci di dalam QR ' +
                'dan status pembayaran otomatis terkirim lewat webhook. Bila gateway aktif, foto QRIS statis di atas ' +
                'diabaikan dan setiap pesanan mendapat QR dengan nominal yang benar.'
              ),

              (() => {
                const mode = String(draft.qrisGateway || 'none');
                const keyInput = h('input.input', {
                  type: 'password',
                  value: draft.qrisApiKey || '',
                  placeholder: 'API key / secret key',
                  autocomplete: 'off',
                });
                const merchantInput = h('input.input', {
                  type: 'text',
                  value: draft.qrisMerchantId || '',
                  placeholder: 'ID merchant di provider',
                });
                const baseInput = h('input.input', {
                  type: 'text',
                  value: draft.qrisApiBase || '',
                  placeholder: 'Kosongkan untuk memakai URL bawaan provider',
                });
                const callbackInput = h('input.input', {
                  type: 'text',
                  value: draft.qrisCallbackBase || '',
                  placeholder: 'https://script.google.com/macros/s/.../exec',
                });

                const modeSelect = h('select.select', {
                  'aria-label': 'Provider QRIS',
                  onchange: (e) => {
                    setDraft('qrisGateway', e.target.value);
                    render();
                  },
                },
                  h('option', { value: 'none', selected: mode === 'none' }, 'Tidak aktif (QRIS statis)'),
                  h('option', { value: 'xendit', selected: mode === 'xendit' }, 'Xendit'),
                  h('option', { value: 'midtrans', selected: mode === 'midtrans' }, 'Midtrans'),
                  h('option', { value: 'custom', selected: mode === 'custom' }, 'Gateway sendiri (custom)')
                );

                keyInput.addEventListener('input', () => setDraft('qrisApiKey', keyInput.value));
                merchantInput.addEventListener('input', () => setDraft('qrisMerchantId', merchantInput.value));
                baseInput.addEventListener('input', () => setDraft('qrisApiBase', baseInput.value));
                callbackInput.addEventListener('input', () => setDraft('qrisCallbackBase', callbackInput.value));

                const PROVIDERS = {
                  xendit: {
                    title: 'Xendit',
                    hint: 'Buat secret API key di Xendit Dashboard > Developers > API Keys. ' +
                      'Aktifkan produk QRIS, lalu pakai Merchant QR Code mode DYNAMIC. ' +
                      'Webhooks: aktifkan event "QR Code Paid" dan arahkan ke URL callback di bawah.',
                    defaultBase: 'https://api.xendit.co',
                  },
                  midtrans: {
                    title: 'Midtrans',
                    hint: 'Buat "Server Key" di Midtrans Dashboard > Settings > Access Keys. ' +
                      'Aktifkan QRIS pada produk Anda. Webhooks: arahkan ke URL callback di bawah ' +
                      'dengan event status "PAID".',
                    defaultBase: 'https://api.midtrans.com/v2',
                  },
                  custom: {
                    title: 'Gateway sendiri',
                    hint: 'Panggil endpoint milik Anda: POST {base}/create dengan body ' +
                      '{ external_id, amount, code }. Server harus membalas JSON yang memuat ' +
                      'qr_string / qr_code / qrCode / data.',
                    defaultBase: '',
                  },
                };

                if (mode === 'none') {
                  return h('div.callout', null,
                    icon('info'),
                    'Gateway belum aktif. Aplikasi memakai QRIS statis: foto QRIS (atau payload EMV) dengan nominal yang ditulis manual oleh kasir.'
                  );
                }

                const p = PROVIDERS[mode] || PROVIDERS.custom;

                return h('div', null,
                  h('div.field', null,
                    h('label', null, 'Provider'),
                    modeSelect
                  ),

                  h('div.field.mt-3', null,
                    h('label', null, 'API key / secret key'),
                    keyInput,
                    h('div.field__hint', null, 'Disimpan di Spreadsheet (Settings). Jangan bagikan.')
                  ),

                  h('div.field.mt-3', null,
                    h('label', null, 'ID merchant'),
                    merchantInput
                  ),

                  h('div.field.mt-3', null,
                    h('label', null, 'URL dasar API'),
                    baseInput,
                    h('div.field__hint', null, p.defaultBase ? `Kosongkan untuk memakai ${p.defaultBase}` : 'Wajib diisi untuk gateway custom.')
                  ),

                  h('div.field.mt-3', null,
                    h('label', null, 'URL callback (webhook)'),
                    callbackInput,
                    h('div.field__hint', null,
                      'URL Web App Apps Script Anda. Backend memanggil ?action=qrisCallback otomatis — ' +
                      'tidak perlu menambah kode manual.'
                    )
                  ),

                  h('div.callout.mt-4', null, icon('info'), p.hint),

                  h('div.callout.mt-3', null,
                    icon('alert'),
                    'Pengaturan tersimpan setelah menekan "Simpan perubahan" di bagian atas. ' +
                    'Satu-satunya hal yang perlu dilakukan di sisi provider adalah mengarahkan webhook ke URL callback.'
                  )
                );
              })()
            )
          )
        )
      );
    } else if (tab === 'kurir') {
      host.append(
        h('div.panel', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Daftar kurir')),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Kasir memilih salah satu kurir saat menandai pesanan delivery "diantar". Nama dan nomor telepon kurir langsung terlihat oleh pelanggan di halaman lacak pesanan.'
            ),
            courierRow()
          )
        )
      );
    } else if (tab === 'data') {
      /* --- Panel hubungkan Spreadsheet -------------------------------- */
      const gasInput = h('input.input', {
        type: 'url',
        placeholder: 'https://script.google.com/macros/s/AKfycb…/exec',
        value: readOverride() || GAS_URL,
      });

      const connectBlock = h('div.panel.mb-4', null,
        h('div.panel__head', null,
          h('h3.t-h3', null, 'Hubungkan Google Spreadsheet'),
          h('span.badge.badge--ok', null, 'Server aktif')
        ),
        h('div.panel__body', null,
          h('p.t-body.mb-3', null,
            'Tempel URL Web App Apps Script (Deploy → Manage deployments → URL berakhiran /exec). ' +
            'URL ini tersimpan di perangkat ini dan langsung dipakai — tanpa perlu edit berkas.'
          ),
          gasInput,
          h('div.row.gap-2.mt-3', null,
            h('button.btn.btn--primary', {
              onclick: async () => {
                const url = gasInput.value.trim();
                if (!url) {
                  toast('URL Web App tidak boleh kosong', 'warn');
                  return;
                }
                writeOverride(url);
                toast('Tersimpan — memuat ulang aplikasi…', 'ok');
                setTimeout(() => location.reload(), 700);
              },
            }, icon('check'), 'Simpan & hubungkan'),
            h('button.btn.btn--soft', {
              onclick: async () => {
                toast('Menguji koneksi…', 'ok', 1200);
                const res = await api.pingServer();
                if (res && res.ok) {
                  toast('Server terhubung', 'ok');
                } else {
                  toast(res?.error || 'Server tidak merespons', 'err', 3200);
                }
              },
            }, icon('refresh'), 'Uji koneksi'),
            readOverride()
              ? h('button.btn.btn--ghost', {
                onclick: () => {
                  writeOverride('');
                  gasInput.value = GAS_URL;
                  toast('Kembali ke URL bawaan', 'ok');
                },
              }, 'Hapus override')
              : null
          ),
          h('div.field__hint.mt-3', null,
            'SPREADSHEET_ID diisi di Apps Script → Project Settings → Script properties. ' +
            'Setelah URL di atas tersimpan, jalankan “setupDatabase()” sekali untuk membuat sheet.'
          )
        )
      );

      host.append(
        connectBlock,
        h('div.panel', null,
          h('div.panel__head', null, h('h3.t-h3', null, 'Database & data')),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Seluruh data tersimpan di Google Spreadsheet melalui backend Apps Script. ' +
              'Tab: Settings, Categories, Products, Users, Transactions, OnlineOrders, Queue, dan Counter.'
            ),

            h('div.callout.mb-4', null,
              icon('info'),
              'SPREADSHEET_ID diisi di Apps Script → Script properties. Mengganti ID di sana akan mengganti seluruh database yang dipakai.'
            ),

            h('div.col.gap-3', null,
              h('button.btn.btn--primary', {
                onclick: async () => {
                  const res = await api.setupDatabase();
                  if (!res || res.ok === false) {
                    toast(res?.error || 'setupDatabase() gagal', 'err');
                    return;
                  }
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
                  try {
                    const json = await api.exportDatabase();
                    const ok = await copyText(json);
                    toast(ok ? 'Data disalin ke clipboard' : 'Gagal menyalin', ok ? 'ok' : 'err');
                  } catch (err) {
                    toast(err.message || 'Gagal mengekspor data', 'err');
                  }
                },
              }, icon('copy'), 'Salin data (JSON)'),

              h('button.btn.btn--soft', {
                onclick: async () => {
                  try {
                    const blob = new Blob([await api.exportDatabase()], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `mykasir-backup-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    toast(err.message || 'Gagal mengunduh cadangan', 'err');
                  }
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
                    body: 'Semua transaksi, produk, dan pengaturan di SPREADSHEET akan diganti dengan data awal. Tindakan ini tidak bisa dibatalkan.',
                    confirmLabel: 'Reset sekarang',
                  });
                  if (!ok) return;
                  const res = await api.resetDemoData();
                  if (!res || res.ok === false) {
                    toast(res?.error || 'Reset gagal', 'err');
                    return;
                  }
                  toast('Data direset', 'ok');
                  setTimeout(() => location.reload(), 700);
                },
              }, icon('refresh'), 'Reset ke data contoh')
            )
          )
        ),

        /* --- Panel data yang tersimpan di perangkat -------------------- */
        h('div.panel.mt-4', null,
          h('div.panel__head', null,
            h('h3.t-h3', null, 'Data di perangkat ini'),
            h('span.badge.badge--info', null, 'Bukan database')
          ),
          h('div.panel__body', null,
            h('p.t-body.mb-4', null,
              'Seluruh data toko (produk, transaksi, pesanan, pengaturan, antrean) ada di Google Spreadsheet — ' +
              'bukan di perangkat ini. Yang disimpan di perangkat hanya:'
            ),
            h('ul.t-body', { style: { margin: '0 0 16px', paddingLeft: '20px' } },
              h('li', { style: { marginBottom: '4px' } },
                h('b', null, 'Cache baca'), ' — salinan sementara katalog & pengaturan supaya halaman tampil instan. Aman dihapus; isinya diambil ulang dari server.'),
              h('li', { style: { marginBottom: '4px' } },
                h('b', null, 'Preferensi'), ' — tema, sesi login, dan keranjang yang sedang berjalan.')
            ),
            h('div.callout.mb-4', null,
              icon('info'),
              'Menghapus cache membuat kunjungan berikutnya menunggu balasan Apps Script (±2 detik) sekali saja. Tidak ada data yang hilang — data tetap ada di Spreadsheet.'
            ),
            h('div.col.gap-3', null,
              h('button.btn.btn--soft', {
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: 'Bersihkan cache di perangkat ini?',
                    body: 'Cache baca akan dihapus. Tema, sesi login, dan keranjang tetap disimpan. Data di Spreadsheet tidak tersentuh.',
                    confirmLabel: 'Bersihkan cache',
                    danger: false,
                  });
                  if (!ok) return;
                  api.bustCache();
                  await refreshSettings();
                  toast('Cache perangkat dibersihkan', 'ok');
                },
              }, icon('trash'), 'Bersihkan cache baca'),

              h('button.btn.btn--ghost', {
                style: { color: 'var(--coral)', borderColor: 'rgba(255,92,122,0.4)' },
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: 'Hapus semua data perangkat?',
                    body: 'Cache, tema, sesi login, dan keranjang akan dihapus dari perangkat ini. Anda akan diminta login ulang. Data di Spreadsheet tidak tersentuh.',
                    confirmLabel: 'Hapus semua',
                  });
                  if (!ok) return;
                  try {
                    localStorage.clear();
                    sessionStorage.clear();
                  } catch { /* ignore */ }
                  toast('Data perangkat dihapus — memuat ulang…', 'ok');
                  setTimeout(() => location.reload(), 700);
                },
              }, icon('trash'), 'Hapus semua data perangkat')
            )
          )
        )
      );
    }
  };

  const tabs = [
    { key: 'umum', label: 'Umum', icon: 'settings' },
    { key: 'lokasi', label: 'Lokasi', icon: 'map' },
    { key: 'tampilan', label: 'Tampilan toko', icon: 'layers' },
    { key: 'branding', label: 'Logo & QRIS', icon: 'image' },
    { key: 'kurir', label: 'Kurir', icon: 'truck' },
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

  updateSaveState();

  const toolbar = h('div.toolbar.settings-toolbar', null,
    h('div.grow', null,
      h('div.t-sm', null, 'Perubahan disimpan ke Spreadsheet hanya setelah tombol Simpan ditekan.'),
      savedLabel,
      dirtyLabel
    ),
    h('div.row.gap-2', null,
      h('button.btn.btn--ghost', {
        type: 'button',
        onclick: () => {
          if (!dirty.size) return;
          // Kembalikan isi form ke nilai tersimpan.
          for (const key of dirty) draft[key] = s[key];
          dirty.clear();
          updateSaveState();
          render();
          toast('Perubahan dibatalkan', 'ok', 1400);
        },
      }, 'Batalkan'),
      saveBtn
    )
  );

  render();
  return h('div', null, tabBar, toolbar, host);
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

