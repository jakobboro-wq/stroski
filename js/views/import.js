import { state, allRules, saveTransactions, addRule, BASE_CURRENCY } from '../store.js';
import { parseCSV, detectColumns, rowsToTransactions, COLUMN_FIELDS } from '../csv.js';
import { readXlsx, isXlsx } from '../xlsx.js';
import { esc, signedMoney, plural, TX_FORMS, toast, icons } from '../ui.js';
import { monthOf } from '../stats.js';

const PREVIEW_ROWS = 150;
let session = null; // { fileName, rows, mapping, account, result }

export function renderImport(view) {
  view.innerHTML = `
    <header class="page-head"><h1>Uvoz izpiska</h1></header>
    <section class="card">
      <h2>Kako dobiš izpisek iz Revoluta</h2>
      <ol class="steps">
        <li>V aplikaciji Revolut odpri svoj račun (npr. glavni EUR račun).</li>
        <li>Tapni <b>…</b> (Več) → <b>Izpisek</b> (Statement).</li>
        <li>Izberi obliko <b>Excel</b> in obdobje, nato datoteko shrani (npr. na OneDrive).</li>
        <li>Izberi datoteko spodaj. Že uvožene transakcije se preskočijo, zato se izpiski lahko prekrivajo.</li>
      </ol>
    </section>
    <label class="dropzone" id="drop">
      <input type="file" id="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      ${icons.upload}
      <strong>Izberi izpisek (Excel ali CSV)</strong>
      <span>ali jo povleci sem</span>
    </label>
    <div id="preview"></div>`;

  const input = view.querySelector('#file');
  const drop = view.querySelector('#drop');
  input.addEventListener('change', () => input.files[0] && handleFile(input.files[0], view));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], view);
  });
  if (session) drawPreview(view);
}

async function handleFile(file, view) {
  let rows;
  try {
    const buffer = await file.arrayBuffer();
    rows = isXlsx(new Uint8Array(buffer, 0, 2)) ? await readXlsx(buffer) : parseCSV(new TextDecoder().decode(buffer));
  } catch (err) {
    rows = [];
    console.error(err);
  }
  if (rows.length < 2) {
    session = null;
    view.querySelector('#preview').innerHTML = '<div class="card error">Datoteke ni bilo mogoče prebrati. Podprti sta obliki CSV in Excel (.xlsx).</div>';
    return;
  }
  session = { fileName: file.name, rows, mapping: detectColumns(rows[0]), account: 'Revolut' };
  compute();
  drawPreview(view);
}

function compute() {
  const missing = Object.entries(COLUMN_FIELDS).filter(([k, f]) => f.required && session.mapping[k] < 0);
  if (missing.length) { session.result = null; return; }
  const result = rowsToTransactions(session.rows, session.mapping, allRules(), BASE_CURRENCY);
  const existing = new Set(state.transactions.map(t => t.importHash).filter(Boolean));
  result.fresh = result.items.filter(i => !existing.has(i.importHash));
  result.dupes = result.items.length - result.fresh.length;
  session.result = result;
}

function drawPreview(view) {
  const box = view.querySelector('#preview');
  const { rows, mapping, result } = session;
  const header = rows[0];
  const missing = !result;

  const mappingHtml = `
    <details class="mapping"${missing ? ' open' : ''}>
      <summary>Stolpci v datoteki${missing ? ' – manjkajo obvezni stolpci, izberi jih' : ' (samodejno prepoznani)'}</summary>
      <div class="mapping-grid">
        ${Object.entries(COLUMN_FIELDS).map(([key, f]) => `
          <label>${esc(f.label)}${f.required ? ' *' : ''}
            <select data-field="${key}">
              <option value="-1">— ni —</option>
              ${header.map((h, i) => `<option value="${i}"${mapping[key] === i ? ' selected' : ''}>${esc(h || `Stolpec ${i + 1}`)}</option>`).join('')}
            </select>
          </label>`).join('')}
      </div>
    </details>`;

  let body = '';
  if (result) {
    const { fresh, dupes, skipped } = result;
    const dates = fresh.map(t => t.date).sort();
    const skippedNotes = [
      dupes && `${plural(dupes, TX_FORMS)} že uvoženih`,
      skipped.pending && `${skipped.pending} še v obdelavi (uvozi jih kasneje)`,
      skipped.failed && `${skipped.failed} zavrnjenih ali preklicanih`,
      skipped.invalid && `${skipped.invalid} neveljavnih vrstic`,
    ].filter(Boolean);

    body = `
      <div class="import-stats">
        <div><b>${fresh.length}</b><span>novih</span></div>
        ${dates.length ? `<div><b>${esc(fmtDate(dates[0]))} – ${esc(fmtDate(dates.at(-1)))}</b><span>obdobje</span></div>` : ''}
      </div>
      ${skippedNotes.length ? `<p class="muted small">Preskočeno: ${skippedNotes.join(', ')}.</p>` : ''}
      ${fresh.length ? `
        <label class="inline-field">Račun <input id="account" value="${esc(session.account)}"></label>
        <p class="muted small">Kategorije lahko popraviš že tukaj ali kasneje. Aplikacija si zapomni tvoje popravke.</p>
        <div class="import-list">
          ${fresh.slice(0, PREVIEW_ROWS).map((t, i) => `
            <div class="import-row">
              <span class="tx-main"><span class="tx-desc">${esc(t.description || '—')}</span><span class="tx-meta">${esc(fmtDate(t.date))}</span></span>
              <select data-i="${i}" aria-label="Kategorija">${categoryOptions(t.categoryId)}</select>
              <span class="tx-amt">${signedMoney(t.amount, t.currency)}</span>
            </div>`).join('')}
          ${fresh.length > PREVIEW_ROWS ? `<p class="muted small">… in še ${fresh.length - PREVIEW_ROWS}</p>` : ''}
        </div>
        <div class="sticky-actions">
          <button class="btn" id="cancelImport">Prekliči</button>
          <button class="btn primary" id="doImport">Uvozi ${plural(fresh.length, TX_FORMS)}</button>
        </div>` : '<p>Vse transakcije iz te datoteke so že uvožene. 👍</p>'}`;
  }

  box.innerHTML = `<section class="card"><h2>${esc(session.fileName)}</h2>${mappingHtml}${body}</section>`;

  box.querySelectorAll('select[data-field]').forEach(sel => sel.addEventListener('change', () => {
    session.mapping[sel.dataset.field] = Number(sel.value);
    compute();
    drawPreview(view);
  }));
  box.querySelectorAll('select[data-i]').forEach(sel => sel.addEventListener('change', () => {
    const t = result.fresh[sel.dataset.i];
    t.categoryId = sel.value;
    t.categorySource = 'manual';
  }));
  box.querySelector('#account')?.addEventListener('input', e => { session.account = e.target.value; });
  box.querySelector('#cancelImport')?.addEventListener('click', () => { session = null; box.innerHTML = ''; view.querySelector('#file').value = ''; });
  box.querySelector('#doImport')?.addEventListener('click', async () => {
    const list = result.fresh.map(t => ({ ...t, account: session.account.trim() || 'Revolut', source: 'csv' }));
    const latest = list.map(t => t.date).sort().at(-1);
    // Popravki v predogledu postanejo pravila za naprej.
    const learned = new Map(list.filter(t => t.categorySource === 'manual' && t.description).map(t => [t.description, t.categoryId]));
    session = null;
    await saveTransactions(list);
    for (const [description, categoryId] of learned) await addRule(description, categoryId);
    toast(`Uvoženo: ${plural(list.length, TX_FORMS)}`);
    location.hash = `#/pregled?m=${monthOf(latest)}`;
  });
}

function categoryOptions(selected) {
  const groups = { expense: 'Stroški', income: 'Prihodki', transfer: 'Prenosi' };
  return Object.entries(groups).map(([kind, label]) => `<optgroup label="${label}">${state.categories
    .filter(c => c.kind === kind)
    .map(c => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}

const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${+d}. ${+m}. ${y}`; };
