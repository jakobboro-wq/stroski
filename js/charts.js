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
