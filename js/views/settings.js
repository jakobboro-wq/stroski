import { categoryOptions } from '../category-ui.js';
import { state, category, categoryLabel, topCategories, childrenOf, saveCategory, deleteCategory, addRule, deleteRule, exportData, importData, clearAll, deleteTransactions } from '../store.js';
import { PROTECTED_CATEGORIES, builtinRules } from '../categorize.js';
import { loadDemo } from '../demo.js';
import { renderSyncCard } from './sync-card.js';
import { esc, ask, toast, download, todayISO, plural, TX_FORMS, icons } from '../ui.js';

const KIND_LABEL = { expense: 'strošek', income: 'prihodek', transfer: 'prenos' };

export function renderSettings(view) {
  const counts = new Map();
  for (const t of state.transactions) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  const userRules = [...state.rules].sort((a, b) => a.pattern.localeCompare(b.pattern, 'sl'));
  const demoCount = state.transactions.filter(t => t.source === 'demo').length;
  const builtinByCat = new Map();
  for (const r of builtinRules()) builtinByCat.set(r.categoryId, [...(builtinByCat.get(r.categoryId) ?? []), r.pattern]);

  const total = c => (counts.get(c.id) ?? 0) + childrenOf(c.id).reduce((s, x) => s + (counts.get(x.id) ?? 0), 0);
  const catRow = (c, isSub) => `
    <div class="cat-edit${isSub ? ' sub' : ''}" data-id="${esc(c.id)}">
      <input class="emoji-in" value="${esc(c.emoji)}" maxlength="8" aria-label="Ikona">
      <input class="name-in" value="${esc(c.name)}" aria-label="Ime ${isSub ? 'podkategorije' : 'kategorije'}">
      <span class="pill">${isSub ? '' : KIND_LABEL[c.kind]}${total(c) ? `${isSub ? '' : ' · '}${total(c)}` : ''}</span>
      ${PROTECTED_CATEGORIES.has(c.id) ? '<span class="icon-btn disabled"></span>' : `<button class="icon-btn del" aria-label="Izbriši ${esc(c.name)}">${icons.trash}</button>`}
    </div>`;

  view.innerHTML = `
    <header class="page-head"><h1>Nastavitve</h1></header>
    <section class="card" id="syncCard"></section>

    <section class="card">
      <h2>Kategorije</h2>
      <p class="muted small">Številka pove, koliko transakcij je v kategoriji. Nove (pod)kategorije lahko dodaš tudi sproti pri vnosu stroška.</p>
      <div class="cat-edit-list">
        ${topCategories().map(top => `
          <div class="cat-group">
            ${catRow(top, false)}
            ${childrenOf(top.id).map(s => catRow(s, true)).join('')}
            ${top.kind === 'transfer' ? '' : `<button type="button" class="add-sub" data-parent="${esc(top.id)}">＋ podkategorija</button>`}
          </div>`).join('')}
      </div>
      <form class="add-row" id="addCat">
        <input name="emoji" class="emoji-in" placeholder="🙂" maxlength="8" aria-label="Ikona">
        <input name="name" placeholder="Nova glavna kategorija" required aria-label="Ime nove kategorije">
        <select name="kind" aria-label="Vrsta"><option value="expense">strošek</option><option value="income">prihodek</option></select>
        <button class="btn">Dodaj</button>
      </form>
    </section>

    <section class="card">
      <h2>Pravila za razvrščanje</h2>
      <p class="muted small">Če opis transakcije vsebuje besedilo, jo aplikacija uvrsti v izbrano kategorijo. Pravila nastanejo tudi sama, ko popraviš kategorijo uvožene transakcije.</p>
      ${userRules.length ? `<div class="rule-list">${userRules.map(r => {
        const c = category(r.categoryId);
        return `<div class="rule"><span>»${esc(r.pattern)}«</span><span class="arrow">→</span><span>${esc(c.emoji)} ${esc(categoryLabel(c.id))}</span><button class="icon-btn del-rule" data-id="${esc(r.id)}" aria-label="Izbriši pravilo">${icons.trash}</button></div>`;
      }).join('')}</div>` : '<p class="muted">Še nimaš svojih pravil.</p>'}
      <form class="add-row" id="addRule">
        <input name="pattern" placeholder="npr. Gostilna Pri Mostu" required aria-label="Besedilo v opisu">
        <select name="categoryId" aria-label="Kategorija">${categoryOptions(null)}</select>
        <button class="btn">Dodaj</button>
      </form>
      <details class="builtin">
        <summary>Vgrajena pravila (${builtinRules().length})</summary>
        ${[...builtinByCat].map(([id, patterns]) => `<p><b>${esc(category(id).emoji)} ${esc(categoryLabel(id))}:</b> ${patterns.map(esc).join(', ')}</p>`).join('')}
      </details>
    </section>

    <section class="card">
      <h2>Podatki</h2>
      <p class="muted small">Podatki so shranjeni v brskalniku na tej napravi (in šifrirani v oblaku, če je sinhronizacija vklopljena). Varnostna kopija je datoteka, ki jo lahko shraniš kamorkoli (npr. na OneDrive).</p>
      <div class="button-row">
        <button class="btn" id="exportBtn">Izvozi varnostno kopijo</button>
        <label class="btn">Obnovi iz kopije<input type="file" id="restoreFile" accept=".json,application/json" hidden></label>
        ${demoCount
          ? `<button class="btn" id="removeDemo">Odstrani primer podatkov (${demoCount})</button>`
          : '<button class="btn" id="loadDemo">Naloži primer podatkov</button>'}
        <button class="btn danger" id="wipeBtn">Izbriši vse podatke</button>
      </div>
    </section>`;

  renderSyncCard(view.querySelector('#syncCard'));

  // Kategorije: shranjevanje ob spremembi, brez ponovnega izrisa
  view.querySelectorAll('.cat-edit').forEach(row => {
    const current = () => state.categories.find(x => x.id === row.dataset.id);
    row.querySelector('.emoji-in').addEventListener('change', e => {
      const c = current();
      saveCategory({ ...c, emoji: e.target.value.trim() || c.emoji });
    });
    row.querySelector('.name-in').addEventListener('change', e => {
      const c = current();
      const name = e.target.value.trim();
      if (name) saveCategory({ ...c, name });
      else e.target.value = c.name;
    });
    row.querySelector('.del')?.addEventListener('click', async () => {
      const c = current();
      const n = total(c);
      const subs = childrenOf(c.id).length;
      const target = c.parentId ? category(c.parentId).name : c.kind === 'income' ? 'Drugi prihodki' : 'Ostalo';
      const message = `Izbrišem ${c.parentId ? 'podkategorijo' : 'kategorijo'} »${c.name}«?`
        + (subs ? ` Izbrišejo se tudi njene podkategorije (${subs}).` : '')
        + (n ? ` ${plural(n, TX_FORMS)} se premakne v »${target}«.` : '');
      if (await ask(message, { yes: 'Izbriši', danger: true })) {
        await deleteCategory(c.id);
        toast('Izbrisano');
      }
    });
  });

  // Nova podkategorija: gumb se zamenja z vrstico za vnos
  view.querySelectorAll('.add-sub').forEach(btn => btn.addEventListener('click', () => {
    const form = document.createElement('form');
    form.className = 'add-row sub';
    form.innerHTML = `
      <input name="emoji" class="emoji-in" placeholder="🏷️" maxlength="8" aria-label="Ikona">
      <input name="name" placeholder="Nova podkategorija" required aria-label="Ime podkategorije">
      <button class="btn">Dodaj</button>`;
    btn.replaceWith(form);
    form.elements.name.focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await saveCategory({ name: form.elements.name.value.trim(), emoji: form.elements.emoji.value.trim() || '🏷️', parentId: btn.dataset.parent });
      toast('Podkategorija dodana');
      renderSettings(view);
    });
  }));

  view.querySelector('#addCat').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements;
    await saveCategory({ name: f.name.value.trim(), emoji: f.emoji.value.trim() || '🏷️', kind: f.kind.value });
    toast('Kategorija dodana');
    renderSettings(view);
  });

  view.querySelector('#addRule').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements;
    const n = await addRule(f.pattern.value, f.categoryId.value);
    toast(n ? `Pravilo dodano, posodobljeno: ${plural(n, TX_FORMS)}` : 'Pravilo dodano');
  });
  view.querySelectorAll('.del-rule').forEach(btn => btn.addEventListener('click', () => deleteRule(btn.dataset.id)));

  view.querySelector('#exportBtn').addEventListener('click', () => {
    download(`stroski-kopija-${todayISO()}.json`, JSON.stringify(exportData(), null, 1));
  });
  view.querySelector('#restoreFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (await ask(`Obnovim podatke iz kopije? Trenutni podatki bodo zamenjani (${plural(data.transactions?.length ?? 0, TX_FORMS)} v kopiji).`, { yes: 'Obnovi', danger: true })) {
        await importData(data);
        toast('Podatki obnovljeni');
      }
    } catch (err) {
      toast(err instanceof SyntaxError ? 'Datoteka ni veljavna kopija.' : err.message);
    }
    e.target.value = '';
  });
  view.querySelector('#loadDemo')?.addEventListener('click', async () => { await loadDemo(); toast('Primer podatkov naložen'); });
  view.querySelector('#removeDemo')?.addEventListener('click', async () => {
    await deleteTransactions(state.transactions.filter(t => t.source === 'demo').map(t => t.id));
    toast('Primer podatkov odstranjen');
  });
  view.querySelector('#wipeBtn').addEventListener('click', async () => {
    if (await ask('Res izbrišem VSE transakcije, kategorije in pravila? Tega ni mogoče razveljaviti.', { yes: 'Izbriši vse', danger: true })) {
      await clearAll();
      toast('Vsi podatki izbrisani');
    }
  });
}
