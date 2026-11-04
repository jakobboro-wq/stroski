// Kartica »Vlaganje« na zavihku Premoženje: naložbe, vplačila in graf rasti po predpostavljenem donosu.

import { state, saveInvestment, deleteInvestments } from '../store.js';
import { DEFAULT_RATE, RATE_SPREAD, investedOf, currentValue, projectionSeries, valueInYears } from '../invest.js';
import { projectionChart } from '../charts.js';
import { parseNumber } from '../csv.js';
import { esc, money, money0, signedMoney, monthLabel, todayISO, ask, toast } from '../ui.js';

const HORIZONS = [5, 10, 20, 30];
let selected = 'all';
let years = 20;
let showAll = false;

const num = (v, d = 2) => (v == null || Number.isNaN(v) ? '' : Number(v).toLocaleString('sl-SI', { maximumFractionDigits: d, useGrouping: false }));
const fmtDay = iso => { const [y, m, d] = iso.split('-'); return `${+d}. ${+m}. ${y}`; };
const yearsWord = n => `${n} ${n === 1 ? 'leto' : n === 2 ? 'leti' : n < 5 ? 'leta' : 'let'}`;

export const allFunds = () => state.investments.filter(x => x.kind === 'fund').sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
export const allDeposits = () => state.investments.filter(x => x.kind === 'deposit');

export function renderInvestCard(el) {
  const funds = allFunds();
  const deposits = allDeposits();
  const today = todayISO();

  if (!funds.length) {
    el.innerHTML = `
      <h2>Vlaganje</h2>
      <p class="muted small">Dodaj naložbo in mesečni znesek, pa vidiš graf, kako bi vložek lahko rasel. Vsako vplačilo nato dodaš sam.</p>
      <div class="button-row">
        <button class="btn primary" id="addSp500">+ S&amp;P 500, 50 €/mesec</button>
        <button class="btn" id="addFund">+ Druga naložba</button>
      </div>`;
    el.querySelector('#addSp500').addEventListener('click', () => openFundDialog(null, { name: 'S&P 500', monthly: 50 }));
    el.querySelector('#addFund').addEventListener('click', () => openFundDialog());
    return;
  }

  if (selected !== 'all' && !funds.some(f => f.id === selected)) selected = 'all';
  const chosen = selected === 'all' ? funds : funds.filter(f => f.id === selected);
  const ids = new Set(chosen.map(f => f.id));
  const own = deposits.filter(d => ids.has(d.fundId)).sort((a, b) => b.date.localeCompare(a.date));
  const invested = chosen.reduce((s, f) => s + investedOf(f, deposits, today), 0);
  const value = chosen.reduce((s, f) => s + currentValue(f, deposits, today), 0);
  const hasValue = chosen.some(f => f.value != null);
  const monthly = chosen.reduce((s, f) => s + (f.monthly ?? 0), 0);
  const thisMonth = today.slice(0, 7);

  const milestones = HORIZONS.map(n => {
    const last = projectionSeries(chosen, deposits, today, n).at(-1);
    return { n, ...last };
  });
  const rates = chosen.map(f => f.rate ?? DEFAULT_RATE);
  const sameRate = rates.every(r => r === rates[0]);

  el.innerHTML = `
    <div class="card-head"><h2>Vlaganje</h2><button class="btn primary" id="addDeposit">+ Vplačilo</button></div>

    <div class="fund-list">${funds.map(f => {
      const paid = deposits.some(d => d.fundId === f.id && d.date.startsWith(thisMonth));
      const v = currentValue(f, deposits, today);
      const inv = investedOf(f, deposits, today);
      return `
        <button class="fund-row" data-fund="${esc(f.id)}">
          <span class="emoji-badge">📈</span>
          <span class="tx-main">
            <span class="tx-desc">${esc(f.name)}</span>
            <span class="tx-meta">${money0(f.monthly ?? 0)}/mesec · predpostavka ${num((f.rate ?? DEFAULT_RATE) * 100, 1)} %${f.monthly > 0 && !paid ? ' · ta mesec še ni vplačila' : ''}</span>
          </span>
          <span class="fund-amt"><b>${money(v)}</b>${f.value != null ? `<small class="${v - inv >= 0 ? 'good' : 'bad'}">${signedMoney(Math.round((v - inv) * 100) / 100)}</small>` : '<small>vloženo</small>'}</span>
        </button>`;
    }).join('')}</div>
    <button class="link-btn" id="addFund">+ Dodaj naložbo</button>

    <div class="invest-tools">
      ${funds.length > 1 ? `<select id="fundPick" aria-label="Prikaži naložbo">
        <option value="all"${selected === 'all' ? ' selected' : ''}>Vse skupaj</option>
        ${funds.map(f => `<option value="${esc(f.id)}"${selected === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
      </select>` : ''}
      <div class="seg-mini" role="group" aria-label="Obdobje">
        ${HORIZONS.map(n => `<button class="${n === years ? 'on' : ''}" data-years="${n}">${n} let</button>`).join('')}
      </div>
    </div>

    <div class="legend chart-legend">
      <span><i class="key-line invested"></i>Vloženo</span>
      <span><i class="key-line mid"></i>Pričakovano${sameRate ? ` (${num(rates[0] * 100, 1)} %)` : ''}</span>
      <span><i class="key-band"></i>Razpon${sameRate ? ` ${num(Math.max(0, rates[0] - RATE_SPREAD) * 100, 1)}–${num((rates[0] + RATE_SPREAD) * 100, 1)} %` : ' ± 3 %'}</span>
    </div>
    <div class="chart" id="growthChart" style="min-height:280px"></div>

    <div class="horizon">
      <div class="h-row h-head"><span>Čez</span><span>Vloženo</span><span>Pričakovano</span><span>Razpon</span></div>
      ${milestones.map(r => `<div class="h-row"><span>${yearsWord(r.n)}</span><span>${money0(r.invested)}</span><b>${money0(r.mid)}</b><span>${money0(r.low)}–${money0(r.high)}</span></div>`).join('')}
    </div>
    <p class="muted small">Izračun z enakim donosom vsako leto in ${money0(monthly)} na mesec, pred davki in provizijami. To ni napoved: trg niha in lahko pade tudi za tretjino ali več, vrednost je lahko začasno ali trajno nižja od vloženega.</p>

    <h3 class="sub-head">Vplačila${own.length ? ` · skupaj ${money(invested)}${hasValue ? ` · vrednost ${money(value)}` : ''}` : ''}</h3>
    ${own.length ? `<div class="deposit-list">${(showAll ? own : own.slice(0, 5)).map(d => {
      const f = funds.find(x => x.id === d.fundId);
      return `<button class="deposit-row" data-deposit="${esc(d.id)}"><span>${esc(fmtDay(d.date))}</span><span class="muted">${esc(f?.name ?? '')}</span><b>${money(d.amount)}</b></button>`;
    }).join('')}</div>
    ${own.length > 5 ? `<button class="link-btn" id="toggleDeposits">${showAll ? 'Pokaži manj' : `Pokaži vsa (${own.length})`}</button>` : ''}`
    : '<p class="muted small">Še ni vplačil. Ko kaj vplačaš na Revolutu, dodaj z gumbom <b>+ Vplačilo</b>.</p>'}`;

  // Točke za graf: oznaka leta na začetku vsakega leta in na prvi točki
  const points = projectionSeries(chosen, deposits, today, years).map((p, i) => ({
    ...p,
    tooltipLabel: monthLabel(p.month),
    yearLabel: i === 0 || p.month.endsWith('-01') ? p.month.slice(0, 4) : '',
  }));
  projectionChart(el.querySelector('#growthChart'), points, {
    format: v => money(v),
    axisFormat: v => money0(v),
    ariaLabel: `Rast naložbe v ${yearsWord(years)}`,
  });

  el.querySelector('#addDeposit').addEventListener('click', () => openDepositDialog(null, chosen[0]));
  el.querySelector('#addFund').addEventListener('click', () => openFundDialog());
  el.querySelector('#fundPick')?.addEventListener('change', e => { selected = e.target.value; renderInvestCard(el); });
  el.querySelectorAll('[data-years]').forEach(b => b.addEventListener('click', () => { years = Number(b.dataset.years); renderInvestCard(el); }));
  el.querySelectorAll('[data-fund]').forEach(b => b.addEventListener('click', () => openFundDialog(funds.find(f => f.id === b.dataset.fund))));
  el.querySelectorAll('[data-deposit]').forEach(b => b.addEventListener('click', () => openDepositDialog(deposits.find(d => d.id === b.dataset.deposit))));
  el.querySelector('#toggleDeposits')?.addEventListener('click', () => { showAll = !showAll; renderInvestCard(el); });
}

/** Trenutna vrednost vseh naložb (za neto premoženje). */
export const investmentsToday = today => allFunds().reduce((s, f) => s + currentValue(f, allDeposits(), today), 0);
/** Pričakovana vrednost vseh naložb čez n let. */
export const investmentsInYears = (today, n) => valueInYears(allFunds(), allDeposits(), today, n);

// ---------- Okna ----------

const dlg = document.getElementById('investDialog');
const form = document.getElementById('investForm');
const fields = document.getElementById('investFields');
const removeBtn = document.getElementById('investDelete');
let mode = 'fund';
let editing = null;

function openFundDialog(fund = null, preset = {}) {
  mode = 'fund';
  editing = fund;
  const f = fund ?? { rate: DEFAULT_RATE, ...preset };
  document.getElementById('investTitle').textContent = fund ? 'Uredi naložbo' : 'Nova naložba';
  fields.innerHTML = `
    <label class="field">Naziv<input name="name" value="${esc(f.name ?? '')}" placeholder="npr. S&amp;P 500" autocomplete="off"></label>
    <div class="row2">
      <label class="field">Mesečni znesek (€)<input name="monthly" inputmode="decimal" value="${esc(num(f.monthly))}"></label>
      <label class="field">Predpostavljen donos (% na leto)<input name="rate" inputmode="decimal" value="${esc(num((f.rate ?? DEFAULT_RATE) * 100, 2))}"></label>
    </div>
    <p class="muted small">Donos je samo predpostavka za graf in ga lahko spremeniš. Graf pokaže tudi razpon ± 3 odstotne točke.</p>
    <div class="row2">
      <label class="field">Trenutna vrednost na Revolutu (€, neobvezno)<input name="value" inputmode="decimal" value="${esc(num(f.value))}"></label>
      <label class="field">Vrednost na dan<input type="date" name="valueDate" value="${esc(f.valueDate ?? todayISO())}"></label>
    </div>
    <p class="muted small">Brez vpisane vrednosti se šteje vsota vplačil.</p>`;
  removeBtn.hidden = !fund;
  dlg.showModal();
}

function openDepositDialog(deposit = null, fund = null) {
  mode = 'deposit';
  editing = deposit;
  const funds = allFunds();
  const fundId = deposit?.fundId ?? fund?.id ?? funds[0]?.id;
  const current = funds.find(f => f.id === fundId);
  document.getElementById('investTitle').textContent = deposit ? 'Uredi vplačilo' : 'Novo vplačilo';
  fields.innerHTML = `
    ${funds.length > 1 ? `<label class="field">Naložba<select name="fundId">${funds.map(f => `<option value="${esc(f.id)}"${f.id === fundId ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>` : `<input type="hidden" name="fundId" value="${esc(fundId)}">`}
    <div class="row2">
      <label class="field">Znesek (€)<input name="amount" inputmode="decimal" value="${esc(num(deposit?.amount ?? current?.monthly))}"></label>
      <label class="field">Datum<input type="date" name="date" value="${esc(deposit?.date ?? todayISO())}"></label>
    </div>`;
  removeBtn.hidden = !deposit;
  dlg.showModal();
}

document.getElementById('investClose').addEventListener('click', () => dlg.close());

form.addEventListener('submit', async e => {
  e.preventDefault();
  const f = form.elements;
  if (mode === 'fund') {
    const name = f.name.value.trim();
    const monthly = parseNumber(f.monthly.value);
    const rate = parseNumber(f.rate.value) / 100;
    const value = f.value.value.trim() ? parseNumber(f.value.value) : null;
    if (!name) return toast('Vpiši naziv naložbe.');
    if (!(monthly >= 0)) return toast('Vpiši mesečni znesek.');
    if (!(rate >= 0 && rate < 1)) return toast('Preveri predpostavljen donos.');
    if (value != null && !(value >= 0)) return toast('Preveri trenutno vrednost.');
    dlg.close();
    await saveInvestment({ ...(editing ?? { kind: 'fund' }), name, monthly, rate, value, valueDate: value == null ? null : f.valueDate.value || todayISO() });
  } else {
    const amount = parseNumber(f.amount.value);
    if (!(amount > 0)) return toast('Vpiši znesek vplačila.');
    dlg.close();
    await saveInvestment({ ...(editing ?? { kind: 'deposit' }), fundId: f.fundId.value, amount: Math.round(amount * 100) / 100, date: f.date.value || todayISO() });
  }
  toast('Shranjeno');
});

removeBtn.addEventListener('click', async () => {
  const item = editing;
  const wasMode = mode;
  dlg.close();
  if (!item) return;
  if (wasMode === 'fund') {
    const own = allDeposits().filter(d => d.fundId === item.id);
    const extra = own.length ? ` Izbrišejo se tudi vplačila (${own.length}).` : '';
    if (await ask(`Izbrišem naložbo »${item.name}«?${extra}`, { yes: 'Izbriši', danger: true })) {
      await deleteInvestments([item.id, ...own.map(d => d.id)]);
      toast('Izbrisano');
    }
  } else if (await ask(`Izbrišem vplačilo ${money(item.amount)} z dne ${fmtDay(item.date)}?`, { yes: 'Izbriši', danger: true })) {
    await deleteInvestments([item.id]);
    toast('Izbrisano');
  }
});
