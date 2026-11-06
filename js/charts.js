/* My Kasir — dependency-free SVG chart engine.
 *
 * Every chart returns real DOM nodes so they compose with the rest of the app
 * and re-render on resize. All charts share one visual language: soft rounded
 * bars, a single accent colour per series, dashed gridlines and no axes
 * chrome beyond what the data needs.
 */

import { h, rupiah, numberShort } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v);
  }
  return el;
}

/** Append a <title> tooltip to a chart element. */
function addTitle(el, text) {
  const t = svgEl('title', {});
  t.textContent = text;
  el.append(t);
}

function svgRoot(w = 720, hgt = 260) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${hgt}`,
    preserveAspectRatio: 'none',
    class: 'chart__svg',
    role: 'img',
  });
  svg.style.width = '100%';
  svg.style.height = '100%';
  return svg;
}

/** Smooth cubic path through points (Catmull-Rom → Bézier). */
function smoothPath(pts, tension = 0.36) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/* -------------------------------------------------------------------------
   Area + line chart
   ---------------------------------------------------------------------- */
export function areaChart(data, opts = {}) {
  const {
    height = 260,
    valueKey = 'value',
    labelKey = 'label',
    color = '#2F4BFF',
    format = rupiah,
    showGrid = true,
    showDots = true,
    fill = true,
  } = opts;

  const W = 720;
  const H = height;
  const padL = 14;
  const padR = 14;
  const padT = 18;
  const padB = 34;

  const svg = svgRoot(W, H);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = data.map((d) => Number(d[valueKey]) || 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const xAt = (i) => padL + (data.length <= 1 ? innerW / 2 : (innerW * i) / (data.length - 1));
  const yAt = (v) => padT + innerH - ((v - min) / span) * innerH;

  if (showGrid) {
    for (let g = 0; g <= 3; g++) {
      const y = padT + (innerH * g) / 3;
      svg.append(svgEl('line', {
        x1: padL, x2: W - padR, y1: y, y2: y,
        class: 'chart__grid',
      }));
    }
  }

  const pts = values.map((v, i) => [xAt(i), yAt(v)]);

  if (fill && pts.length) {
    const gid = `grad_${Math.random().toString(36).slice(2, 8)}`;
    const defs = svgEl('defs');
    const lg = svgEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
    lg.append(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.34' }));
    lg.append(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
    defs.append(lg);
    svg.append(defs);

    const areaD = `${smoothPath(pts)} L ${pts[pts.length - 1][0]} ${padT + innerH} L ${pts[0][0]} ${padT + innerH} Z`;
    svg.append(svgEl('path', { d: areaD, fill: `url(#${gid})`, class: 'chart__area' }));
  }

  if (pts.length) {
    svg.append(svgEl('path', {
      d: smoothPath(pts),
      fill: 'none',
      stroke: color,
      'stroke-width': '2.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'chart__line',
    }));
  }

  if (showDots) {
    pts.forEach((p, i) => {
      const dot = svgEl('circle', {
        cx: p[0], cy: p[1], r: '4.5',
        fill: '#fff', stroke: color, 'stroke-width': '2.4',
        class: 'chart__dot',
      });
      addTitle(dot, `${data[i][labelKey]}: ${format(values[i])}`);
      svg.append(dot);
    });
  }

  // x labels — thin them out when crowded
  const step = Math.ceil(data.length / 8);
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== data.length - 1) return;
    const t = svgEl('text', {
      x: xAt(i), y: H - 12,
      'text-anchor': 'middle',
      class: 'chart__label',
    });
    t.textContent = d[labelKey];
    svg.append(t);
  });

  return svg;
}

/* -------------------------------------------------------------------------
   Vertical bars
   ---------------------------------------------------------------------- */
export function barChart(data, opts = {}) {
  const {
    height = 260,
    valueKey = 'value',
    labelKey = 'label',
    color = '#2F4BFF',
    format = rupiah,
    stacked = false,
    series = null, // [{ key, label, color }]
  } = opts;

  const W = 720;
  const H = height;
  const padL = 14;
  const padR = 14;
  const padT = 18;
  const padB = 34;

  const svg = svgRoot(W, H);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const totals = data.map((d) =>
    stacked && series
      ? series.reduce((s, sr) => s + (Number(d[sr.key]) || 0), 0)
      : Number(d[valueKey]) || 0
  );
  const max = Math.max(...totals, 1);

  for (let g = 0; g <= 3; g++) {
    const y = padT + (innerH * g) / 3;
    svg.append(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'chart__grid' }));
  }

  const slot = innerW / Math.max(data.length, 1);
  const barW = Math.min(slot * 0.56, 34);

  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;

    if (stacked && series) {
      let acc = 0;
      series.forEach((sr) => {
        const v = Number(d[sr.key]) || 0;
        if (v <= 0) return;
        const h = (v / max) * innerH;
        const y = padT + innerH - h - acc;
        const rect = svgEl('rect', {
          x: cx - barW / 2, y, width: barW, height: Math.max(h, 1),
          rx: Math.min(7, barW / 3), fill: sr.color, class: 'chart__bar',
        });
        addTitle(rect, `${sr.label}: ${format(v)}`);
        svg.append(rect);
        acc += h;
      });
    } else {
      const v = Number(d[valueKey]) || 0;
      const h = (v / max) * innerH;
      const rect = svgEl('rect', {
        x: cx - barW / 2,
        y: padT + innerH - h,
        width: barW,
        height: Math.max(h, 2),
        rx: Math.min(7, barW / 3),
        fill: color,
        class: 'chart__bar',
      });
      addTitle(rect, `${d[labelKey]}: ${format(v)}`);
      svg.append(rect);
    }

    const step = Math.ceil(data.length / 8);
    if (i % step === 0 || i === data.length - 1) {
      const t = svgEl('text', { x: cx, y: H - 12, 'text-anchor': 'middle', class: 'chart__label' });
      t.textContent = d[labelKey];
      svg.append(t);
    }
  });

  return svg;
}

/* -------------------------------------------------------------------------
   Horizontal bars (top products)
   ---------------------------------------------------------------------- */
export function hBarChart(data, opts = {}) {
  const {
    valueKey = 'value',
    labelKey = 'label',
    color = '#2F4BFF',
    format = rupiah,
  } = opts;

  const wrap = h('div.hbars');
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);

  data.forEach((d) => {
    const v = Number(d[valueKey]) || 0;
    const pctv = (v / max) * 100;
    wrap.append(
      h('div.hbar', null,
        h('div.hbar__top', null,
          h('span.hbar__label', null, d[labelKey]),
          h('span.hbar__value', null, format(v))
        ),
        h('div.hbar__track', null,
          h('div.hbar__fill', { style: { width: `${pctv}%`, background: d.color || color } })
        )
      )
    );
  });

  return wrap;
}

/* -------------------------------------------------------------------------
   Donut
   ---------------------------------------------------------------------- */
export function donutChart(data, opts = {}) {
  const { size = 200, thickness = 26, centerLabel = '', centerValue = '', format = rupiah } = opts;

  const svg = svgRoot(size, size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.aspectRatio = '1 / 1';
  svg.style.maxHeight = `${size}px`;

  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2 - 4;

  const track = svgEl('circle', {
    cx, cy, r, fill: 'none',
    stroke: 'rgba(16,22,43,0.08)', 'stroke-width': thickness,
  });
  svg.append(track);

  if (total > 0) {
    const C = 2 * Math.PI * r;
    let offset = 0;
    data.forEach((d) => {
      const v = Number(d.value) || 0;
      if (v <= 0) return;
      const frac = v / total;
      const seg = svgEl('circle', {
        cx, cy, r, fill: 'none',
        stroke: d.color,
        'stroke-width': thickness,
        'stroke-dasharray': `${(C * frac).toFixed(2)} ${C.toFixed(2)}`,
        'stroke-dashoffset': (-C * offset).toFixed(2),
        'stroke-linecap': 'butt',
        transform: `rotate(-90 ${cx} ${cy})`,
        class: 'chart__seg',
      });
      addTitle(seg, `${d.label}: ${format(v)}`);
      svg.append(seg);
      offset += frac;
    });
  }

  if (centerValue) {
    const t1 = svgEl('text', {
      x: cx, y: cy - 2, 'text-anchor': 'middle',
      class: 'chart__donutValue',
    });
    t1.textContent = centerValue;
    const t2 = svgEl('text', {
      x: cx, y: cy + 18, 'text-anchor': 'middle',
      class: 'chart__donutLabel',
    });
    t2.textContent = centerLabel;
    svg.append(t1, t2);
  }

  return svg;
}

/* -------------------------------------------------------------------------
   Sparkline (tiny inline trend)
   ---------------------------------------------------------------------- */
export function sparkline(data, opts = {}) {
  const { valueKey = 'value', color = '#2F4BFF', height = 44, width = 140 } = opts;
  const svg = svgRoot(width, height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const values = data.map((d) => Number(d[valueKey]) || 0);
  if (!values.length) return svg;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pad = 5;

  const pts = values.map((v, i) => [
    values.length === 1 ? width / 2 : (i * (width - pad * 2)) / (values.length - 1) + pad,
    height - pad - ((v - min) / span) * (height - pad * 2),
  ]);

  const gid = `sp_${Math.random().toString(36).slice(2, 8)}`;
  const defs = svgEl('defs');
  const lg = svgEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
  lg.append(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.3' }));
  lg.append(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
  defs.append(lg);
  svg.append(defs);

  svg.append(svgEl('path', {
    d: `${smoothPath(pts)} L ${pts[pts.length - 1][0]} ${height} L ${pts[0][0]} ${height} Z`,
    fill: `url(#${gid})`,
  }));
  svg.append(svgEl('path', {
    d: smoothPath(pts), fill: 'none', stroke: color,
    'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  return svg;
}

/* -------------------------------------------------------------------------
   Heat calendar (busiest hours × weekdays)
   ---------------------------------------------------------------------- */
export function heatMap(cells, opts = {}) {
  const { color = '#2F4BFF' } = opts;
  const wrap = h('div.heat');
  const max = Math.max(...cells.map((c) => c.value), 1);

  cells.forEach((c) => {
    const alpha = c.value ? 0.16 + (c.value / max) * 0.84 : 0.05;
    const cell = h('div.heat__cell', {
      style: { background: c.value ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : 'rgba(16,22,43,0.05)' },
      title: `${c.label}: ${rupiah(c.value)}`,
    });
    wrap.append(cell);
  });

  return wrap;
}

/* -------------------------------------------------------------------------
   Progress ring
   ---------------------------------------------------------------------- */
export function ringChart(percent, opts = {}) {
  const { size = 120, thickness = 12, color = '#0FBFA8', label = '' } = opts;
  const svg = svgRoot(size, size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.aspectRatio = '1 / 1';

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2 - 2;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));

  svg.append(svgEl('circle', {
    cx, cy, r, fill: 'none', stroke: 'rgba(16,22,43,0.08)', 'stroke-width': thickness,
  }));
  if (p > 0) {
    svg.append(svgEl('circle', {
      cx, cy, r, fill: 'none', stroke: color, 'stroke-width': thickness,
      'stroke-dasharray': `${(C * p) / 100} ${C}`,
      'stroke-linecap': 'round',
      transform: `rotate(-90 ${cx} ${cy})`,
    }));
  }
  const t = svgEl('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', class: 'chart__donutValue' });
  t.textContent = `${Math.round(p)}%`;
  svg.append(t);
  if (label) {
    const t2 = svgEl('text', { x: cx, y: cy + 24, 'text-anchor': 'middle', class: 'chart__donutLabel' });
    t2.textContent = label;
    svg.append(t2);
  }
  return svg;
}

/* -------------------------------------------------------------------------
   Legend
   ---------------------------------------------------------------------- */
export function legend(items) {
  return h('div.legend', ...items.map((it) =>
    h('div.legend__item', null,
      h('span.legend__dot', { style: { background: it.color } }),
      h('span.legend__label', null, it.label),
      h('span.legend__value', null, it.value)
    )
  ));
}

export { numberShort };
