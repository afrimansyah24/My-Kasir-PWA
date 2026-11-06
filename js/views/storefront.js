/* My Kasir — public storefront.
 *
 * This is the first screen a customer sees: no login, a browsable catalogue,
 * a cart, checkout and order tracking.
 */

import {
  $, h, icon, iconSvg, toast, rupiah, esc, debounce, fmtDate, fmtTime,
  fmtDateTime, relTime, uid, orderCode, modal, closeModal, copyText, emptyState,
} from '../util.js';
import * as api from '../api.js';
import * as store from '../store.js';
import * as cart from '../cart.js';
import { qrCanvas } from '../qr.js';
import { areaChart, donutChart, legend, sparkline } from '../charts.js';
import { go } from '../app.js';

let state = {
  data: null,
  category: 'all',
  query: '',
  sort: 'featured',
  view: 'grid',
  trackCode: '',
};

/* -------------------------------------------------------------------------
   Header
   ---------------------------------------------------------------------- */

function header(data) {
  const c = cart.cart();
  return h('header.shop-head', null,
    h('div.shell', null,
      h('div.shop-head__inner', null,
        h('a.brand', { href: '/', 'data-nav': 'home' },
          h('span.brand__mark', null, icon('store')),
          h('span', null,
            data.store.name,
            h('span.brand__sub', null, data.store.tagline)
          )
        ),

        h('div.shop-head__search.input-group', null,
          icon('search', 'input-group__ico'),
          h('input.input.input--icon', {
            type: 'search',
            placeholder: 'Cari produk…',
            'data-search': true,
            value: state.query,
            'aria-label': 'Cari produk',
          })
        ),

        h('div.row.gap-2', null,
          h('a.btn.btn--ghost.btn--icon', {
            href: '/lacak', 'data-nav': 'track',
            title: 'Lacak pesanan',
            'aria-label': 'Lacak pesanan',
          }, icon('search')),
          h('button.cart-btn', {
            onclick: openCart,
            'aria-label': 'Buka keranjang',
          },
            icon('cart'),
            h('span.cart-btn__label', null, 'Keranjang'),
            h('span.cart-btn__count', { 'data-cart-count': true, 'data-empty': c.count ? '0' : '1' }, String(c.count))
          )
        )
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Hero
   ---------------------------------------------------------------------- */

function hero(data) {
  const featured = data.products.filter((p) => p.available).slice(0, 4);
  const tiles = featured.length
    ? featured
    : [{ image: '', name: data.store.name }];

  return h('section.hero', null,
    h('div.shell', null,
      h('div.hero__inner', null,
        h('div', null,
          h('div.hero__badge', null,
            h('span.badge.badge--info', null, icon('sparkles'), 'Baru'),
            h('span', null, `Belanja tanpa ribet, kirim hari ini`)
          ),
          h('h1.t-display', null,
            'Perlengkapan ', h('span.t-gradient', null, 'renang & olahraga'), ' terbaik untuk Anda.'
          ),
          h('p.hero__lead', null,
            `${data.store.name} — ${data.store.tagline}. Pilih produk, tentukan pengiriman, dan lacak pesanan Anda dengan kode sederhana.`
          ),
          h('div.hero__actions', null,
            h('button.btn.btn--primary.btn--lg', {
              onclick: () => {
                document.getElementById('katalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              },
            }, icon('grid'), 'Lihat katalog'),
            h('a.btn.btn--ghost.btn--lg', { href: '/lacak', 'data-nav': 'track' }, icon('search'), 'Lacak pesanan')
          ),
          h('div.hero__stats', null,
            h('div.hero__stat', null,
              h('b', null, String(data.products.length)),
              h('span', null, 'produk tersedia')
            ),
            h('div.hero__stat', null,
              h('b', null, '10 menit'),
              h('span', null, 'batas bayar QRIS')
            ),
            h('div.hero__stat', null,
              h('b', null, rupiah(data.store.deliveryFee, { decimals: false }).replace('Rp', '')),
              h('span', null, 'ongkir flat')
            )
          )
        ),

        h('div.hero__art', { 'aria-hidden': 'true' },
          h('div.hero__glow'),
          tiles.slice(0, 4).map((p, i) =>
            h('div', { class: `hero__tile hero__tile--${i + 1}` },
              p.image ? h('img', { src: p.image, alt: '', loading: 'lazy' }) : null
            )
          )
        )
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Catalogue
   ---------------------------------------------------------------------- */

function categoryRail(data) {
  const chips = [h('button.chip.is-active', {
    'data-cat': 'all',
    onclick: (e) => selectCategory(e.currentTarget, 'all'),
  }, 'Semua')];

  for (const cat of data.categories) {
    const count = data.products.filter((p) => p.category === cat.id).length;
    if (!count) continue;
    chips.push(h('button.chip', {
      'data-cat': cat.id,
      onclick: (e) => selectCategory(e.currentTarget, cat.id),
    },
      h('span', { style: { width: '8px', height: '8px', borderRadius: '3px', background: cat.color } }),
      cat.name,
      h('span.t-xs', { style: { color: 'inherit', opacity: '0.6' } }, String(count))
    ));
  }

  return h('div.rail', null, chips);
}

function selectCategory(btn, id) {
  state.category = id;
  document.querySelectorAll('[data-cat]').forEach((el) => el.classList.toggle('is-active', el === btn));
  renderGrid();
}

function filtered(data) {
  let list = data.products.slice();

  if (state.category !== 'all') {
    list = list.filter((p) => p.category === state.category);
  }

  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (data.categories.find((c) => c.id === p.category)?.name || '').toLowerCase().includes(q)
    );
  }

  switch (state.sort) {
    case 'price-asc': list.sort((a, b) => a.price - b.price); break;
    case 'price-desc': list.sort((a, b) => b.price - a.price); break;
    case 'name': list.sort((a, b) => a.name.localeCompare(b.name)); break;
    default: break;
  }

  return list;
}

function productCard(p, data, index) {
  const cat = data.categories.find((c) => c.id === p.category);
  const out = !p.available;

  return h('article.pcard', { style: { animationDelay: `${Math.min(index, 12) * 40}ms` } },
    h('div.pcard__media', { onclick: () => openProduct(p, data) },
      p.image
        ? h('img', { src: p.image, alt: p.name, loading: 'lazy', width: '400', height: '400' })
        : h('div', { style: { color: 'var(--ink-5)' } }, icon('box')),
      out ? h('span.pcard__tag.badge.badge--err', null, 'Stok habis') : null,
      p.negotiable ? h('span.pcard__tag.badge.badge--violet', { style: { left: 'auto', right: '10px' } }, 'Bisa nego') : null
    ),
    h('div.pcard__body', { onclick: () => openProduct(p, data) },
      h('div.pcard__cat', null, cat?.name || 'Umum'),
      h('h3.pcard__name', null, p.name),
      h('div.pcard__foot', null,
        h('div.pcard__price', null,
          rupiah(p.price),
          p.trackStock ? h('small', null, `Stok ${p.stock} ${p.unit}`) : null
        ),
        h('button.pcard__add', {
          disabled: out,
          'aria-label': `Tambah ${p.name}`,
          title: out ? 'Stok habis' : 'Tambah ke keranjang',
          onclick: (e) => {
            e.stopPropagation();
            addToCart(p);
          },
        }, icon('plus'))
      )
    )
  );
}

function renderGrid() {
  const wrap = document.getElementById('catalog-grid');
  if (!wrap || !state.data) return;

  const list = filtered(state.data);

  if (!list.length) {
    wrap.innerHTML = '';
    wrap.append(emptyState(
      'search',
      'Produk tidak ditemukan',
      state.query
        ? `Tidak ada produk yang cocok dengan "${state.query}". Coba kata kunci lain.`
        : 'Belum ada produk pada kategori ini.',
      h('button.btn.btn--soft', { onclick: () => {
        state.query = '';
        state.category = 'all';
        const input = document.querySelector('[data-search]');
        if (input) input.value = '';
        document.querySelectorAll('[data-cat]').forEach((el, i) => el.classList.toggle('is-active', i === 0));
        renderGrid();
      } }, 'Bersihkan filter')
    ));
    return;
  }

  wrap.innerHTML = '';
  list.forEach((p, i) => wrap.append(productCard(p, state.data, i)));

  const count = document.getElementById('catalog-count');
  if (count) count.textContent = `${list.length} produk`;
}

function catalog(data) {
  return h('section.catalog', { id: 'katalog' },
    h('div.shell', null,
      h('div.catalog__head', null,
        h('div', null,
          h('h2.t-h1', null, 'Katalog produk'),
          h('p.t-body', { style: { marginTop: '4px' } },
            h('span', { id: 'catalog-count' }, `${data.products.length} produk`),
            ' tersedia untuk dipesan online'
          )
        ),
        h('div.row.gap-2', null,
          h('select.select', {
            'aria-label': 'Urutkan',
            style: { width: 'auto', minWidth: '160px' },
            onchange: (e) => {
              state.sort = e.target.value;
              renderGrid();
            },
          },
            h('option', { value: 'featured' }, 'Paling relevan'),
            h('option', { value: 'price-asc' }, 'Harga terendah'),
            h('option', { value: 'price-desc' }, 'Harga tertinggi'),
            h('option', { value: 'name' }, 'Nama A-Z')
          )
        )
      ),

      categoryRail(data),
      h('div.grid', { id: 'catalog-grid' })
    )
  );
}

/* -------------------------------------------------------------------------
   Product detail
   ---------------------------------------------------------------------- */

function openProduct(p, data) {
  const cat = data.categories.find((c) => c.id === p.category);

  modal((close) => {
    const qty = { value: 1 };
    const qtyLabel = h('span.qty__val', null, '1');

    const bump = (d) => {
      qty.value = Math.max(1, Math.min(p.stock || 99, qty.value + d));
      qtyLabel.textContent = String(qty.value);
    };

    return h('div', null,
      h('div.modal__head', null,
        h('div.grow', null,
          h('span.badge.badge--info', null, cat?.name || 'Produk'),
          h('h3.t-h2', { style: { marginTop: '8px' } }, p.name),
          h('p.t-body', { style: { marginTop: '6px' } }, p.description || '')
        ),
        h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
      ),

      h('div.modal__body', null,
        h('div', {
          style: {
            aspectRatio: '4 / 3', background: 'var(--surface-3)', borderRadius: 'var(--r-lg)',
            display: 'grid', placeItems: 'center', padding: '8%', marginBottom: 'var(--s-5)',
          },
        }, p.image ? h('img', { src: p.image, alt: p.name, style: { width: '100%', height: '100%', objectFit: 'contain' } }) : null),

        h('div.row-between', null,
          h('div', null,
            h('div.t-h1', null, rupiah(p.price)),
            p.trackStock
              ? h('div.t-sm', { style: { marginTop: '2px' } },
                p.stock > 0
                  ? h('span', null, 'Stok tersedia: ', h('b', null, `${p.stock} ${p.unit}`))
                  : h('span.t-coral', null, 'Stok habis')
              )
              : h('div.t-sm', null, 'Stok tidak dibatasi')
          ),
          h('div.qty', null,
            h('button', { onclick: () => bump(-1), 'aria-label': 'Kurangi' }, icon('minus')),
            qtyLabel,
            h('button', { onclick: () => bump(1), 'aria-label': 'Tambah' }, icon('plus'))
          )
        ),

        p.note ? h('div.callout.mt-4', null, icon('info'), p.note) : null,

        p.negotiable ? h('div.callout.callout--ok.mt-3', null, icon('percent'), 'Harga bisa dinegosiasikan — tulis catatan saat checkout.') : null
      ),

      h('div.modal__foot', null,
        h('button.btn.btn--ghost.grow', { onclick: close }, 'Tutup'),
        h('button.btn.btn--primary.grow', {
          disabled: !p.available,
          onclick: () => {
            addToCart(p, qty.value);
            close();
          },
        }, icon('cart'), 'Tambah ke keranjang')
      )
    );
  });
}

/* -------------------------------------------------------------------------
   Cart
   ---------------------------------------------------------------------- */

function addToCart(p, qty = 1) {
  cart.addItem(p, qty);
  toast(`${p.name} masuk keranjang`, 'ok');
}

function openCart() {
  const scrim = h('div.scrim');
  const drawer = h('div.drawer');

  const close = () => {
    scrim.classList.remove('is-open');
    drawer.classList.remove('is-open');
    setTimeout(() => { scrim.remove(); drawer.remove(); }, 320);
  };

  scrim.addEventListener('click', close);

  const body = h('div.drawer__body');
  const foot = h('div.drawer__foot');

  const render = () => {
    const c = cart.cart();
    body.innerHTML = '';
    foot.innerHTML = '';

    const countEl = document.querySelector('[data-cart-count]');
    if (countEl) {
      countEl.textContent = String(c.count);
      countEl.dataset.empty = c.count ? '0' : '1';
    }

    if (!c.items.length) {
      body.append(emptyState('cart', 'Keranjang kosong', 'Produk yang Anda pilih akan muncul di sini.'));
      foot.append(
        h('button.btn.btn--primary.btn--block', { onclick: close }, 'Lihat katalog')
      );
      return;
    }

    for (const it of c.items) {
      body.append(
        h('div.cart-item', null,
          h('div.cart-item__img', null,
            it.image ? h('img', { src: it.image, alt: '' }) : null
          ),
          h('div.grow', null,
            h('div.cart-item__name', null, it.name),
            h('div.cart-item__price', null, rupiah(it.price), ' × ', String(it.qty), ' = ', h('b', null, rupiah(it.price * it.qty))),
            h('div.row.gap-2.mt-2', null,
              h('div.qty', null,
                h('button', { onclick: () => { cart.setQty(it.id, it.qty - 1); render(); } }, icon('minus')),
                h('span.qty__val', null, String(it.qty)),
                h('button', { onclick: () => { cart.setQty(it.id, it.qty + 1); render(); } }, icon('plus'))
              ),
              h('button.btn.btn--sm.btn--ghost', {
                onclick: () => { cart.removeItem(it.id); render(); },
              }, icon('trash'), 'Hapus')
            )
          )
        )
      );
    }

    foot.append(
      h('div.sum', null,
        h('div.sum__row', null, h('span', null, 'Subtotal'), h('b', null, rupiah(c.subtotal))),
        c.deliveryFee > 0
          ? h('div.sum__row', null, h('span', null, 'Ongkir'), h('b', null, rupiah(c.deliveryFee)))
          : null,
        h('div.sum__row.sum__row--total', null, h('span', null, 'Total'), h('b', null, rupiah(c.total)))
      ),
      h('button.btn.btn--primary.btn--block.btn--lg.mt-4', {
        onclick: () => { close(); openCheckout(); },
      }, icon('cash'), 'Lanjut ke pembayaran')
    );
  };

  drawer.append(
    h('div.drawer__head', null,
      h('div', null,
        h('h3.t-h2', null, 'Keranjang'),
        h('div.t-sm', null, 'Barang yang akan Anda beli')
      ),
      h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
    ),
    body,
    foot
  );

  document.body.append(scrim, drawer);
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    drawer.classList.add('is-open');
  });

  render();
}

/* -------------------------------------------------------------------------
   Checkout
   ---------------------------------------------------------------------- */

function openCheckout() {
  const data = state.data;
  let payment = 'QRIS';
  let fulfilment = cart.cart().fulfilment === 'delivery' ? 'delivery' : 'pickup';

  modal((close) => {
    const wrap = h('div');
    const steps = h('div.steps', null,
      h('div.steps__item.is-active', null, h('span.steps__dot', null, '1'), 'Pengiriman'),
      h('div.steps__line'),
      h('div.steps__item', null, h('span.steps__dot', null, '2'), 'Pembayaran'),
      h('div.steps__line'),
      h('div.steps__item', null, h('span.steps__dot', null, '3'), 'Selesai')
    );

    const bodyHost = h('div.modal__body');

    const setStep = (n) => {
      const items = steps.querySelectorAll('.steps__item');
      items.forEach((el, i) => {
        el.classList.toggle('is-active', i === n);
        el.classList.toggle('is-done', i < n);
      });
    };

    /* --- step 1: delivery ------------------------------------------- */
    const nameInput = h('input.input', {
      type: 'text', placeholder: 'Nama lengkap', value: cart.cart().customer,
    });
    const phoneInput = h('input.input', {
      type: 'tel', placeholder: 'Nomor WhatsApp', value: cart.cart().phone,
    });
    const addressInput = h('textarea.textarea', {
      placeholder: 'Alamat lengkap beserta patokan',
      value: cart.cart().address,
    });
    const noteInput = h('input.input', {
      type: 'text', placeholder: 'Catatan untuk penjual (opsional)',
    });

    const addressField = h('div.field.mt-3', null,
      h('label', null, 'Alamat pengiriman'),
      addressInput
    );
    addressField.classList.add('hidden');

    const deliveryOpt = h('button.pick__opt', {
      type: 'button',
      onclick: () => { fulfilment = 'delivery'; syncPick(); },
    },
      icon('truck'),
      h('b', null, 'Delivery'),
      h('span', null, `Ongkir ${rupiah(data.store.deliveryFee)}`)
    );
    const pickupOpt = h('button.pick__opt', {
      type: 'button',
      onclick: () => { fulfilment = 'pickup'; syncPick(); },
    },
      icon('store'),
      h('b', null, 'Ambil di tempat'),
      h('span', null, data.store.addressShort || data.store.address)
    );

    function syncPick() {
      deliveryOpt.classList.toggle('is-active', fulfilment === 'delivery');
      pickupOpt.classList.toggle('is-active', fulfilment === 'pickup');
      addressField.classList.toggle('hidden', fulfilment !== 'delivery');
      cart.setFulfilment(fulfilment);
      updateTotals();
    }

    const totalsHost = h('div.sum.mt-5');
    const summaryHost = h('div', { style: { marginBottom: 'var(--s-5)' } });

    function updateTotals() {
      const c = cart.cart();
      totalsHost.innerHTML = '';
      totalsHost.append(
        h('div.sum__row', null, h('span', null, `Subtotal (${c.count} item)`), h('b', null, rupiah(c.subtotal))),
        c.deliveryFee > 0 ? h('div.sum__row', null, h('span', null, 'Ongkir'), h('b', null, rupiah(c.deliveryFee))) : null,
        h('div.sum__row.sum__row--total', null, h('span', null, 'Total'), h('b', null, rupiah(c.total)))
      );

      summaryHost.innerHTML = '';
      summaryHost.append(
        h('div.panel', null,
          h('div.panel__head', null,
            h('h3.t-h3', null, 'Ringkasan pesanan'),
            h('button.btn.btn--sm.btn--ghost', { onclick: () => { close(); openCart(); } }, 'Ubah')
          ),
          h('div.panel__body.panel__body--flush', null,
            c.items.map((it) =>
              h('div.list-row', null,
                h('div.list-row__img', null, it.image ? h('img', { src: it.image, alt: '' }) : null),
                h('div.grow', null,
                  h('div', { style: { fontSize: '13.5px', fontWeight: '600' } }, it.name),
                  h('div.t-xs', null, `${it.qty} × ${rupiah(it.price)}`)
                ),
                h('div.t-mono', { style: { fontSize: '13px', fontWeight: '600' } }, rupiah(it.price * it.qty))
              )
            )
          )
        )
      );
    }

    const step1 = h('div', null,
      h('div.field', null,
        h('label', null, 'Metode pengambilan'),
        h('div.pick', null, pickupOpt, deliveryOpt)
      ),
      h('div.field.mt-4', null,
        h('label', null, `Nama ${data.features.customerName ? 'pelanggan' : '(opsional)'}`),
        nameInput
      ),
      h('div.field.mt-3', null,
        h('label', null, 'Nomor WhatsApp (opsional)'),
        phoneInput
      ),
      addressField,
      h('div.field.mt-3', null,
        h('label', null, 'Catatan (opsional)'),
        noteInput
      )
    );

    /* --- step 2: payment -------------------------------------------- */
    const qrisOpt = h('button.pay__opt', {
      type: 'button',
      onclick: () => { payment = 'QRIS'; syncPay(); },
    },
      h('span.pay__ico', null, icon('qr')),
      h('div.grow', null,
        h('b', null, 'QRIS'),
        h('span', null, 'Scan dengan GoPay, OVO, DANA, ShopeePay')
      )
    );
    const cashOpt = h('button.pay__opt', {
      type: 'button',
      onclick: () => { payment = 'Cash'; syncPay(); },
    },
      h('span.pay__ico', null, icon('cash')),
      h('div.grow', null,
        h('b', null, 'Cash'),
        h('span', null, 'Bayar di kasir saat pengambilan / pengiriman')
      )
    );

    function syncPay() {
      qrisOpt.classList.toggle('is-active', payment === 'QRIS');
      cashOpt.classList.toggle('is-active', payment === 'Cash');
    }

    const step2 = h('div', null,
      h('div.field', null,
        h('label', null, 'Metode pembayaran'),
        h('div.pay', null, qrisOpt, cashOpt)
      ),
      h('div.callout.mt-4', null,
        icon('info'),
        'Pesanan QRIS berlaku 10 menit. Bila belum dibayar, pesanan otomatis dibatalkan.'
      )
    );

    /* --- step 3: result ---------------------------------------------- */
    const step3 = h('div');

    const showStep = (n) => {
      setStep(n);
      bodyHost.innerHTML = '';
      if (n === 0) bodyHost.append(step1);
      else if (n === 1) bodyHost.append(step2);
      else bodyHost.append(step3);
      foot.innerHTML = '';
      renderFoot(n);
    };

    const foot = h('div.modal__foot');

    function renderFoot(n) {
      if (n === 0) {
        foot.append(
          h('button.btn.btn--ghost.grow', { onclick: close }, 'Batal'),
          h('button.btn.btn--primary.grow', {
            onclick: () => {
              cart.setField('customer', nameInput.value.trim());
              cart.setField('phone', phoneInput.value.trim());
              cart.setField('address', addressInput.value.trim());
              cart.setField('note', noteInput.value.trim());
              cart.setFulfilment(fulfilment);
              updateTotals();
              showStep(1);
            },
          }, 'Lanjut', icon('arrowRight'))
        );
      } else if (n === 1) {
        foot.append(
          h('button.btn.btn--ghost.grow', { onclick: () => showStep(0) }, icon('arrowLeft'), 'Kembali'),
          h('button.btn.btn--primary.grow', {
            onclick: () => submit(),
          }, icon('check'), 'Buat pesanan')
        );
      } else {
        foot.append(
          h('button.btn.btn--ghost.grow', { onclick: () => { close(); go('/'); } }, 'Kembali ke katalog'),
          h('button.btn.btn--primary.grow', {
            onclick: () => { close(); openTrack(code); },
          }, icon('search'), 'Lacak pesanan')
        );
      }
    }

    let code = '';
    let timer = null;

    async function submit() {
      const btn = foot.querySelector('.btn--primary');
      btn.disabled = true;
      btn.innerHTML = '';
      btn.append(h('span.spinner'), 'Memproses…');

      const res = await api.createOnlineOrder({
        items: cart.cart().items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, unit: i.unit, image: i.image, category: i.category })),
        customer: nameInput.value.trim(),
        phone: phoneInput.value.trim(),
        address: addressInput.value.trim(),
        note: noteInput.value.trim(),
        fulfilment,
        payment,
        discount: 0,
      });

      btn.disabled = false;

      if (!res.ok) {
        toast(res.error || 'Gagal membuat pesanan', 'err');
        return;
      }

      code = res.code;
      cart.clearCart();
      renderStep3(res.order);
      showStep(2);
      toast(`Pesanan ${code} berhasil dibuat`, 'ok');
    }

    function renderStep3(order) {
      step3.innerHTML = '';

      if (payment === 'QRIS') {
        const canvas = qrCanvas(order.qrisPayload || api.buildQrisPayload(order.code, order.total), { size: 208 });
        const holder = h('div.qris__code');
        holder.append(canvas);

        let remaining = 600;
        const timerLabel = h('div.t-sm', null);

        const tick = () => {
          const m = Math.floor(remaining / 60);
          const s = remaining % 60;
          timerLabel.textContent = `Berlaku ${m}:${String(s).padStart(2, '0')}`;
          if (remaining <= 0) {
            clearInterval(timer);
            timerLabel.textContent = 'Kode QRIS telah kedaluwarsa';
            timerLabel.classList.add('t-coral');
          }
          remaining--;
        };
        tick();
        timer = setInterval(tick, 1000);

        step3.append(
          h('div.t-center', null,
            h('div.badge.badge--info.mt-2', null, icon('qr'), 'Scan untuk membayar'),
            h('div.qris__amount.mt-3', null, rupiah(order.total)),
            h('div.t-sm', null, order.code)
          ),
          h('div.qris.mt-5', null,
            holder,
            h('div', null,
              h('div.t-h3', null, 'Bayar dengan QRIS'),
              h('p.t-body.mt-2', null,
                'Nominal sudah terisi otomatis. Buka aplikasi e-wallet Anda dan pindai kode di samping.'
              ),
              h('div.callout.mt-3', null, icon('clock'), timerLabel),
              h('button.btn.btn--soft.btn--block.mt-3', {
                onclick: () => {
                  api.payOrder(order.code, 'QRIS').then((r) => {
                    if (r.ok) {
                      toast('Pembayaran QRIS dikonfirmasi', 'ok');
                      renderPaid(order);
                    } else {
                      toast(r.error || 'Gagal memproses pembayaran', 'err');
                    }
                  });
                },
              }, icon('check'), 'Simulasikan pembayaran QRIS')
            )
          )
        );
      } else {
        step3.append(
          h('div.t-center', null,
            h('div.badge.badge--ok.mt-2', null, icon('checkCircle'), 'Pesanan dibuat'),
            h('div.qris__amount.mt-3', null, rupiah(order.total)),
            h('div.t-sm', null, order.code)
          ),
          h('div.callout.callout--ok.mt-5', null,
            icon('cash'),
            'Pesanan menunggu pembayaran di kasir. Tunjukkan kode ', h('b', null, order.code), ' kepada kasir.'
          )
        );
      }
    }

    function renderPaid(order) {
      step3.innerHTML = '';
      step3.append(
        h('div.t-center', null,
          h('div.badge.badge--ok.mt-2', null, icon('checkCircle'), 'Pembayaran berhasil'),
          h('div.qris__amount.mt-3', null, rupiah(order.total)),
          h('div.t-sm', null, order.code)
        ),
        h('div.callout.callout--ok.mt-5', null,
          icon('checkCircle'),
          'Pembayaran diterima. Pesanan Anda ',
          h('b', null, order.fulfilment === 'delivery' ? 'sedang diantar' : 'siap diambil'),
          ' di ', h('b', null, state.data.store.name), '.'
        )
      );
    }

    syncPick();
    syncPay();
    updateTotals();
    showStep(0);

    return h('div', null,
      h('div.modal__head', null,
        h('div.grow', null,
          h('h3.t-h2', null, 'Checkout'),
          h('p.t-body', { style: { marginTop: '4px' } }, 'Selesaikan pesanan Anda')
        ),
        h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
      ),
      steps,
      bodyHost,
      foot
    );
  }, { tall: true });
}

/* -------------------------------------------------------------------------
   Order tracking
   ---------------------------------------------------------------------- */

function openTrack(initialCode = '') {
  const input = h('input.input.order-code-input', {
    type: 'text',
    placeholder: 'MK-XXXXX',
    value: initialCode || state.trackCode,
    maxlength: '16',
  });

  const result = h('div.mt-5');

  const lookup = async () => {
    const code = input.value.trim().toUpperCase();
    if (!code) {
      toast('Masukkan kode pesanan', 'warn');
      return;
    }
    state.trackCode = code;
    result.innerHTML = '';
    result.append(h('div.row.gap-3', null, h('span.spinner'), h('span.t-sm', null, 'Mencari pesanan…')));
    const res = await api.trackOrder(code);
    result.innerHTML = '';
    if (!res.ok) {
      result.append(emptyState('search', 'Pesanan tidak ditemukan', `Kode "${code}" tidak terdaftar. Periksa kembali kode yang Anda terima.`));
      return;
    }
    result.append(orderStatus(res.order));
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookup();
  });

  const view = h('div.track', null,
    h('div.t-center', null,
      h('div.badge.badge--info', null, icon('search'), 'Lacak pesanan'),
      h('h2.t-h1.mt-3', null, 'Di mana pesanan saya?'),
      h('p.t-body.mt-2', null, 'Masukkan kode pesanan yang Anda terima saat checkout.')
    ),
    h('div.row.gap-2.mt-5', null,
      h('div.grow', null, input),
      h('button.btn.btn--primary', { onclick: lookup }, 'Lacak')
    ),
    result
  );

  modal((close) =>
    h('div', null,
      h('div.modal__head', null,
        h('div.grow', null, h('h3.t-h2', null, 'Lacak pesanan')),
        h('button.btn.btn--icon.btn--ghost', { onclick: close, 'aria-label': 'Tutup' }, icon('close'))
      ),
      h('div.modal__body', null, view)
    )
  );

  if (input.value.trim()) lookup();
}

const STATUS_FLOW = [
  { key: 'pending', label: 'Menunggu pembayaran', icon: 'clock' },
  { key: 'paid', label: 'Pembayaran diterima', icon: 'wallet' },
  { key: 'preparing', label: 'Pesanan diproses', icon: 'box' },
  { key: 'ready', label: 'Siap diambil / dikirim', icon: 'checkCircle' },
];

function orderStatus(order) {
  const idx = STATUS_FLOW.findIndex((s) => s.key === order.status);
  const cancelled = order.status === 'cancelled';

  const steps = h('div.stepper');
  STATUS_FLOW.forEach((s, i) => {
    const done = !cancelled && idx >= 0 && i < idx;
    const active = !cancelled && i === idx;
    steps.append(
      h('div', { class: `stepper__item ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}` },
        h('div.stepper__rail'),
        h('div.stepper__dot', null, icon(done || active ? 'check' : s.icon)),
        h('div', null,
          h('div.stepper__title', null, s.label),
          h('div.stepper__meta', null,
            i === 0 && order.ts ? fmtDateTime(order.ts) : '',
            i === 1 && order.paidAt ? fmtDateTime(order.paidAt) : ''
          )
        )
      )
    );
  });

  return h('div', null,
    h('div.panel', null,
      h('div.panel__head', null,
        h('div', null,
          h('div.t-h3', null, `Pesanan ${order.code}`),
          h('div.t-sm', null, fmtDateTime(order.ts))
        ),
        h('span', { class: `badge ${cancelled ? 'badge--err' : order.status === 'ready' ? 'badge--ok' : order.status === 'pending' ? 'badge--warn' : 'badge--info'}` },
          cancelled ? 'Kedaluwarsa' : order.status === 'ready' ? 'Siap' : order.status === 'pending' ? 'Menunggu bayar' : 'Diproses')
      ),
      h('div.panel__body', null,
        cancelled
          ? h('div.callout.callout--err', null, icon('xCircle'), 'Pesanan ini kedaluwarsa karena pembayaran tidak diterima dalam 10 menit.')
          : steps,
        order.status === 'pending'
          ? h('div.callout.callout--warn.mt-4', null, icon('clock'), 'Selesaikan pembayaran QRIS Anda agar pesanan diproses.')
          : null
      )
    ),

    h('div.panel.mt-4', null,
      h('div.panel__head', null, h('h3.t-h3', null, 'Detail pesanan')),
      h('div.panel__body.panel__body--flush', null,
        order.items.map((it) =>
          h('div.list-row', null,
            h('div.list-row__img', null, it.image ? h('img', { src: it.image, alt: '' }) : null),
            h('div.grow', null,
              h('div', { style: { fontSize: '13.5px', fontWeight: '600' } }, it.name),
              h('div.t-xs', null, `${it.qty} × ${rupiah(it.price)}`)
            ),
            h('div.t-mono', { style: { fontSize: '13px', fontWeight: '600' } }, rupiah(it.total))
          )
        ),
        h('div.panel__body', null,
          h('div.sum', null,
            h('div.sum__row', null, h('span', null, 'Subtotal'), h('b', null, rupiah(order.subtotal))),
            order.deliveryFee > 0 ? h('div.sum__row', null, h('span', null, 'Ongkir'), h('b', null, rupiah(order.deliveryFee))) : null,
            h('div.sum__row.sum__row--total', null, h('span', null, 'Total'), h('b', null, rupiah(order.total)))
          )
        )
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Footer
   ---------------------------------------------------------------------- */

function footer(data) {
  return h('footer.foot', null,
    h('div.shell', null,
      h('div.foot__grid', null,
        h('div', null,
          h('a.brand', { href: '/' },
            h('span.brand__mark', null, icon('store')),
            h('span', null, data.store.name)
          ),
          h('p.t-sm.mt-3', { style: { maxWidth: '34ch' } }, data.store.tagline),
          h('p.t-sm.mt-3', null, data.store.address)
        ),
        h('div', null,
          h('div.foot__title', null, 'Belanja'),
          h('a.foot__link', { href: '/#katalog' }, 'Semua produk'),
          h('a.foot__link', { href: '/lacak', 'data-nav': 'track' }, 'Lacak pesanan'),
          h('a.foot__link', { href: '/#/kategori' }, 'Kategori')
        ),
        h('div', null,
          h('div.foot__title', null, 'Kontak'),
          h('span.foot__link', null, data.store.phone),
          h('span.foot__link', null, data.store.addressShort || data.store.address)
        ),
        h('div', null,
          h('div.foot__title', null, 'Internal'),
          h('a.foot__link', { href: '/portal' }, 'Portal kasir & owner'),
          h('a.foot__link', { href: '/antrean' }, 'Layar antrean')
        )
      ),
      h('div.row-between.mt-6', null,
        h('span.t-xs', null, `© ${new Date().getFullYear()} ${data.store.name}. Dibuat dengan My Kasir.`),
        h('span.t-xs', null, 'Berjalan penuh secara lokal — data tersimpan di perangkat Anda.')
      )
    )
  );
}

/* -------------------------------------------------------------------------
   Mount
   ---------------------------------------------------------------------- */

export function mountStorefront(view, { track = false, params = [] } = {}) {
  const host = h('div.app');

  const boot = async () => {
    const data = await api.getPublicCatalogData();
    state.data = data;

    const search = h('input.input.input--icon', {
      type: 'search',
      placeholder: 'Cari produk…',
      'data-search': true,
      value: state.query,
      'aria-label': 'Cari produk',
    });

    search.addEventListener('input', debounce(() => {
      state.query = search.value;
      renderGrid();
    }, 200));

    host.append(
      header(data),
      h('main.app__main', null,
        hero(data),
        catalog(data)
      ),
      footer(data)
    );

    // replace the header's search input with the wired one
    const headSearch = host.querySelector('.shop-head__search input');
    if (headSearch) {
      headSearch.replaceWith(search);
      search.addEventListener('input', debounce(() => {
        state.query = search.value;
        renderGrid();
      }, 200));
    }

    renderGrid();

    if (track) {
      openTrack(params[0] || '');
    }

    // pre-fill the track code when arriving from a deep link
    const code = new URLSearchParams(location.search).get('code');
    if (code && !track) openTrack(code);
  };

  view.append(host);
  boot();
}
