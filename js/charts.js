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
 * Pahljača simulacije: pas med p10 in p90, črta mediane, vodoravna črta meje. Dovoli negativne vrednosti.
 * points: [{ label, tooltipLabel, p10, p50, p90 }], opts: { format, axisFormat, threshold, ariaLabel }
 */
export function fanChart(el, points, { format, axisFormat, threshold = null, ariaLabel = '' }) {
  const m = { t: 16, r: 66, b: 28, l: 60 };
  const H = 260;
  const draw = () => {
    const W = Math.round(el.clientWidth);
    if (!W || W === el._drawnWidth) return;
    el._drawnWidth = W;
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = points.flatMap(p => [p.p10, p.p90]).concat(threshold ?? []);
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    if (hi === lo) hi = lo + 100;
    const span = hi - lo;
    const pow = 10 ** Math.floor(Math.log10(span / 4));
    const step = [1, 2, 2.5, 5, 10].map(f => f * pow).find(st => span / st <= 5) ?? 10 * pow;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = i => m.l + (points.length > 1 ? (i / (points.length - 1)) * iw : 0);
    const y = v => m.t + ih - ((v - lo) / (hi - lo)) * ih;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">`;
    for (let t = lo; t <= hi + step / 2; t += step) {
      const yy = Math.round(y(t)) + 0.5;
      s += `<line class="${Math.abs(t) < step / 2 ? 'baseline' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${esc(axisFormat(t))}</text>`;
    }
    const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 48))));
    points.forEach((p, i) => { if (i % every === 0 || i === points.length - 1) s += `<text class="xlabel" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>`; });
    const path = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    s += `<path class="band" d="${path('p90')}${[...points].reverse().map((p, n) => `L${x(points.length - 1 - n).toFixed(1)},${y(p.p10).toFixed(1)}`).join('')}Z"/>`;
    if (threshold != null) s += `<line class="limit" x1="${m.l}" x2="${W - m.r}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}"/>`;
    s += `<path class="series mid" d="${path('p50')}"/>`;
    const end = points.at(-1);
    s += `<circle class="dot mid" cx="${x(points.length - 1)}" cy="${y(end.p50)}" r="4"/><text class="end" x="${x(points.length - 1) + 8}" y="${y(end.p50)}" dominant-baseline="middle">${esc(axisFormat(end.p50))}</text>`;
    el.innerHTML = `${s}</svg>`;
    el._geom = { x, iw };
  };
  el.onpointermove = e => {
    const svg = el.querySelector('svg');
    if (!svg || !el._geom) return;
    const px = e.clientX - svg.getBoundingClientRect().left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - m.l) / el._geom.iw) * (points.length - 1))));
    const p = points[i];
    showTip(`<div class="tip-title">${esc(p.tooltipLabel ?? p.label)}</div>
      <div class="tip-row"><span>Verjetno</span><b>${esc(format(p.p50))}</b></div>
      <div class="tip-row"><span>8 od 10 primerov</span><b>${esc(axisFormat(p.p10))} – ${esc(axisFormat(p.p90))}</b></div>`, e.clientX, e.clientY);
  };
  el.onpointerleave = hideTip;
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

/** Lestvica od min do max (oba lahko negativna), z 0 med oznakami. */
function signedScale(min, max, count = 4) {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const bottom = Math.floor(lo / step) * step;
  const top = Math.ceil(hi / step) * step || step;
  const ticks = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { bottom, top, ticks };
}

/**
 * Stolpci s predznakom (npr. prihranek po mesecih): pozitivni navzgor, negativni navzdol od osnovne črte.
 * data: [{ key, label, tooltipLabel, value, rows?: [[ime, vrednost]] }], opts: { format, axisFormat, ariaLabel }
 */
export function signedColumnChart(el, data, { format, axisFormat, ariaLabel = '' }) {
  const draw = () => {
    const W = Math.round(el.clientWidth);
    if (!W || W === el._drawnWidth) return;
    el._drawnWidth = W;
    const H = 210;
    const m = { t: 16, r: 4, b: 28, l: 56 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const { bottom, top, ticks } = signedScale(Math.min(...data.map(d => d.value)), Math.max(...data.map(d => d.value)));
    const y = v => m.t + ((top - v) / (top - bottom)) * ih;
    const band = iw / data.length;
    const bw = Math.max(6, Math.min(24, band * 0.62));
    const sparse = band < 40;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">`;
    for (const t of ticks) {
      const yy = Math.round(y(t)) + 0.5;
      s += `<line class="${t === 0 ? 'baseline' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${esc(axisFormat(t))}</text>`;
    }
    const y0 = y(0);
    data.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      const h = Math.abs(y(d.value) - y0);
      if (h > 0.5) {
        // zaobljen konec stran od osnovne črte
        const path = d.value >= 0 ? barPath(cx - bw / 2, y0 - h, bw, h, 4)
          : `M${cx - bw / 2},${y0}V${y0 + h - Math.min(4, h)}A4,4 0 0 0 ${cx - bw / 2 + 4},${y0 + h}H${cx + bw / 2 - 4}A4,4 0 0 0 ${cx + bw / 2},${y0 + h - Math.min(4, h)}V${y0}Z`;
        s += `<path class="bar ${d.value >= 0 ? 'pos' : 'neg'}" d="${path}"/>`;
      }
      if (!sparse || (data.length - 1 - i) % 2 === 0) s += `<text class="xlabel" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
      s += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih + m.b}"/>`;
    });
    el.innerHTML = `${s}</svg>`;
  };
  const tipFor = e => {
    const i = e.target.dataset?.i;
    if (i == null) return hideTip();
    const d = data[i];
    showTip(`<div class="tip-title">${esc(d.tooltipLabel)}</div><div class="tip-value">${esc(format(d.value))}</div>
      ${(d.rows ?? []).map(([k, v]) => `<div class="tip-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}`, e.clientX, e.clientY);
  };
  el.onpointermove = tipFor;
  el.onpointerdown = tipFor;
  el.onpointerleave = hideTip;
  el.onclick = null;
  el._drawnWidth = 0;
  draw();
  el._resizeObserver?.disconnect();
  el._resizeObserver = new ResizeObserver(draw);
  el._resizeObserver.observe(el);
}

/**
 * Črte (ena ali dve seriji) z namigom in navpično črto ob prehodu. Vrednosti so lahko null (črta se tam konča).
 * labels: [oznaka x], series: [{ name, cls: 'mid' | 'invested', values }], opts: { format, axisFormat, tooltipTitle(i), xEvery, ariaLabel }
 */
export function lineChart(el, labels, series, { format, axisFormat, tooltipTitle = i => labels[i], ariaLabel = '' }) {
  const m = { t: 16, r: 64, b: 28, l: 56 };
  const H = 220;
  let geo = null;
  const draw = () => {
    const W = Math.round(el.clientWidth);
    if (!W || W === el._drawnWidth) return;
    el._drawnWidth = W;
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const all = series.flatMap(s => s.values).filter(v => v != null);
    const { bottom, top, ticks } = signedScale(Math.min(0, ...all), Math.max(0, ...all));
    const n = labels.length;
    const x = i => m.l + (n > 1 ? (i / (n - 1)) * iw : 0);
    const y = v => m.t + ((top - v) / (top - bottom)) * ih;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">`;
    for (const t of ticks) {
      const yy = Math.round(y(t)) + 0.5;
      s += `<line class="${t === 0 ? 'baseline' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${esc(axisFormat(t))}</text>`;
    }
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 44))));
    labels.forEach((l, i) => { if ((n - 1 - i) % every === 0) s += `<text class="xlabel" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
    const ends = [];
    for (const se of series) {
      let d = '', pen = false, last = null;
      se.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
        last = i;
      });
      if (d) s += `<path class="series ${se.cls}" d="${d}"/>`;
      if (last != null) {
        s += `<circle class="dot ${se.cls}" cx="${x(last)}" cy="${y(se.values[last])}" r="4"/>`;
        ends.push({ yy: y(se.values[last]), x: x(last), v: se.values[last] });
      }
    }
    // Končne oznake: druga se izpusti, če bi se prekrivala s prvo
    ends.forEach((e, k) => {
      if (k && ends.slice(0, k).some(o => Math.abs(o.yy - e.yy) < 16 && Math.abs(o.x - e.x) < 60)) return;
      s += `<text class="end" x="${e.x + 8}" y="${Math.max(m.t + 6, e.yy)}" dominant-baseline="middle">${esc(axisFormat(e.v))}</text>`;
    });
    s += `<g class="cross" visibility="hidden"><line y1="${m.t}" y2="${m.t + ih}"/>${series.map(se => `<circle class="dot ${se.cls}" r="4"/>`).join('')}</g>`;
    el.innerHTML = `${s}</svg>`;
    geo = { x, y, n };
  };
  el.onpointermove = e => {
    const svg = el.querySelector('svg');
    if (!svg || !geo) return;
    const px = e.clientX - svg.getBoundingClientRect().left;
    const iw = el._drawnWidth - m.l - m.r;
    const i = Math.max(0, Math.min(geo.n - 1, Math.round(((px - m.l) / iw) * (geo.n - 1))));
    const cross = svg.querySelector('.cross');
    cross.setAttribute('visibility', 'visible');
    const line = cross.querySelector('line');
    line.setAttribute('x1', geo.x(i));
    line.setAttribute('x2', geo.x(i));
    cross.querySelectorAll('circle').forEach((c, k) => {
      const v = series[k].values[i];
      c.setAttribute('visibility', v == null ? 'hidden' : 'visible');
      if (v != null) { c.setAttribute('cx', geo.x(i)); c.setAttribute('cy', geo.y(v)); }
    });
    const rows = series.filter(se => se.values[i] != null).map(se => `<div class="tip-row"><span>${esc(se.name)}</span><b>${esc(format(se.values[i]))}</b></div>`).join('');
    showTip(`<div class="tip-title">${esc(tooltipTitle(i))}</div>${rows}`, e.clientX, e.clientY);
  };
  el.onpointerdown = el.onpointermove;
  el.onpointerleave = () => { hideTip(); el.querySelector('.cross')?.setAttribute('visibility', 'hidden'); };
  el.onclick = null;
  el._drawnWidth = 0;
  draw();
  el._resizeObserver?.disconnect();
  el._resizeObserver = new ResizeObserver(draw);
  el._resizeObserver.observe(el);
}
