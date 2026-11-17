// Pregled → Statistika: prihranki po mesecih, tempo porabe, dnevi v tednu, kategorije skozi čas.

import { state, category, kindOf, topOf, BASE_CURRENCY } from '../store.js';
import { buildIndex } from '../stats.js';
import { periodMonths, monthlySavings, savingsSummary, spendPace, weekdaySpend, categoryTrends } from '../statistics.js';
import { savings as shopSavings } from '../pantry.js';
import { signedColumnChart, lineChart, columnChart } from '../charts.js';
import { esc, money, money0, signedMoney, monthLabel, currentMonth, todayISO } from '../ui.js';

const PERIODS = [{ n: 6, label: '6 mesecev' }, { n: 12, label: '12 mesecev' }, { n: null, label: 'Vse' }];
const WEEKDAYS = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];
const WEEKDAYS_LONG = ['ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota', 'nedelja'];
const WEEKDAYS_ON = ['v ponedeljek', 'v torek', 'v sredo', 'v četrtek', 'v petek', 'v soboto', 'v nedeljo'];
const UI_KEY = 'stat-ui';
const signed0 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money0(Math.abs(v))}`;
const pct = v => `${Math.round(v * 100)} %`;
const short = m => monthLabel(m, 'short').replace('.', '');

function ui() {
  try { return { period: 12, savings: 'month', ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }; } catch { return { period: 12, savings: 'month' }; }
}
function setUi(changes, view) {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ ...ui(), ...changes })); } catch { /* ni nujno */ }
  renderStatistics(view);
}

/** Podzavihka Pregleda: Mesec in Statistika. */
export const overviewTabs = active => `
  <nav class="subtabs" aria-label="Pregled">
    <a href="#/pregled"${active === 'pregled' ? ' class="on" aria-current="page"' : ''}>📅 Mesec</a>
    <a href="#/statistika"${active === 'statistika' ? ' class="on" aria-current="page"' : ''}>📈 Statistika</a>
  </nav>`;

/** Majhen stolpčni graf v vrstici (zadnji mesec poudarjen). */
function spark(values, months) {
  const max = Math.max(...values, 1);
  const w = 6, gap = 2, h = 26;
  const bars = values.map((v, i) => {
    const bh = Math.max(v > 0 ? 2 : 0, (v / max) * h);
    return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2" class="${i === values.length - 1 ? 'last' : ''}"><title>${esc(monthLabel(months[i]))}: ${esc(money0(v))}</title></rect>`;
  }).join('');
  return `<svg class="spark" width="${values.length * (w + gap) - gap}" height="${h}" viewBox="0 0 ${values.length * (w + gap) - gap} ${h}" role="img" aria-label="Poraba po mesecih">${bars}</svg>`;
}

export function renderStatistics(view) {
  const today = todayISO();
  const month = currentMonth();
  const u = ui();
  const idx = buildIndex(state.transactions, kindOf, BASE_CURRENCY);
  const months = periodMonths(idx.first, month, u.period);
  const head = `
    <header class="page-head"><h1>Statistika</h1></header>
    ${overviewTabs('statistika')}`;
  if (!months.length) {
    view.innerHTML = `${head}<p class="muted">Ko bodo v aplikaciji transakcije, tu vidiš prihranke, tempo porabe in kategorije skozi čas.</p>`;
    return;
  }

  const rows = monthlySavings(idx, months);
  // Tekoči mesec še ni zaključen: v povzetku ga ne štejem, na grafu je označen.
  const done = rows.filter(r => r.month < month);
  const sum = savingsSummary(done.length ? done : rows);
  const from = `${months[0]}-01`;
  const shop = shopSavings(state.transactions, from, today);
  const pace = spendPace(state.transactions, kindOf, month, today, { base: BASE_CURRENCY });
  const day = Number(today.slice(8, 10));
  const nowSpent = pace.current[day - 1] ?? 0;
  const usual = pace.average?.[day - 1] ?? null;
  const weekdays = weekdaySpend(state.transactions, kindOf, from, today, BASE_CURRENCY);
  const topDay = weekdays.indexOf(Math.max(...weekdays));
  const trends = categoryTrends(idx, months, topOf);
  const periodLabel = u.period ? `zadnjih ${done.length} zaključenih mesecev` : 'vseh zaključenih mesecev';

  view.innerHTML = `
    ${head}
    <div class="chips-row" role="group" aria-label="Obdobje">
      ${PERIODS.map(p => `<button type="button" class="fchip${u.period === p.n ? ' on' : ''}" data-period="${p.n ?? 'all'}">${p.label}</button>`).join('')}
    </div>

    <div class="tiles four">
      <div class="tile"><div class="tile-label">Prihranjeno</div><div class="tile-value ${sum.saved >= 0 ? 'good' : 'bad'}">${esc(signed0((sum.saved)))}</div></div>
      <div class="tile"><div class="tile-label">Od prihodkov ostane</div><div class="tile-value">${sum.rate == null ? '–' : esc(pct(sum.rate))}</div></div>
      <div class="tile"><div class="tile-label">Povprečno na mesec</div><div class="tile-value ${sum.perMonth >= 0 ? 'good' : 'bad'}">${esc(signed0((sum.perMonth)))}</div></div>
      ${shop.total > 0
        ? `<a class="tile tile-link" href="#/zaloga"><div class="tile-label">Pri nakupih prihranjeno</div><div class="tile-value good">${esc(money(shop.total))}</div></a>`
        : `<div class="tile"><div class="tile-label">Najboljši mesec</div><div class="tile-value">${esc(monthLabel(sum.best.month, 'short'))} ${esc(signed0((sum.best.saved)))}</div></div>`}
    </div>
    <p class="muted small">Prihranek = prihodki − poraba (prenosi med računi in nakupi delnic ne štejejo), za ${esc(periodLabel)}.${shop.total > 0 ? ' Pri nakupih: popusti na računih in nakupi pod tvojo običajno ceno.' : ''}</p>

    <section class="card">
      <div class="card-head"><h2>Prihranek</h2>
        <div class="seg-mini" role="group" aria-label="Prikaz">
          <button type="button" data-sv="month" class="${u.savings === 'month' ? 'on' : ''}">Po mesecih</button>
          <button type="button" data-sv="cum" class="${u.savings === 'cum' ? 'on' : ''}">Skupaj</button>
        </div></div>
      <div class="chart" id="savChart"></div>
      <p class="muted small">${sum.worst.saved < 0 ? `Najslabši mesec: ${esc(monthLabel(sum.worst.month))} (${esc(signed0((sum.worst.saved)))}). ` : ''}Tekoči mesec je štet do danes.</p>
    </section>

    <div class="two-col">
      <section class="card">
        <div class="card-head"><h2>Tempo porabe ta mesec</h2>
          ${pace.average ? `<div class="legend"><span><i class="key-line mid"></i>ta mesec</span><span><i class="key-line invested"></i>običajno</span></div>` : ''}</div>
        <div class="chart" id="paceChart"></div>
        <p class="small">${usual == null
          ? 'Primerjava se pokaže, ko bo vsaj en pretekli mesec podatkov.'
          : `Do danes ${esc(money0(nowSpent))}, običajno do ${day}. v mesecu ${esc(money0(usual))}${usual > 0 ? ` (<b class="${nowSpent > usual ? 'bad' : 'good'}">${nowSpent > usual ? '+' : '−'}${Math.round(Math.abs(nowSpent - usual) / usual * 100)} %</b>)` : ''}. Običajno = povprečje zadnjih ${pace.months.length} mesecev.`}</p>
      </section>

      <section class="card">
        <h2>Po dnevih v tednu</h2>
        <div class="chart" id="wdChart"></div>
        <p class="muted small">Povprečna poraba na dan brez ponavljajočih stroškov. Največ zapraviš ${esc(WEEKDAYS_ON[topDay])}.</p>
      </section>
    </div>

    <section class="card">
      <h2>Kategorije skozi čas</h2>
      <div class="st-cats">${trends.slice(0, 12).map(t => {
        const c = category(t.id);
        const ch = t.change;
        return `<a class="st-cat" href="#/transakcije?c=${esc(t.id)}">
          <span class="st-name">${esc(c?.emoji ?? '')} ${esc(c?.name ?? t.id)}</span>
          ${spark(t.values, months)}
          <span class="st-avg">${esc(money0(t.avg))}<small>/mesec</small></span>
          <span class="st-ch ${ch == null || Math.abs(ch) < 0.05 ? 'muted' : ch > 0 ? 'bad' : 'good'}">${ch == null ? '' : Math.abs(ch) < 0.05 ? '≈' : `${ch > 0 ? '▲' : '▼'} ${Math.round(Math.abs(ch) * 100)} %`}</span>
        </a>`;
      }).join('')}</div>
      <p class="muted small">Puščica primerja zadnjo tretjino obdobja s prvo. Tapni kategorijo za transakcije.</p>
    </section>`;

  const savData = rows.map(r => ({
    key: r.month, label: short(r.month), tooltipLabel: `${monthLabel(r.month)}${r.month === month ? ' (do danes)' : ''}`,
    value: r.saved, rows: [['Prihodki', money(r.income)], ['Poraba', money(r.spend)], ...(r.rate != null ? [['Ostane', pct(r.rate)]] : [])],
  }));
  if (u.savings === 'cum') {
    lineChart(view.querySelector('#savChart'), rows.map(r => short(r.month)), [{ name: 'Skupaj prihranjeno', cls: 'mid', values: rows.map(r => r.cum) }],
      { format: money, axisFormat: money0, tooltipTitle: i => `Konec: ${monthLabel(rows[i].month)}`, ariaLabel: 'Skupaj prihranjeno po mesecih' });
  } else {
    signedColumnChart(view.querySelector('#savChart'), savData, { format: signedMoney, axisFormat: money0, ariaLabel: 'Prihranek po mesecih' });
  }
  lineChart(view.querySelector('#paceChart'), pace.days.map(String),
    [{ name: 'Ta mesec', cls: 'mid', values: pace.current }, ...(pace.average ? [{ name: 'Običajno', cls: 'invested', values: pace.average }] : [])],
    { format: money, axisFormat: money0, tooltipTitle: i => `${i + 1}. dan`, ariaLabel: 'Kumulativna poraba ta mesec v primerjavi z običajno' });
  columnChart(view.querySelector('#wdChart'), weekdays.map((v, i) => ({ key: i, label: WEEKDAYS[i], tooltipLabel: WEEKDAYS_LONG[i], value: v, selected: i === topDay })),
    { format: money, axisFormat: money0, ariaLabel: 'Povprečna poraba po dnevih v tednu' });

  view.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => setUi({ period: b.dataset.period === 'all' ? null : Number(b.dataset.period) }, view)));
  view.querySelectorAll('[data-sv]').forEach(b => b.addEventListener('click', () => setUi({ savings: b.dataset.sv }, view)));
}
