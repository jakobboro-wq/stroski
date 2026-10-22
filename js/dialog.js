// Okno za dodajanje in urejanje transakcije.

import { state, category, kindOf, accounts, saveTransactions, deleteTransactions, addRule, BASE_CURRENCY } from './store.js';
import { FALLBACK_CATEGORY, normalize } from './categorize.js';
import { parseNumber } from './csv.js';
import { esc, todayISO, ask, toast, plural, TX_FORMS } from './ui.js';

const dlg = document.getElementById('txDialog');
const form = document.getElementById('txForm');
const f = form.elements;
let editing = null;

const TITLES = { expense: 'strošek', income: 'prihodek', transfer: 'prenos' };

function renderCategories(kind, selected) {
  document.getElementById('catGrid').innerHTML = state.categories
    .filter(c => c.kind === kind)
    .map(c => `<label class="chip"><input type="radio" name="category" value="${esc(c.id)}"${c.id === selected ? ' checked' : ''}><span><b>${esc(c.emoji)}</b>${esc(c.name)}</span></label>`)
    .join('');
}

function setTitle() {
  document.getElementById('txTitle').textContent = `${editing ? 'Uredi' : 'Nov'} ${TITLES[f.kind.value]}`;
}

function lastAccount() {
  const manual = state.transactions.filter(t => t.source === 'manual' && t.account);
  return manual.sort((a, b) => b.createdAt - a.createdAt)[0]?.account ?? 'Revolut';
}

export function openTxDialog(tx = null) {
  editing = tx;
  form.reset();
  const kind = tx ? kindOf(tx.categoryId) : 'expense';
  f.kind.value = kind;
  f.amount.value = tx ? String(Math.abs(tx.amount)).replace('.', ',') : '';
  f.date.value = tx?.date ?? todayISO();
  f.account.value = tx?.account ?? lastAccount();
  f.description.value = tx?.description ?? '';
  document.getElementById('accountList').innerHTML = accounts().map(a => `<option value="${esc(a)}">`).join('');
  document.getElementById('txDelete').hidden = !tx;
  const foreign = tx && tx.currency !== BASE_CURRENCY;
  document.getElementById('txCurrency').textContent = foreign ? tx.currency : '€';
  renderCategories(kind, tx?.categoryId);
  setTitle();
  dlg.showModal();
  if (!tx) requestAnimationFrame(() => f.amount.focus());
}

form.addEventListener('change', e => {
  if (e.target.name === 'kind') {
    renderCategories(f.kind.value, null);
    setTitle();
  }
});
f.amount.addEventListener('input', () => f.amount.setCustomValidity(''));
document.getElementById('txClose').addEventListener('click', () => dlg.close());

form.addEventListener('submit', async e => {
  e.preventDefault();
  const value = Math.abs(parseNumber(f.amount.value));
  if (!Number.isFinite(value) || value === 0) {
    f.amount.setCustomValidity('Vpiši znesek, npr. 12,50');
    f.amount.reportValidity();
    return;
  }
  const kind = f.kind.value;
  const categoryId = form.querySelector('input[name=category]:checked')?.value ?? FALLBACK_CATEGORY[kind];
  // Predznak: strošek je negativen, prihodek pozitiven. Pri urejanju ohranimo predznak (npr. vračilo v kategoriji stroška).
  let sign = kind === 'income' ? 1 : -1;
  if (editing && kindOf(editing.categoryId) === kind) sign = Math.sign(editing.amount) || sign;

  const before = editing;
  const tx = {
    ...(before ?? { source: 'manual', currency: BASE_CURRENCY }),
    amount: Math.round(sign * value * 100) / 100,
    date: f.date.value || todayISO(),
    account: f.account.value.trim(),
    description: f.description.value.trim(),
    categoryId,
    categorySource: 'manual',
  };
  dlg.close();
  await saveTransactions([tx]);

  // Ko popraviš kategorijo uvožene transakcije, ponudi pravilo za vse enake.
  if (before && before.categoryId !== categoryId && tx.description && before.source !== 'manual') {
    const c = category(categoryId);
    const key = normalize(tx.description);
    const others = state.transactions.filter(t => t.id !== tx.id && t.categorySource !== 'manual' && t.categoryId !== categoryId && normalize(t.description) === key).length;
    const extra = others ? ` Spremenilo bo tudi ${plural(others, ['obstoječo transakcijo', 'obstoječi transakciji', 'obstoječe transakcije', 'obstoječih transakcij'])}.` : '';
    const ok = await ask(`Naj »${tx.description}« vedno uvrstim v ${c.emoji} ${c.name}?${extra}`, { yes: 'Da, vedno', no: 'Samo to' });
    if (ok) {
      const n = await addRule(tx.description, categoryId);
      toast(n ? `Pravilo shranjeno, posodobljeno: ${plural(n, TX_FORMS)}` : 'Pravilo shranjeno');
    } else toast('Shranjeno');
  } else toast('Shranjeno');
});

document.getElementById('txDelete').addEventListener('click', async () => {
  const tx = editing;
  dlg.close();
  if (tx && await ask('Izbrišem to transakcijo?', { yes: 'Izbriši', danger: true })) {
    await deleteTransactions([tx.id]);
    toast('Izbrisano');
  }
});
