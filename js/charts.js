// Stolpični graf v SVG: tanki stolpci, zaobljen vrh, namig ob prehodu z miško.

import { esc, showTip, hideTip } from './ui.js';

function niceScale(max, count = 4) {
  if (max <= 0) return { top: 100, ticks: [0, 25, 50, 75, 100] };
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}

// Stolpec z zaobljenim vrhom (4px) in ravnim dnom na osnovni črti.
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Rast naložbe: črta »vloženo«, črta pričakovane vrednosti in pas razpona med nizkim in visokim scenarijem.
 * points: [{ label, tooltipLabel, yearLabel, invested, low, mid, high }] (low/mid/high so v preteklosti null)
 * opts: { format, axisFormat, ariaLabel }
 */
export function projectionChart(el, points, { format, axisFormat, ariaLabel = '' }) {
  const m = { t: 16, r: 66, b: 28, l: 56 };
  const H = 280;
  let scaleX = () => 0;
  let geometry = null;

  const draw = () => {
    const W = Math.round(el.clientWidth);
    if (!W || W === el._drawnWidth) return;
    el._drawnWidth = W;

    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const { top, ticks } = niceScale(Math.max(0, ...points.map(p => Math.max(p.high ?? 0, p.invested))));
    const x = i => m.l + (points.length > 1 ? (i / (points.length - 1)) * iw : 0);
    const y = v => m.t + ih - (Math.max(0, v) / top) * ih;
    scaleX = x;
    const line = (key, list) => list.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');

    const all = points.map((p, i) => ({ ...p, i }));
    const future = all.filter(p => p.mid != null);
    const end = all.at(-1);

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">`;
    for (const t of ticks) {
      const yy = Math.round(y(t)) + 0.5;
      s += `<line class="${t === 0 ? 'baseline' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${esc(axisFormat(t))}</text>`;
    }

    // Oznake let na osi x: največ toliko, kot jih gre na širino
    const labelled = all.filter(p => p.yearLabel);
    const every = Math.max(1, Math.ceil(labelled.length / Math.max(2, Math.floor(iw / 56))));
    labelled.filter((_, n) => n % every === 0).forEach(p => {
      s += `<text class="xlabel" x="${x(p.i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(p.yearLabel)}</text>`;
    });

    if (future.length) {
      const band = `${line('high', future)}${[...future].reverse().map(p => `L${x(p.i).toFixed(1)},${y(p.low).toFixed(1)}`).join('')}Z`;
      s += `<path class="band" d="${band}"/>`;
      if (future[0].i > 0) {
        const tx = x(future[0].i).toFixed(1);
        s += `<line class="today" x1="${tx}" x2="${tx}" y1="${m.t}" y2="${m.t + ih}"/>`;
      }
    }
    s += `<path class="series invested" d="${line('invested', all)}"/>`;
    if (future.length) s += `<path class="series mid" d="${line('mid', future)}"/>`;

    // Končni oznaki: vrednost ob koncu črte; če bi se prekrivali, ostane le zgornja (ostalo je v namigu in tabeli)
    const labelY = v => Math.max(m.t + 6, y(v));
    if (future.length) {
      s += `<circle class="dot mid" cx="${x(end.i)}" cy="${y(end.mid)}" r="4"/>`;
      s += `<text class="end" x="${x(end.i) + 8}" y="${labelY(end.mid)}" dominant-baseline="middle">${esc(axisFormat(end.mid))}</text>`;
    }
    s += `<circle class="dot invested" cx="${x(end.i)}" cy="${y(end.invested)}" r="4"/>`;
    if (!future.length || Math.abs(y(end.mid) - y(end.invested)) >= 16) {
      s += `<text class="end" x="${x(end.i) + 8}" y="${labelY(end.invested)}" dominant-baseline="middle">${esc(axisFormat(end.invested))}</text>`;
    }

    s += `<g class="cross" visibility="hidden"><line y1="${m.t}" y2="${m.t + ih}"/><circle class="dot mid" r="4"/><circle class="dot invested" r="4"/></g>`;
    el.innerHTML = `${s}</svg>`;
    geometry = { y };
  };

  el.onpointermove = e => {
    const svg = el.querySelector('svg');
    if (!svg || !geometry) return;
    const px = e.clientX - svg.getBoundingClientRect().left;
    const iw = el._drawnWidth - m.l - m.r;
    const i = Math.round(((px - m.l) / iw) * (points.length - 1));
    const p = points[Math.max(0, Math.min(points.length - 1, i))];
    const idx = points.indexOf(p);
    const cross = svg.querySelector('.cross');
    const cx = scaleX(idx);
    cross.setAttribute('visibility', 'visible');
    const line = cross.querySelector('line');
    line.setAttribute('x1', cx);
    line.setAttribute('x2', cx);
    const dotMid = cross.querySelector('.dot.mid');
    const dotInv = cross.querySelector('.dot.invested');
    dotInv.setAttribute('cx', cx);
    dotInv.setAttribute('cy', geometry.y(p.invested));
    dotMid.setAttribute('visibility', p.mid == null ? 'hidden' : 'visible');
    if (p.mid != null) {
      dotMid.setAttribute('cx', cx);
      dotMid.setAttribute('cy', geometry.y(p.mid));
    }
    showTip(`<div class="tip-title">${esc(p.tooltipLabel)}</div>
      ${p.mid != null ? `<div class="tip-row"><span>Pričakovano</span><b>${esc(format(p.mid))}</b></div>
      <div class="tip-row"><span>Razpon</span><b>${esc(axisFormat(p.low))} – ${esc(axisFormat(p.high))}</b></div>` : ''}
      <div class="tip-row"><span>Vloženo</span><b>${esc(format(p.invested))}</b></div>`, e.clientX, e.clientY);
  };
  el.onpointerleave = () => {
    hideTip();
    el.querySelector('.cross')?.setAttribute('visibility', 'hidden');
  };
  el.onpointerdown = null;
  el.onclick = null;

  el._drawnWidth = 0;
  draw();
  el._resizeObserver?.disconnect();
  el._resizeObserver = new ResizeObserver(draw);
  el._resizeObserver.observe(el);
}

/**
 * data: [{ key, label, tooltipLabel, value, selected }]
 * opts: { format, axisFormat, onSelect, ariaLabel }
 */
export function columnChart(el, data, { format, axisFormat, onSelect, ariaLabel = '' }) {
  const draw = () => {
    const W = Math.round(el.clientWidth);
    if (!W || W === el._drawnWidth) return;
    el._drawnWidth = W;

    const H = 210;
    const m = { t: 24, r: 4, b: 28, l: 56 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const { top, ticks } = niceScale(Math.max(0, ...data.map(d => d.value)));
    const band = iw / data.length;
    const bw = Math.max(6, Math.min(24, band * 0.62));
    const y = v => m.t + ih - (Math.max(0, v) / top) * ih;
    const sparseLabels = band < 40;

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">`;
    for (const t of ticks) {
      const yy = Math.round(y(t)) + 0.5;
      s += `<line class="${t === 0 ? 'baseline' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${esc(axisFormat(t))}</text>`;
    }
    data.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      const yTop = y(d.value);
      const h = m.t + ih - yTop;
      if (h > 0.5) s += `<path class="bar${d.selected ? ' sel' : ''}" d="${barPath(cx - bw / 2, yTop, bw, h, 4)}"/>`;
      if (d.selected && d.value > 0) s += `<text class="cap" x="${cx}" y="${yTop - 8}" text-anchor="middle">${esc(axisFormat(d.value))}</text>`;
      if (!sparseLabels || (data.length - 1 - i) % 2 === 0 || d.selected) {
        s += `<text class="xlabel${d.selected ? ' sel' : ''}" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
      }
      s += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih + m.b}"/>`;
    });
    el.innerHTML = `${s}</svg>`;
  };

  const tipFor = e => {
    const i = e.target.dataset?.i;
    if (i == null) return hideTip();
    const d = data[i];
    showTip(`<div class="tip-title">${esc(d.tooltipLabel)}</div><div class="tip-value">${esc(format(d.value))}</div>`, e.clientX, e.clientY);
  };
  el.onpointermove = tipFor;
  el.onpointerdown = tipFor;
  el.onpointerleave = hideTip;
  el.onclick = e => {
    const i = e.target.dataset?.i;
    if (i != null && onSelect) { hideTip(); onSelect(data[i].key); }
  };

  el._drawnWidth = 0;
  draw();
  el._resizeObserver?.disconnect();
  el._resizeObserver = new ResizeObserver(draw);
  el._resizeObserver.observe(el);
}
