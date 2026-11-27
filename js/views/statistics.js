// Pregled → Statistika: prihranki po mesecih, tempo porabe, dnevi v tednu, kategorije skozi čas,
// fiksno/spremenljivo, velikost nakupov, prejemniki, največji izdatki, dnevi brez porabe.

import { state, category, kindOf, topOf, BASE_CURRENCY } from '../store.js';
import { buildIndex } from '../stats.js';
import { periodMonths, monthlySavings, savingsSummary, spendPace, weekdaySpend, categoryTrends, monthEndForecast, fixedVariable, topMerchants, purchaseSizes, largestExpenses, noSpendDays } from '../statistics.js';
import { savings as shopSavings } from '../pantry.js';
import { signedColumnChart, lineChart, columnChart } from '../charts.js';
import { esc, money, money0, signedMoney, monthLabel, dayLabel, currentMonth, todayISO } from '../ui.js';

const PERIODS = [{ n: 6, label: '6 mesecev' }, { n: 12, label: '12 mesecev' }, { n: null, label: 'Vse' }];
const WEEKDAYS = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];
const WEEKDAYS_LONG = ['ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota', 'nedelja'];
const WEEKDAYS_ON = ['v ponedeljek', 'v torek', 'v sredo', 'v četrtek', 'v petek', 'v soboto', 'v nedeljo'];
const UI_KEY = 'stat-ui';
const signed0 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money0(Math.abs(v))}`;
const pct = v => `${Math.round(v * 100)} %`;
const short = m => monthLabel(m, 'short').replace('.', '');
const sizeLabel = r => (r.hi === Infinity ? `nad ${r.lo} €` : r.lo === 0 ? `do ${r.hi} €` : `${r.lo}–${r.hi} €`);
const bar = share => `<span class="cat-bar"><i style="width:${Math.max(0, Math.min(100, share * 100)).toFixed(1)}%"></i></span>`;

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
  const forecast = monthEndForecast(pace, day);
  const fv = fixedVariable(idx, months, month);
  const sizes = purchaseSizes(state.transactions, kindOf, from, today, BASE_CURRENCY);
  const small = sizes.rows[0];
  const merchants = topMerchants(state.transactions, kindOf, from, today, { base: BASE_CURRENCY });
  const largest = largestExpenses(state.transactions, kindOf, from, today, { base: BASE_CURRENCY });
  const quiet = noSpendDays(state.transactions, kindOf, from, today, BASE_CURRENCY);
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
          : `Do danes ${esc(money0(nowSpent))}, običajno do ${day}. v mesecu ${esc(money0(usual))}${usual > 0 ? ` (<b class="${nowSpent > usual ? 'bad' : 'good'}">${nowSpent > usual ? '+' : '−'}${Math.round(Math.abs(nowSpent - usual) / usual * 100)} %</b>)` : ''}. Običajno = povprečje zadnjih ${pace.months.length} mesecev.${forecast != null ? ` Če nadaljuješ kot običajno, bo konec meseca okoli <b>${esc(money0(forecast))}</b>.` : ''}`}</p>
      </section>

      <section class="card">
        <h2>Po dnevih v tednu</h2>
        <div class="chart" id="wdChart"></div>
        <p class="muted small">Povprečna poraba na dan brez ponavljajočih stroškov. Največ zapraviš ${esc(WEEKDAYS_ON[topDay])}.${quiet ? ` Dni brez porabe: <b>${quiet.days}</b> od ${quiet.total} (${esc(pct(quiet.days / quiet.total))}), najdaljši niz ${quiet.longest}.` : ''}</p>
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
    </section>

    <div class="two-col">
      <section class="card">
        <div class="card-head"><h2>Fiksno in spremenljivo</h2>
          <div class="legend"><span><i class="key-line mid"></i>spremenljivo</span><span><i class="key-line invested"></i>fiksno</span></div></div>
        <div class="chart" id="fvChart"></div>
        <p class="small">Fiksno povprečno <b>${esc(money0(fv.fixed))}</b>/mesec${fv.share != null ? ` (${esc(pct(fv.share))} porabe)` : ''}, spremenljivo <b>${esc(money0(fv.variable))}</b>/mesec.
          <span class="muted">${fv.fixed > 0
            ? 'Fiksno = ponavljajoči stroški (najemnina, naročnine). Prihraniš lahko predvsem pri spremenljivem.'
            : 'Ponavljajoči stroški še niso označeni, zato je vse šteto kot spremenljivo. Predloge za ponavljajoča plačila najdeš na <a href="#/pregled">Pregledu</a>.'}</span></p>
      </section>

      <section class="card">
        <h2>Velikost nakupov</h2>
        ${sizes.count ? `<div class="cat-list">${sizes.rows.map(r => `
          <div class="cat-row"><span class="cat-main">
            <span class="cat-top"><span class="cat-name">${esc(sizeLabel(r))} <small class="muted">· ${r.count}×</small></span><span class="cat-amt">${esc(money0(r.sum))} <small class="muted">${esc(pct(r.share))}</small></span></span>
            ${bar(r.share)}</span></div>`).join('')}</div>
        <p class="muted small">Brez ponavljajočih. Tipičen nakup ${esc(money(sizes.median))}.${small.count ? ` Drobni nakupi do ${small.hi} € so ${small.count}× (${esc(pct(small.count / sizes.count))} vseh) in skupaj ${esc(money0(small.sum))}.` : ''}</p>`
        : '<p class="muted">Ni podatkov.</p>'}
      </section>
    </div>

    <div class="two-col">
      <section class="card">
        <h2>Kje zapravljaš</h2>
        ${merchants.length ? `<ol class="merchants">${merchants.map(m => {
          const c = category(m.categoryId);
          return `<li><a href="#/transakcije?q=${encodeURIComponent(m.name)}">
            <span class="emoji-badge">${esc(c?.emoji ?? '')}</span>
            <span class="tx-main"><span class="tx-desc">${esc(m.name)}</span><span class="tx-meta">${m.count}× · povprečno ${esc(money(m.perVisit))} · ${esc(pct(m.share))} porabe</span></span>
            <span class="tx-amt">${esc(money0(m.sum))}</span>
          </a></li>`;
        }).join('')}</ol>` : '<p class="muted">Ni podatkov.</p>'}
      </section>

      <section class="card">
        <h2>Največji izdatki</h2>
        ${largest.length ? `<ol class="merchants">${largest.map(t => {
          const c = category(t.categoryId);
          return `<li><a href="#/transakcije?m=${esc(t.date.slice(0, 7))}&q=${encodeURIComponent(t.description ?? '')}">
            <span class="emoji-badge">${esc(c?.emoji ?? '')}</span>
            <span class="tx-main"><span class="tx-desc">${esc(t.description || 'Brez opisa')}</span><span class="tx-meta">${esc(dayLabel(t.date))} · ${esc(c?.name ?? '')}</span></span>
            <span class="tx-amt">${esc(money(-t.amount))}</span>
          </a></li>`;
        }).join('')}</ol>
        <p class="muted small">Posamezni nakupi brez ponavljajočih: ${esc(pct(largest.reduce((s, t) => s - t.amount, 0) / (sizes.total || 1)))} spremenljive porabe obdobja.</p>` : '<p class="muted">Ni podatkov.</p>'}
      </section>
    </div>`;

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

  lineChart(view.querySelector('#fvChart'), fv.rows.map(r => short(r.month)),
    [{ name: 'Spremenljivo', cls: 'mid', values: fv.rows.map(r => r.variable) }, { name: 'Fiksno', cls: 'invested', values: fv.rows.map(r => r.fixed) }],
    { format: money, axisFormat: money0, tooltipTitle: i => `${monthLabel(fv.rows[i].month)}${fv.rows[i].month === month ? ' (do danes)' : ''}`, ariaLabel: 'Fiksna in spremenljiva poraba po mesecih' });

  view.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => setUi({ period: b.dataset.period === 'all' ? null : Number(b.dataset.period) }, view)));
  view.querySelectorAll('[data-sv]').forEach(b => b.addEventListener('click', () => setUi({ savings: b.dataset.sv }, view)));
}
