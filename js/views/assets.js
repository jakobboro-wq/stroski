// Zavihek »Premoženje«: stvari z amortizacijo, dolgovi z odplačevanjem in neto premoženje.

import { state, saveAsset, deleteAsset } from '../store.js';
import { ASSET_TYPES, DEBT_TYPES, METHODS, assetValue, lossNextYear, debtBalance, payoff, totals, addYears } from '../assets.js';
import { parseNumber } from '../csv.js';
import { esc, money, money0, todayISO, ask, toast } from '../ui.js';

const num = (v, d = 2) => (v == null || v === '' || Number.isNaN(v) ? '' : Number(v).toLocaleString('sl-SI', { maximumFractionDigits: d, useGrouping: false }));
const monthYear = iso => { const [y, m] = iso.split('-'); return `${+m}/${y}`; };
const typeOf = x => (x.kind === 'debt' ? DEBT_TYPES : ASSET_TYPES)[x.type] ?? (x.kind === 'debt' ? DEBT_TYPES.other : ASSET_TYPES.other);

export function renderAssets(view) {
  const today = todayISO();
  const assets = state.assets.filter(x => x.kind !== 'debt').map(a => ({ a, value: assetValue(a, today) })).sort((x, y) => y.value - x.value);
  const debts = state.assets.filter(x => x.kind === 'debt').map(d => ({ d, balance: debtBalance(d, today), pay: payoff(d, today) })).sort((x, y) => y.balance - x.balance);
  const t = totals(state.assets, today);
  const yearlyLoss = assets.reduce((s, r) => s + lossNextYear(r.a, today), 0);
  const horizon = [1, 2, 3, 5].map(n => ({ n, ...totals(state.assets, addYears(today, n)) }));

  view.innerHTML = `
    <header class="page-head"><h1>Premoženje</h1></header>

    <section class="card hero">
      <div class="hero-label">Neto premoženje</div>
      <div class="hero-value ${t.net < 0 ? 'bad' : ''}">${money(t.net)}</div>
      <p class="muted small">Premoženje <b>${money(t.assets)}</b> − dolgovi <b>${money(t.debts)}</b>${yearlyLoss > 0 ? ` · stvari izgubijo približno <b>${money0(yearlyLoss)}</b> vrednosti na leto` : ''}</p>
    </section>

    <div class="two-col">
      <section class="card">
        <div class="card-head"><h2>Premoženje</h2><button class="btn" data-new="asset">+ Dodaj</button></div>
        ${assets.length ? `<div class="asset-list">${assets.map(({ a, value }) => {
          const share = a.price > 0 ? Math.min(1, value / a.price) : 1;
          const how = a.method === 'linear' ? `${num(a.life, 1)} let` : a.method === 'declining' ? `−${num(a.rate * 100, 1)} %/leto` : a.method === 'none' ? 'brez amortizacije' : 'ročna vrednost';
          const loss = lossNextYear(a, today);
          return `
            <button class="asset-row" data-id="${esc(a.id)}">
              <span class="emoji-badge">${esc(typeOf(a).emoji)}</span>
              <span class="tx-main">
                <span class="tx-desc">${esc(a.name || typeOf(a).label)}</span>
                <span class="tx-meta">${a.purchaseDate && a.method !== 'manual' ? `kupljeno ${esc(monthYear(a.purchaseDate))} za ${money0(a.price)} · ` : ''}${esc(how)}${loss > 0 ? ` · −${money0(loss)} v enem letu` : ''}</span>
                ${a.method !== 'manual' && a.method !== 'none' && a.price > 0 ? `<span class="value-bar"><i style="width:${share * 100}%"></i></span>` : ''}
              </span>
              <span class="tx-amt">${money(value)}</span>
            </button>`;
        }).join('')}</div>` : '<p class="muted small">Dodaj stvari, ki jih imaš: avto, kolo, računalnik, uro, denar na računih … Aplikacija sama izračuna, koliko so vredne danes.</p>'}
      </section>

      <section class="card">
        <div class="card-head"><h2>Dolgovi</h2><button class="btn" data-new="debt">+ Dodaj</button></div>
        ${debts.length ? `<div class="asset-list">${debts.map(({ d, balance, pay }) => {
          const paid = d.amount > 0 && d.method === 'amortized' ? Math.min(1, 1 - balance / d.amount) : null;
          const meta = d.method === 'amortized'
            ? `${money0(d.payment)}/mesec · ${num((d.rate ?? 0) * 100, 2)} %${pay ? (pay.months ? ` · odplačano ${esc(monthYear(pay.date))}` : ' · odplačano') : ' · obrok ne pokrije obresti!'}`
            : 'ročno stanje';
          return `
            <button class="asset-row" data-id="${esc(d.id)}">
              <span class="emoji-badge">${esc(typeOf(d).emoji)}</span>
              <span class="tx-main">
                <span class="tx-desc">${esc(d.name || typeOf(d).label)}</span>
                <span class="tx-meta">${meta}</span>
                ${paid != null ? `<span class="value-bar debt"><i style="width:${paid * 100}%"></i></span>` : ''}
              </span>
              <span class="tx-amt bad">${money(-balance)}</span>
            </button>`;
        }).join('')}</div>` : '<p class="muted small">Krediti, leasing, kreditna kartica ali dolg prijatelju. Pri kreditu vpišeš obrok in obrestno mero, aplikacija izračuna, koliko še dolguješ in kdaj bo odplačan.</p>'}
      </section>
    </div>

    ${state.assets.length ? `
    <section class="card">
      <h2>Napoved</h2>
      <div class="horizon">
        <div class="h-row h-head"><span></span><span>Premoženje</span><span>Dolgovi</span><span>Neto</span></div>
        <div class="h-row"><span>Danes</span><span>${money0(t.assets)}</span><span>${money0(t.debts)}</span><b>${money0(t.net)}</b></div>
        ${horizon.map(h => `<div class="h-row"><span>Čez ${h.n} ${h.n === 1 ? 'leto' : h.n === 2 ? 'leti' : h.n < 5 ? 'leta' : 'let'}</span><span>${money0(h.assets)}</span><span>${money0(h.debts)}</span><b>${money0(h.net)}</b></div>`).join('')}
      </div>
      <p class="muted small">Upošteva amortizacijo stvari in odplačevanje dolgov. Ročno vpisane vrednosti (denar, naložbe) ostanejo enake – posodobi jih, ko se spremenijo.</p>
    </section>` : ''}`;

  view.querySelectorAll('[data-new]').forEach(btn => btn.addEventListener('click', () => openAssetDialog(null, btn.dataset.new)));
  view.querySelectorAll('.asset-row').forEach(row => row.addEventListener('click', () => openAssetDialog(state.assets.find(x => x.id === row.dataset.id))));
}

// ---------- Okno za dodajanje in urejanje ----------

const dlg = document.getElementById('assetDialog');
const form = document.getElementById('assetForm');
const fields = document.getElementById('assetFields');
let editing = null;
let draft = null;

const options = (map, selected, label = v => v.label) =>
  Object.entries(map).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${typeof v === 'string' ? v : `${v.emoji ?? ''} ${label(v)}`}</option>`).join('');
const field = (label, name, value, attrs = 'inputmode="decimal"') =>
  `<label class="field">${label}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;

function renderFields() {
  const d = draft;
  if (d.kind === 'debt') {
    fields.innerHTML = `
      <div class="row2">
        <label class="field">Vrsta<select name="type">${options(DEBT_TYPES, d.type)}</select></label>
        ${field('Komu / naziv', 'name', d.name, 'placeholder="npr. NLB stanovanjski kredit" autocomplete="off"')}
      </div>
      <label class="field">Način<select name="method">
        <option value="amortized"${d.method === 'amortized' ? ' selected' : ''}>Obročno odplačevanje (obresti + mesečni obrok)</option>
        <option value="manual"${d.method === 'manual' ? ' selected' : ''}>Ročno vpisujem trenutno stanje</option>
      </select></label>
      ${d.method === 'amortized' ? `
        <div class="row2">
          ${field('Izposojeni znesek (€)', 'amount', num(d.amount))}
          <label class="field">Začetek odplačevanja<input type="date" name="startDate" value="${esc(d.startDate ?? todayISO())}"></label>
        </div>
        <div class="row2">
          ${field('Obrestna mera (% letno)', 'rate', num((d.rate ?? 0) * 100, 3))}
          ${field('Mesečni obrok (€)', 'payment', num(d.payment))}
        </div>`
      : field('Trenutno dolgujem (€)', 'balance', num(d.balance))}
      ${field('Opomba', 'note', d.note, 'autocomplete="off"')}`;
  } else {
    fields.innerHTML = `
      <div class="row2">
        <label class="field">Vrsta<select name="type">${options(ASSET_TYPES, d.type)}</select></label>
        ${field('Naziv', 'name', d.name, 'placeholder="npr. VW Golf 2015" autocomplete="off"')}
      </div>
      <label class="field">Vrednost<select name="method">${options(METHODS, d.method)}</select></label>
      ${d.method === 'manual'
        ? field('Trenutna vrednost (€)', 'value', num(d.value))
        : `<div class="row2">
            ${field('Nakupna cena (€)', 'price', num(d.price))}
            <label class="field">Datum nakupa<input type="date" name="purchaseDate" value="${esc(d.purchaseDate ?? todayISO())}"></label>
          </div>
          ${d.method === 'linear' ? `<div class="row2">${field('Življenjska doba (let)', 'life', num(d.life, 1))}${field('Vrednost na koncu (€)', 'residual', num(d.residual))}</div>` : ''}
          ${d.method === 'declining' ? `<div class="row2">${field('Izgubi na leto (%)', 'rate', num((d.rate ?? 0) * 100, 2))}${field('Najmanjša vrednost (€)', 'residual', num(d.residual))}</div>` : ''}`}
      ${field('Opomba', 'note', d.note, 'autocomplete="off"')}
      <p class="muted small" id="assetPreview"></p>`;
    updatePreview();
  }
}

/** Prebere obrazec v osnutek (številke z vejico, odstotki → delež). */
function readForm() {
  const f = form.elements;
  const n = name => (f[name] ? parseNumber(f[name].value) : undefined);
  const pct = name => (f[name] ? parseNumber(f[name].value) / 100 : undefined);
  const set = (k, v) => { if (v !== undefined && !Number.isNaN(v)) draft[k] = v; };
  for (const k of ['type', 'method', 'name', 'note', 'purchaseDate', 'startDate']) if (f[k]) draft[k] = f[k].value.trim();
  for (const k of ['price', 'life', 'residual', 'value', 'amount', 'payment', 'balance']) set(k, n(k));
  set('rate', pct('rate'));
}

function updatePreview() {
  const el = document.getElementById('assetPreview');
  if (!el) return;
  readForm();
  const today = todayISO();
  if (draft.method === 'manual' || draft.method === 'none' || !(draft.price > 0)) { el.textContent = ''; return; }
  el.innerHTML = `Danes vredno <b>${money(assetValue(draft, today))}</b> · čez 1 leto ${money0(assetValue(draft, addYears(today, 1)))} · čez 3 leta ${money0(assetValue(draft, addYears(today, 3)))}`;
}

export function openAssetDialog(item, kind = 'asset') {
  editing = item;
  if (item) draft = { ...item };
  else {
    const type = 'other';
    const defaults = kind === 'debt' ? DEBT_TYPES[type] : ASSET_TYPES[type];
    draft = { kind, type, method: defaults.method, life: defaults.life, rate: defaults.rate, residual: defaults.residual ?? 0 };
  }
  document.getElementById('assetTitle').textContent = `${item ? 'Uredi' : 'Dodaj'} ${draft.kind === 'debt' ? 'dolg' : 'premoženje'}`;
  document.getElementById('assetDelete').hidden = !item;
  renderFields();
  dlg.showModal();
}

form.addEventListener('change', e => {
  if (e.target.name === 'type' || e.target.name === 'method') {
    readForm();
    // Nova vrsta premoženja prinese smiseln privzet način amortizacije
    if (e.target.name === 'type' && !editing) {
      const defaults = (draft.kind === 'debt' ? DEBT_TYPES : ASSET_TYPES)[draft.type];
      Object.assign(draft, { method: defaults.method }, defaults.life ? { life: defaults.life } : {}, defaults.rate != null ? { rate: defaults.rate } : {});
    }
    renderFields();
  }
});
form.addEventListener('input', () => updatePreview());
document.getElementById('assetClose').addEventListener('click', () => dlg.close());

form.addEventListener('submit', async e => {
  e.preventDefault();
  readForm();
  const d = draft;
  const missing = d.kind === 'debt'
    ? (d.method === 'amortized' ? !(d.amount > 0) || !(d.payment > 0) : !(d.balance >= 0))
    : (d.method === 'manual' ? !(d.value >= 0) : !(d.price > 0));
  if (missing) return toast(d.kind === 'debt' ? 'Vpiši znesek in obrok (ali trenutno stanje).' : 'Vpiši ceno (ali trenutno vrednost).');
  dlg.close();
  await saveAsset({ ...editing, ...d });
  toast('Shranjeno');
});

document.getElementById('assetDelete').addEventListener('click', async () => {
  const item = editing;
  dlg.close();
  if (item && await ask(`Izbrišem »${item.name || typeOf(item).label}«?`, { yes: 'Izbriši', danger: true })) {
    await deleteAsset(item.id);
    toast('Izbrisano');
  }
});
