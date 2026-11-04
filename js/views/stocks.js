// Kartica »Delnice« na zavihku Premoženje: nakupi in prodaje posameznih delnic.

import { state, saveInvestment, deleteInvestments } from '../store.js';
import { position, stockValue, portfolio } from '../stocks.js';
import { parseNumber } from '../csv.js';
import { esc, money, signedMoney, plural, todayISO, ask, toast } from '../ui.js';

const EPS = 1e-8;
const round2 = n => Math.round(n * 100) / 100;
const num = (v, d = 2) => (v == null || Number.isNaN(v) ? '' : Number(v).toLocaleString('sl-SI', { maximumFractionDigits: d, useGrouping: false }));
const fmtDay = iso => { const [y, m, d] = iso.split('-'); return `${+d}. ${+m}. ${y}`; };
const shareCount = n => {
  const rounded = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(rounded) ? plural(rounded, ['kos', 'kosa', 'kosi', 'kosov']) : `${num(rounded, 6)} kosa`;
};
const percent = (part, whole) => `${part >= 0 ? '+' : '−'}${num(Math.abs(part / whole) * 100, 1)} %`;

const allStocks = () => state.investments.filter(x => x.kind === 'stock');
const allTrades = () => state.investments.filter(x => x.kind === 'trade');
const tradesOf = id => allTrades().filter(t => t.stockId === id);

let showAll = false;

/** Vrednost vseh delnic danes (za neto premoženje). */
export const stocksToday = () => portfolio(allStocks(), allTrades()).value;

export function renderStockCard(el) {
  const stocks = allStocks();
  if (!stocks.length) {
    el.innerHTML = `
      <h2>Delnice</h2>
      <p class="muted small">Posebej spremljaj nakupe posameznih delnic: koliko kosov imaš, po kateri povprečni ceni in kakšen je dobiček ali izguba.</p>
      <button class="btn primary" id="addTrade">+ Nakup delnice</button>`;
    el.querySelector('#addTrade').addEventListener('click', () => openTradeDialog());
    return;
  }

  const trades = allTrades();
  const rows = stocks.map(s => {
    const pos = position(tradesOf(s.id));
    return { s, pos, value: stockValue(s, pos) };
  }).sort((a, b) => b.value - a.value || a.s.name.localeCompare(b.s.name));
  const total = portfolio(stocks, trades);
  const list = [...trades].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));

  el.innerHTML = `
    <div class="card-head"><h2>Delnice</h2><button class="btn primary" id="addTrade">+ Nakup ali prodaja</button></div>
    <p class="sub-summary">Vrednost <b>${money(total.value)}</b> · vloženo <b>${money(total.cost)}</b>${total.priced ? ` · ${total.unrealized >= 0 ? 'trenutni dobiček' : 'trenutna izguba'} <b class="${total.unrealized >= 0 ? 'good' : 'bad'}">${signedMoney(round2(total.unrealized))}</b>` : ''}${Math.abs(total.realized) >= 0.005 ? ` · pri prodajah <b class="${total.realized >= 0 ? 'good' : 'bad'}">${signedMoney(round2(total.realized))}</b>` : ''}</p>

    <div class="fund-list">${rows.map(({ s, pos, value }) => {
      const open = pos.shares > EPS;
      const gain = value - pos.cost;
      const meta = open
        ? `${shareCount(pos.shares)} · povprečno ${money(pos.average)} na kos${s.price != null && s.priceDate ? ` · vrednost z dne ${fmtDay(s.priceDate)}` : ''}`
        : 'vse prodano';
      const side = !open
        ? `<b>${signedMoney(round2(pos.realized))}</b><small>pri prodajah</small>`
        : s.price == null
          ? `<b>${money(value)}</b><small>vloženo</small>`
          : `<b>${money(value)}</b><small class="${gain >= 0 ? 'good' : 'bad'}">${signedMoney(round2(gain))} (${percent(gain, pos.cost)})</small>`;
      return `
        <button class="fund-row" data-stock="${esc(s.id)}">
          <span class="emoji-badge">📊</span>
          <span class="tx-main"><span class="tx-desc">${esc(s.name)}</span><span class="tx-meta">${meta}</span></span>
          <span class="fund-amt">${side}</span>
        </button>`;
    }).join('')}</div>
    <p class="muted small">Tapni delnico, da vpišeš trenutno vrednost z Revoluta. Ena delnica lahko izgubi večino ali vso vrednost.</p>

    <h3 class="sub-head">Nakupi in prodaje</h3>
    <div class="deposit-list">${(showAll ? list : list.slice(0, 5)).map(t => `
      <button class="deposit-row" data-trade="${esc(t.id)}">
        <span class="tx-main">
          <span class="tx-desc">${esc(stocks.find(s => s.id === t.stockId)?.name ?? '')}</span>
          <span class="tx-meta">${esc(fmtDay(t.date))} · ${t.side === 'buy' ? 'nakup' : 'prodaja'} · ${shareCount(t.shares)}</span>
        </span>
        <b>${money(t.amount)}</b>
      </button>`).join('')}</div>
    ${list.length > 5 ? `<button class="link-btn" id="toggleTrades">${showAll ? 'Pokaži manj' : `Pokaži vse (${list.length})`}</button>` : ''}`;

  el.querySelector('#addTrade').addEventListener('click', () => openTradeDialog());
  el.querySelectorAll('[data-stock]').forEach(b => b.addEventListener('click', () => openStockDialog(stocks.find(s => s.id === b.dataset.stock))));
  el.querySelectorAll('[data-trade]').forEach(b => b.addEventListener('click', () => openTradeDialog(trades.find(t => t.id === b.dataset.trade))));
  el.querySelector('#toggleTrades')?.addEventListener('click', () => { showAll = !showAll; renderStockCard(el); });
}

// ---------- Okna ----------

const dlg = document.getElementById('stockDialog');
const form = document.getElementById('stockForm');
const fields = document.getElementById('stockFields');
const title = document.getElementById('stockTitle');
const removeBtn = document.getElementById('stockDelete');
let mode = 'trade';
let editing = null;

function openTradeDialog(trade = null) {
  mode = 'trade';
  editing = trade;
  const stockName = trade ? allStocks().find(s => s.id === trade.stockId)?.name ?? '' : '';
  title.textContent = trade ? 'Uredi vnos' : 'Nakup ali prodaja';
  fields.innerHTML = `
    <label class="field">Delnica
      <input name="stock" list="stockNames" value="${esc(stockName)}" placeholder="npr. Innodata (INOD)" autocomplete="off"${trade ? ' readonly' : ''}>
      <datalist id="stockNames">${allStocks().map(s => `<option value="${esc(s.name)}">`).join('')}</datalist>
    </label>
    <div class="row2">
      <label class="field">Vrsta
        <select name="side">
          <option value="buy"${trade?.side === 'sell' ? '' : ' selected'}>Nakup</option>
          <option value="sell"${trade?.side === 'sell' ? ' selected' : ''}>Prodaja</option>
        </select>
      </label>
      <label class="field">Datum<input type="date" name="date" value="${esc(trade?.date ?? todayISO())}"></label>
    </div>
    <div class="row2">
      <label class="field">Število kosov<input name="shares" inputmode="decimal" value="${esc(num(trade?.shares, 8))}" placeholder="lahko tudi 0,25"></label>
      <label class="field"><span id="amountLabel">Skupaj plačano (€)</span><input name="amount" inputmode="decimal" value="${esc(num(trade?.amount))}"></label>
    </div>
    <p class="muted small" id="tradeHint"></p>`;
  const f = form.elements;
  const update = () => {
    document.getElementById('amountLabel').textContent = f.side.value === 'buy' ? 'Skupaj plačano, s provizijo (€)' : 'Skupaj prejeto, po proviziji (€)';
    const shares = parseNumber(f.shares.value);
    const amount = parseNumber(f.amount.value);
    document.getElementById('tradeHint').textContent = shares > 0 && amount > 0 ? `To je ${money(amount / shares)} na kos.` : '';
  };
  fields.oninput = update;
  update();
  removeBtn.hidden = !trade;
  dlg.showModal();
}

function openStockDialog(stock) {
  mode = 'stock';
  editing = stock;
  const pos = position(tradesOf(stock.id));
  const open = pos.shares > EPS;
  title.textContent = stock.name;
  fields.innerHTML = `
    <label class="field">Naziv<input name="stock" value="${esc(stock.name)}" autocomplete="off"></label>
    ${open ? `
      <label class="field">Trenutna vrednost vseh kosov (€)<input name="value" inputmode="decimal" value="${esc(stock.price == null ? '' : num(round2(pos.shares * stock.price)))}"></label>
      <p class="muted small">Vpiši vrednost, ki jo za te kose (${shareCount(pos.shares)}) kaže Revolut. Če jo pustiš prazno, se šteje nabavna vrednost.</p>` : ''}`;
  fields.oninput = null;
  removeBtn.hidden = false;
  dlg.showModal();
}

document.getElementById('stockClose').addEventListener('click', () => dlg.close());

/** Obstoječa delnica z enakim imenom ali nova. */
async function stockByName(name) {
  const key = name.toLocaleLowerCase('sl');
  return allStocks().find(s => s.name.toLocaleLowerCase('sl') === key) ?? saveInvestment({ kind: 'stock', name, price: null, priceDate: null });
}

async function saveTrade(f) {
  const name = f.stock.value.trim();
  const side = f.side.value;
  const shares = parseNumber(f.shares.value);
  const amount = parseNumber(f.amount.value);
  if (!name) return toast('Vpiši ime delnice.');
  if (!(shares > 0)) return toast('Vpiši število kosov.');
  if (!(amount > 0)) return toast('Vpiši znesek.');

  const date = f.date.value || todayISO();
  const known = allStocks().find(s => s.name.toLocaleLowerCase('sl') === name.toLocaleLowerCase('sl'));
  const next = { ...(editing ?? { kind: 'trade' }), side, shares, amount: round2(amount), date };
  const others = known ? tradesOf(known.id).filter(t => t.id !== editing?.id) : [];
  if (position([...others, next]).oversold) return toast('Prodaja presega število kosov, ki si jih takrat imel.');

  dlg.close();
  const stock = known ?? await stockByName(name);
  await saveInvestment({ ...next, stockId: stock.id });
  toast('Shranjeno');
}

async function saveStock(f) {
  const name = f.stock.value.trim();
  if (!name) return toast('Vpiši naziv.');
  const taken = allStocks().some(s => s.id !== editing.id && s.name.toLocaleLowerCase('sl') === name.toLocaleLowerCase('sl'));
  if (taken) return toast('Delnica s tem imenom že obstaja.');

  const next = { ...editing, name };
  if (f.value) {
    const pos = position(tradesOf(editing.id));
    const text = f.value.value.trim();
    const value = text ? parseNumber(text) : null;
    if (value != null && !(value >= 0)) return toast('Preveri trenutno vrednost.');
    const before = editing.price == null ? null : round2(pos.shares * editing.price);
    if (value !== before) Object.assign(next, { price: value == null ? null : value / pos.shares, priceDate: value == null ? null : todayISO() });
  }
  dlg.close();
  await saveInvestment(next);
  toast('Shranjeno');
}

form.addEventListener('submit', e => {
  e.preventDefault();
  return mode === 'trade' ? saveTrade(form.elements) : saveStock(form.elements);
});

removeBtn.addEventListener('click', async () => {
  const item = editing;
  const wasMode = mode;
  dlg.close();
  if (!item) return;
  if (wasMode === 'stock') {
    const own = tradesOf(item.id);
    if (await ask(`Izbrišem delnico »${item.name}« in vse njene vnose (${own.length})?`, { yes: 'Izbriši', danger: true })) {
      await deleteInvestments([item.id, ...own.map(t => t.id)]);
      toast('Izbrisano');
    }
    return;
  }
  const others = tradesOf(item.stockId).filter(t => t.id !== item.id);
  if (position(others).oversold) return toast('Najprej izbriši prodajo, ki uporablja te kose.');
  if (await ask(`Izbrišem ta vnos z dne ${fmtDay(item.date)}?`, { yes: 'Izbriši', danger: true })) {
    // Zadnji vnos odstrani tudi delnico, da na seznamu ne ostane prazna vrstica.
    await deleteInvestments(others.length ? [item.id] : [item.id, item.stockId]);
    toast('Izbrisano');
  }
});
