// Slikan račun: branje na napravi, pregled postavk in shranjevanje po kategorijah.

import { state, allRules, accounts, saveTransactions, addRule, getSetting, saveSetting, BASE_CURRENCY } from '../store.js';
import { builtinRules, matchRule, FALLBACK_CATEGORY } from '../categorize.js';
import { parseReceipt, receiptTransactions, itemKey } from '../receipt.js';
import { readReceipt } from '../ocr.js';
import { categoryOptions } from '../category-ui.js';
import { parseNumber } from '../csv.js';
import { esc, money, todayISO, toast, plural } from '../ui.js';

const dlg = document.getElementById('receiptDialog');
const form = document.getElementById('receiptForm');
const body = document.getElementById('receiptFields');
const saveBtn = document.getElementById('receiptSave');
let current = null; // { parsed, text, guessedCategory }

const fmt = v => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '');
const exists = id => id && state.categories.some(c => c.id === id && c.kind === 'expense');
const memory = () => getSetting('receipts', { items: {} });

function lastManualAccount() {
  const manual = state.transactions.filter(t => t.source === 'manual' && t.account);
  return manual.sort((a, b) => b.createdAt - a.createdAt)[0]?.account ?? 'Revolut';
}

/** Odpre okno, prebere sliko in pokaže, kar je našel. */
export async function scanReceipt(file) {
  current = null;
  saveBtn.disabled = true;
  body.innerHTML = `
    <div class="scan-progress">
      <p id="scanStatus">Pripravljam sliko …</p>
      <div class="bar"><i id="scanBar" style="width:0%"></i></div>
      <p class="muted small">Račun se prebere kar na tvoji napravi, slika ne gre nikamor.</p>
    </div>`;
  dlg.showModal();
  const known = memory().items ?? {};
  const parse = text => parseReceipt(text, { rules: allRules(), names: builtinRules(), itemRules: known, today: todayISO() });
  const score = text => { const p = parse(text); return p.matches ? 2 : p.items.length && p.total ? 1 : 0; };
  let text;
  try {
    text = await readReceipt(file, (p, label) => {
      const bar = document.getElementById('scanBar');
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      const status = document.getElementById('scanStatus');
      if (status) status.textContent = label;
    }, score);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<p class="card error">${esc(err.message || 'Računa ni bilo mogoče prebrati.')}</p>`;
    return;
  }
  if (!dlg.open) return; // zaprl si, preden je končal
  const parsed = parse(text);
  parsed.items.forEach(i => { if (!exists(i.categoryId)) i.categoryId = null; });
  const guessed = exists(parsed.storeCategoryId) ? parsed.storeCategoryId
    : exists(matchRule(parsed.store, allRules())?.categoryId) ? matchRule(parsed.store, allRules()).categoryId : FALLBACK_CATEGORY.expense;
  const account = parsed.payment === 'cash' ? 'Gotovina' : parsed.payment === 'card' ? 'Revolut' : lastManualAccount();
  current = { parsed, text, guessed };
  render({ ...parsed, date: parsed.date ?? todayISO(), account, storeCategoryId: guessed });
}

function itemRow(i) {
  return `
    <div class="rc-item">
      <input class="rc-name" value="${esc(i.name)}" aria-label="Postavka" autocomplete="off">
      <input class="rc-amount" value="${esc(fmt(i.amount))}" inputmode="decimal" aria-label="Znesek">
      <select class="rc-cat" aria-label="Kategorija"><option value="">kot trgovina</option>${categoryOptions(i.categoryId, ['expense'])}</select>
      <button type="button" class="icon-btn rc-del" aria-label="Odstrani postavko"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>`;
}

function render(r) {
  const list = accounts();
  if (r.account && !list.includes(r.account)) list.push(r.account);
  const nothing = !r.total && !r.items.length;
  body.innerHTML = `
    ${nothing ? '<p class="card hint">Na sliki ni bilo mogoče najti zneskov. Poskusi z bližjo, ostrejšo sliko na ravni podlagi ali vpiši sam.</p>' : ''}
    <label class="field">Trgovina<input name="store" value="${esc(r.store)}" placeholder="npr. Mercator" autocomplete="off"></label>
    <div class="row2">
      <label class="field">Datum<input type="date" name="date" value="${esc(r.date)}"></label>
      <label class="field">Plačano z<select name="account">${list.map(a => `<option${a === r.account ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
    </div>
    <div class="row2">
      <label class="field">Skupaj na računu<input name="total" value="${esc(fmt(r.total))}" inputmode="decimal" autocomplete="off"></label>
      <label class="field">Kategorija trgovine<select name="storeCat">${categoryOptions(r.storeCategoryId, ['expense'])}</select></label>
    </div>
    <section class="rc-items">
      <div class="sub-label">Postavke${r.items.length ? '' : ' (ni najdenih, lahko jih dodaš)'}</div>
      <div id="rcList">${r.items.map(itemRow).join('')}</div>
      <button type="button" class="btn ghost" id="rcAdd">＋ Dodaj postavko</button>
      <p class="muted small" id="rcSum"></p>
    </section>
    <details class="rc-raw"><summary>Prebrano besedilo</summary><pre>${esc(current?.text ?? '')}</pre></details>`;
  saveBtn.disabled = false;
  updateSum();
}

function readItems() {
  return [...body.querySelectorAll('.rc-item')].map(row => ({
    name: row.querySelector('.rc-name').value.trim(),
    amount: Math.round(parseNumber(row.querySelector('.rc-amount').value) * 100) / 100,
    categoryId: row.querySelector('.rc-cat').value || null,
  }));
}

function updateSum() {
  const out = document.getElementById('rcSum');
  if (!out) return;
  const items = readItems().filter(i => Number.isFinite(i.amount));
  const total = parseNumber(form.elements.total.value);
  const sum = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const groups = new Set(items.map(i => i.categoryId || form.elements.storeCat.value));
  if (!items.length) { out.textContent = Number.isFinite(total) && total > 0 ? `Shranim en strošek: ${money(total)}.` : ''; return; }
  const diff = Number.isFinite(total) ? Math.round((total - sum) * 100) / 100 : 0;
  const split = groups.size > 1 ? ` Razdelim na ${plural(groups.size, ['kategorijo', 'kategoriji', 'kategorije', 'kategorij'])}.` : '';
  out.innerHTML = Math.abs(diff) < 0.01
    ? `✓ Postavke se ujemajo z računom (${esc(money(sum))}).${esc(split)}`
    : `Postavke skupaj ${esc(money(sum))}, račun ${esc(money(total))}. Razlika ${esc(money(diff))} gre v kategorijo trgovine.${esc(split)}`;
}

body.addEventListener('input', updateSum);
body.addEventListener('change', updateSum);
body.addEventListener('click', e => {
  if (e.target.closest('.rc-del')) { e.target.closest('.rc-item').remove(); updateSum(); }
  if (e.target.closest('#rcAdd')) {
    document.getElementById('rcList').insertAdjacentHTML('beforeend', itemRow({ name: '', amount: NaN, categoryId: null }));
    document.getElementById('rcList').lastElementChild.querySelector('.rc-name').focus();
  }
});
document.getElementById('receiptClose').addEventListener('click', () => dlg.close());

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!current) return;
  const f = form.elements;
  const items = readItems().filter(i => Number.isFinite(i.amount) && i.amount !== 0);
  const sum = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  let total = parseNumber(f.total.value);
  if (!Number.isFinite(total) || total <= 0) total = sum;
  if (!(total > 0)) {
    f.total.setCustomValidity('Vpiši znesek, npr. 12,50');
    f.total.reportValidity();
    f.total.addEventListener('input', () => f.total.setCustomValidity(''), { once: true });
    return;
  }
  const store = f.store.value.trim();
  const storeCategoryId = f.storeCat.value;
  const list = receiptTransactions({
    store, date: f.date.value || todayISO(), total, account: f.account.value, currency: BASE_CURRENCY, storeCategoryId,
    items: items.map(i => ({ ...i, name: i.name || 'Postavka' })),
  }, crypto.randomUUID());
  dlg.close();
  await saveTransactions(list);

  // Zapomni si kategorije postavk za naslednjič.
  const known = { ...(memory().items ?? {}) };
  let learned = false;
  for (const i of items) {
    const key = itemKey(i.name);
    if (!key) continue;
    if (i.categoryId && known[key] !== i.categoryId) { known[key] = i.categoryId; learned = true; }
    if (!i.categoryId && known[key]) { delete known[key]; learned = true; }
  }
  if (learned) await saveSetting({ id: 'receipts', items: known });
  // Trgovina z novo kategorijo postane pravilo (velja tudi za uvoz izpiska).
  if (store.length >= 3 && storeCategoryId !== current.guessed) await addRule(store, storeCategoryId);

  toast(list.length > 1 ? `Shranjeno: ${plural(list.length, ['strošek', 'stroška', 'stroški', 'stroškov'])} po kategorijah` : 'Račun shranjen');
});
