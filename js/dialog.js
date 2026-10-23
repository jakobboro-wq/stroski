// Okno za dodajanje in urejanje transakcije.

import { state, category, kindOf, topOf, childrenOf, topCategories, categoryLabel, accounts, saveCategory, saveTransactions, deleteTransactions, addRule, seriesById, saveSeries, deleteSeries, generateRecurring, BASE_CURRENCY } from './store.js';
import { EVERY, nextOccurrence } from './recurring.js';
import { FALLBACK_CATEGORY, normalize } from './categorize.js';
import { parseNumber } from './csv.js';
import { esc, todayISO, ask, toast, plural, TX_FORMS } from './ui.js';

const dlg = document.getElementById('txDialog');
const form = document.getElementById('txForm');
const f = form.elements;
let editing = null;

const TITLES = { expense: 'strošek', income: 'prihodek', transfer: 'prenos' };

const grid = document.getElementById('catGrid');

const chip = (name, c, checked, label = c.name, emoji = c.emoji) =>
  `<label class="chip"><input type="radio" name="${name}" value="${esc(c.id)}"${checked ? ' checked' : ''}><span><b>${esc(emoji)}</b>${esc(label)}</span></label>`;
const addChip = (mode, label) => `<button type="button" class="chip add" data-add="${mode}"><span><b>＋</b>${label}</span></button>`;
const newCatForm = `
  <div class="new-cat" hidden>
    <input class="emoji-in" value="🏷️" maxlength="8" aria-label="Ikona">
    <input class="new-name" placeholder="Ime" aria-label="Ime nove kategorije" autocomplete="off">
    <button type="button" class="btn primary new-save">Dodaj</button>
  </div>`;

/** Dve ravni: glavne kategorije, pod izbrano pa njene podkategorije. Obe ravni lahko dopolniš sproti. */
function renderCategories(kind, selected) {
  const selTop = selected ? topOf(selected) : null;
  const top = selTop && category(selTop);
  const subs = selTop ? childrenOf(selTop) : [];
  grid.innerHTML = `
    <div class="chip-grid">
      ${topCategories(kind).map(c => chip('topCat', c, c.id === selTop)).join('')}
      ${addChip('top', 'Nova')}
    </div>
    ${selTop ? '' : newCatForm}
    ${top ? `
      <div class="sub-picker">
        <div class="sub-label">Podkategorija v »${esc(top.name)}«</div>
        <div class="chip-grid small">
          ${chip('category', top, selected === selTop, 'Brez', '—')}
          ${subs.map(c => chip('category', c, c.id === selected)).join('')}
          ${addChip('sub', 'Nova')}
        </div>
        ${newCatForm}
      </div>` : ''}`;
}

grid.addEventListener('change', e => {
  if (e.target.name === 'topCat') renderCategories(f.kind.value, e.target.value);
});
grid.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const box = add.closest('.chip-grid').nextElementSibling;
    box.dataset.mode = add.dataset.add;
    box.hidden = false;
    box.querySelector('.new-name').focus();
  }
  if (e.target.closest('.new-save')) createCategory(e.target.closest('.new-cat'));
});
grid.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest('.new-cat')) {
    e.preventDefault(); // ne pošlji celega obrazca
    createCategory(e.target.closest('.new-cat'));
  }
});

async function createCategory(box) {
  const name = box.querySelector('.new-name').value.trim();
  if (!name) return box.querySelector('.new-name').focus();
  const emoji = box.querySelector('.emoji-in').value.trim() || '🏷️';
  const parentId = box.dataset.mode === 'sub' ? grid.querySelector('input[name=topCat]:checked')?.value : null;
  const c = await saveCategory({ name, emoji, kind: f.kind.value, parentId });
  renderCategories(f.kind.value, c.id);
  toast(`${parentId ? 'Podkategorija' : 'Kategorija'} »${name}« dodana`);
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
  f.repeat.value = (tx?.seriesId && seriesById(tx.seriesId)?.every) || '';
  setTitle();
  updateRepeatHint();
  dlg.showModal();
  if (!tx) requestAnimationFrame(() => f.amount.focus());
}

const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };

function updateRepeatHint() {
  const hint = document.getElementById('repeatHint');
  const series = editing?.seriesId && seriesById(editing.seriesId);
  const every = f.repeat.value;
  if (!every) {
    hint.hidden = !series;
    hint.textContent = series ? 'Ponavljanje se bo ustavilo. Že vnesene transakcije ostanejo.' : '';
    return;
  }
  const next = nextOccurrence({ anchor: f.date.value || todayISO(), every }, todayISO());
  hint.hidden = false;
  hint.textContent = series && series.every === every
    ? `Ponavljajoč strošek (naslednjič ${fmtDay(nextOccurrence(series, todayISO()) ?? next)}). Sprememba zneska velja tudi za naprej.`
    : `Aplikacija bo to sama dodala ${EVERY[every].short}${next ? ` (naslednjič ${fmtDay(next)})` : ''} in upoštevala v napovedi.`;
}

form.addEventListener('change', e => {
  if (e.target.name === 'kind') {
    renderCategories(f.kind.value, null);
    setTitle();
  }
  if (e.target.name === 'repeat' || e.target.name === 'date') updateRepeatHint();
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
  const categoryId = form.querySelector('input[name=category]:checked')?.value
    ?? form.querySelector('input[name=topCat]:checked')?.value
    ?? FALLBACK_CATEGORY[kind];
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

  // Ponavljanje: nova predloga, sprememba ritma ali ustavitev
  const series = before?.seriesId ? seriesById(before.seriesId) : null;
  const repeat = f.repeat.value;
  const template = { description: tx.description, amount: tx.amount, categoryId, account: tx.account, currency: tx.currency };
  let repeatNote = '';
  if (repeat && !series) {
    const s = await saveSeries({ ...template, every: repeat, anchor: tx.date });
    tx.seriesId = s.id;
    repeatNote = 'Ponavljajoč strošek shranjen';
  } else if (series && !repeat) {
    if (await ask('Ustavim ponavljanje? Že vnesene transakcije ostanejo.', { yes: 'Ustavi' })) {
      await deleteSeries(series.id);
      repeatNote = 'Ponavljanje ustavljeno';
    }
  } else if (series) {
    const dates = state.transactions.filter(t => t.seriesId === series.id).map(t => t.date);
    const latest = [...dates, tx.date].sort().at(-1);
    if (repeat !== series.every) await saveSeries({ ...series, ...template, every: repeat, anchor: latest });
    else if (tx.date >= latest) await saveSeries({ ...series, ...template }); // zadnja ponovitev določa znesek za naprej
  }
  await saveTransactions([tx]);
  if (repeatNote) {
    const n = await generateRecurring(todayISO());
    toast(n ? `${repeatNote} · dodane pretekle ponovitve: ${n}` : repeatNote);
    return;
  }

  // Ko popraviš kategorijo uvožene transakcije, ponudi pravilo za vse enake.
  if (before && before.categoryId !== categoryId && tx.description && before.source !== 'manual') {
    const c = category(categoryId);
    const key = normalize(tx.description);
    const others = state.transactions.filter(t => t.id !== tx.id && t.categorySource !== 'manual' && t.categoryId !== categoryId && normalize(t.description) === key).length;
    const extra = others ? ` Spremenilo bo tudi ${plural(others, ['obstoječo transakcijo', 'obstoječi transakciji', 'obstoječe transakcije', 'obstoječih transakcij'])}.` : '';
    const ok = await ask(`Naj »${tx.description}« vedno uvrstim v ${c.emoji} ${categoryLabel(categoryId)}?${extra}`, { yes: 'Da, vedno', no: 'Samo to' });
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
