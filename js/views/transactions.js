import { state, category, kindOf, inCategory, categoryLabel, BASE_CURRENCY } from '../store.js';
import { categoryOptions } from '../category-ui.js';
import { normalize } from '../categorize.js';
import { monthOf } from '../stats.js';
import { openTxDialog } from '../dialog.js';
import { esc, money, signedMoney, monthLabel, dayLabel, plural, TX_FORMS, icons } from '../ui.js';

const PAGE = 200;

export function renderTransactions(view, params) {
  const filters = { m: params.get('m') ?? '', c: params.get('c') ?? '', q: params.get('q') ?? '' };
  const months = [...new Set(state.transactions.map(t => monthOf(t.date)))].sort().reverse();
  let limit = PAGE;

  view.innerHTML = `
    <header class="page-head spread"><h1>Transakcije</h1><a class="btn" href="#/uvoz">${icons.upload} Uvozi izpisek</a></header>
    <div class="filters">
      <input type="search" id="fq" placeholder="Išči po opisu, kategoriji …" value="${esc(filters.q)}" aria-label="Iskanje">
      <select id="fm" aria-label="Mesec">
        <option value="">Vsi meseci</option>
        ${months.map(m => `<option value="${m}"${m === filters.m ? ' selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
      </select>
      <select id="fc" aria-label="Kategorija">
        <option value="">Vse kategorije</option>
        ${categoryOptions(filters.c)}
      </select>
    </div>
    <p class="summary" id="txSummary"></p>
    <div id="txList" class="tx-list"></div>`;

  const list = view.querySelector('#txList');

  const draw = () => {
    const q = normalize(filters.q);
    const rows = state.transactions
      .filter(t => (!filters.m || t.date.startsWith(filters.m))
        && (!filters.c || inCategory(t.categoryId, filters.c))
        && (!q || normalize(`${t.description} ${categoryLabel(t.categoryId)} ${t.account ?? ''}`).includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));

    let spend = 0, income = 0;
    for (const t of rows) {
      if (t.currency !== BASE_CURRENCY) continue;
      const kind = kindOf(t.categoryId);
      if (kind === 'expense') spend -= t.amount;
      else if (kind === 'income') income += t.amount;
    }
    view.querySelector('#txSummary').innerHTML = rows.length
      ? `${plural(rows.length, TX_FORMS)} · odhodki <b>${money(spend)}</b>${income ? ` · prihodki <b>${money(income)}</b>` : ''}`
      : '';

    if (!rows.length) {
      list.innerHTML = `<div class="empty">${state.transactions.length ? 'Ni transakcij, ki bi ustrezale filtru.' : 'Še ni transakcij. Dodaj prvo s gumbom <b>+</b> ali uvozi izpisek.'}</div>`;
      return;
    }

    let html = '';
    let day = null;
    for (const t of rows.slice(0, limit)) {
      if (t.date !== day) {
        day = t.date;
        const dayTotal = rows.filter(x => x.date === day && x.currency === BASE_CURRENCY && kindOf(x.categoryId) === 'expense').reduce((s, x) => s - x.amount, 0);
        html += `<h3 class="day">${esc(dayLabel(day))}${dayTotal ? `<span>${money(dayTotal)}</span>` : ''}</h3>`;
      }
      const c = category(t.categoryId);
      const kind = c.kind;
      html += `
        <button class="tx-row" data-id="${esc(t.id)}">
          <span class="emoji-badge">${esc(c.emoji)}</span>
          <span class="tx-main">
            <span class="tx-desc">${esc(t.description || c.name)}</span>
            <span class="tx-meta">${t.seriesId ? '🔁 ' : ''}${esc(categoryLabel(c.id))}${t.account ? ` · ${esc(t.account)}` : ''}</span>
          </span>
          <span class="tx-amt ${kind}${t.amount > 0 && kind !== 'transfer' ? ' positive' : ''}">${signedMoney(t.amount, t.currency)}</span>
        </button>`;
    }
    if (rows.length > limit) html += `<button class="btn more" id="more">Pokaži več (${rows.length - limit})</button>`;
    list.innerHTML = html;
  };

  const sync = () => {
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    history.replaceState(null, '', `#/transakcije${p.size ? `?${p}` : ''}`);
    limit = PAGE;
    draw();
  };

  view.querySelector('#fq').addEventListener('input', e => { filters.q = e.target.value; sync(); });
  view.querySelector('#fm').addEventListener('change', e => { filters.m = e.target.value; sync(); });
  view.querySelector('#fc').addEventListener('change', e => { filters.c = e.target.value; sync(); });
  list.addEventListener('click', e => {
    if (e.target.closest('#more')) { limit += PAGE; draw(); return; }
    const row = e.target.closest('.tx-row');
    if (row) openTxDialog(state.transactions.find(t => t.id === row.dataset.id));
  });
  draw();
}
