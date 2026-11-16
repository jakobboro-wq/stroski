// Kartica »Naslednjih 12 mesecev« v Premoženju: simulacija denarja in neto premoženja (Monte Carlo).

import { state, kindOf, getSetting, saveSetting } from '../store.js';
import { buildInputs, simulate, averageMonth } from '../simulate.js';
import { fanChart } from '../charts.js';
import { DEFAULT_RATE } from '../invest.js';
import { allFunds, investmentsToday } from './invest.js';
import { stocksToday } from './stocks.js';
import { parseNumber } from '../csv.js';
import { esc, money, money0, todayISO, monthLabel } from '../ui.js';

const RUNS = 2000;
const VOL = 0.15; // letna volatilnost naložb (predpostavka, približno za delniške sklade)
const MIN_MONTHS = 3;
const conf = () => ({ view: 'cash', threshold: 0, start: null, ...getSetting('sim', {}) });

export function renderSimCard(el) {
  const today = todayISO();
  const c = conf();
  const inp = buildInputs({ transactions: state.transactions, recurring: state.recurring, assets: state.assets, kindOf, today, cashStart: c.start });
  const funds = allFunds();
  const invest0 = investmentsToday(today) + stocksToday();
  const investMonthly = funds.reduce((s, f) => s + (f.monthly ?? 0), 0);
  // Pričakovani donos: povprečje skladov, uteženo z mesečnim vplačilom (sicer privzeto).
  const w = funds.reduce((s, f) => s + (f.monthly || 1), 0);
  const rate = funds.length ? funds.reduce((s, f) => s + (f.rate ?? DEFAULT_RATE) * (f.monthly || 1), 0) / w : DEFAULT_RATE;

  const head = `<div class="card-head"><h2>Naslednjih 12 mesecev</h2>
    <div class="seg-mini" role="group" aria-label="Prikaz">
      <button type="button" data-sv="cash" class="${c.view === 'cash' ? 'on' : ''}">Denar</button>
      <button type="button" data-sv="net" class="${c.view === 'net' ? 'on' : ''}">Neto premoženje</button>
    </div></div>`;

  if (inp.history.length < MIN_MONTHS) {
    el.innerHTML = `${head}<p class="muted small">Za simulacijo rabim vsaj ${MIN_MONTHS} zaključene mesece transakcij (zdaj ${inp.history.length}). Uvozi izpisek ali počakaj do konca meseca.</p>`;
    bind(el);
    return;
  }

  const r = simulate({ ...inp, invest0, investMonthly, rate, vol: VOL, runs: RUNS, threshold: c.threshold, seed: Number(today.replace(/-/g, '')) });
  const series = c.view === 'net' ? r.net : r.cash;
  const startValue = c.view === 'net' ? inp.cash0 + invest0 + (inp.other[0] ?? 0) - (inp.debts[0] ?? 0) : inp.cash0;
  const short = m => monthLabel(m, 'short');
  const points = [{ label: 'danes', tooltipLabel: 'Danes', p10: startValue, p50: startValue, p90: startValue },
    ...series.map((b, i) => ({ ...b, label: short(inp.months[i]), tooltipLabel: `Konec: ${monthLabel(inp.months[i])}` }))];
  const end = series.at(-1);
  const avg = averageMonth(inp.history, inp.fixed.slice(1));
  const pBelow = Math.round(r.pBelow * 100);

  el.innerHTML = `${head}
    <div class="tiles four">
      <div class="tile"><div class="tile-label">Čez 12 mesecev (verjetno)</div><div class="tile-value ${end.p50 < 0 ? 'bad' : ''}">${esc(money0(end.p50))}</div></div>
      <div class="tile"><div class="tile-label">8 od 10 primerov</div><div class="tile-value">${esc(money0(end.p10))} – ${esc(money0(end.p90))}</div></div>
      <div class="tile"><div class="tile-label">Denar pade pod ${esc(money0(c.threshold))}</div><div class="tile-value ${pBelow >= 20 ? 'bad' : pBelow ? '' : 'good'}">${pBelow < 1 && r.pBelow > 0 ? '< 1' : pBelow} %</div></div>
      <div class="tile"><div class="tile-label">Povprečen mesec</div><div class="tile-value ${avg.net < 0 ? 'bad' : 'good'}">${avg.net >= 0 ? '+' : ''}${esc(money0(avg.net))}</div></div>
    </div>
    <div class="chart" id="simChart"></div>
    <div class="sim-opts">
      <label class="muted small">Denar na računih danes <input id="simStart" inputmode="decimal" value="${esc(money(inp.cash0).replace(/\s?€/, ''))}"${inp.cashFromAssets ? ' title="Iz premoženja vrste Denar / račun. Če vpišeš znesek, velja ta."' : ''}> €</label>
      <label class="muted small">Opozori pod <input id="simThreshold" inputmode="decimal" value="${esc(String(c.threshold))}"> €</label>
    </div>
    <details class="sim-how"><summary class="muted small">Kako je izračunano</summary>
      <p class="muted small">${RUNS} možnih potekov. Vsak mesec: stalni prihodki in stroški iz tvojih ponavljajočih predlog, spremenljivi del (hrana, izhodi, nepravilni prihodki) pa je naključno izbran eden od zadnjih ${inp.history.length} mesecev (prihodek in strošek iz istega meseca). Tekoči mesec šteje sorazmerno s preostalimi dnevi.
      ${invest0 > 0 || investMonthly > 0 ? `Naložbe (${esc(money0(invest0))}, +${esc(money0(investMonthly))}/mesec z računa) rastejo s pričakovanim donosom ${(rate * 100).toFixed(1).replace('.', ',')} % na leto in nihanjem ${VOL * 100} % na leto (predpostavka, ne napoved trga).` : ''}
      Stvari in dolgovi sledijo amortizaciji in odplačilu. Pas na grafu je razpon, v katerem je 8 od 10 potekov; zunaj njega je še 10 % slabših in 10 % boljših.
      ${inp.cashFromAssets ? '' : c.start == null ? 'Stanje na računih ni vpisano (v Premoženju dodaj »Denar / račun« ali ga vpiši tukaj), zato graf kaže samo spremembo od danes.' : ''}</p>
    </details>`;

  fanChart(el.querySelector('#simChart'), points, { format: money, axisFormat: money0, threshold: c.view === 'cash' ? c.threshold : null, ariaLabel: 'Simulacija stanja v naslednjih 12 mesecih' });
  bind(el);
}

function bind(el) {
  const save = changes => saveSetting({ ...conf(), ...changes, id: 'sim' });
  el.querySelectorAll('[data-sv]').forEach(b => b.addEventListener('click', () => save({ view: b.dataset.sv })));
  el.querySelector('#simStart')?.addEventListener('change', e => {
    const v = parseNumber(e.target.value);
    save({ start: Number.isFinite(v) ? v : null });
  });
  el.querySelector('#simThreshold')?.addEventListener('change', e => {
    const v = parseNumber(e.target.value);
    if (Number.isFinite(v)) save({ threshold: v });
  });
}
