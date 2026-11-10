// Zavihek Akcije: akcije trgovin (osvežene vsako jutro), najprej tiste, ki te zanimajo.

import { state, getSetting, saveSetting } from '../store.js';
import { DEALS_URL, STORE_NAMES, dealsForYou, filterDeals, validity } from '../deals.js';
import { esc, money, todayISO, toast } from '../ui.js';

const CACHE_KEY = 'deals-cache';
const PAGE = 60;
let data = null;      // { updatedAt, stores, deals }
let loading = null;
let failed = false;
const ui = { query: '', store: '', food: false, sort: 'discount', shown: PAGE };

function cached() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

async function fetchDeals() {
  try {
    const res = await fetch(DEALS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
    failed = false;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ni prostora: ni nujno */ }
  } catch (err) {
    console.warn('Akcije', err);
    data ??= cached();
    failed = true;
  }
}

const watchList = () => getSetting('deals', { watch: [] }).watch ?? [];
const boughtNames = () => [
  ...state.transactions.flatMap(t => t.items?.map(i => i.name) ?? []),
  ...Object.keys(getSetting('receipts', { items: {} }).items ?? {}),
];

function dealRow(d, today, match = null) {
  const why = match && `${match.watched ? 'spremljaš' : 'kupuješ'}: ${match.why}`;
  const meta = [STORE_NAMES[d.s] ?? d.s, d.t, validity(d, today), d.q, why].filter(Boolean);
  return `
    <a class="deal" href="${esc(d.u ?? '#')}" target="_blank" rel="noopener noreferrer">
      ${d.i ? `<img src="${esc(d.i)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="deal-noimg">🏷️</span>'}
      <span class="deal-main"><span class="deal-name">${esc(d.n)}</span><span class="deal-meta">${esc(meta.join(' · '))}</span></span>
      <span class="deal-price"><b>${esc(money(d.p))}</b>${d.o ? `<s>${esc(money(d.o))}</s>` : ''}${d.d ? `<em>−${d.d} %</em>` : ''}</span>
    </a>`;
}

const updatedLabel = iso => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ob ${d.getHours()}.${String(d.getMinutes()).padStart(2, '0')}`;
};

export function renderDeals(view) {
  const today = todayISO();
  // Enkrat na zagon naloži sveže akcije; medtem pokaži shranjene.
  if (!loading) {
    loading = fetchDeals().then(() => { if (location.hash.startsWith('#/akcije')) renderDeals(view); });
  }
  data ??= cached();
  if (!data?.deals) {
    view.innerHTML = `<header class="page-head"><h1>Akcije</h1></header>${failed
      ? '<section class="card"><p>Akcij trenutno ni mogoče naložiti. Preveri povezavo in poskusi znova.</p><button class="btn" id="dealsRetry">Poskusi znova</button></section>'
      : '<p class="muted">Nalagam akcije …</p>'}`;
    view.querySelector('#dealsRetry')?.addEventListener('click', () => { loading = null; failed = false; renderDeals(view); });
    return;
  }

  const stores = Object.entries(data.stores ?? {});
  const broken = stores.filter(([, s]) => !s.ok).map(([id]) => STORE_NAMES[id] ?? id);
  const old = Date.now() - new Date(data.updatedAt).getTime() > 2 * 86400e3;
  const watch = watchList();
  const forYou = dealsForYou(data.deals, { watch, bought: boughtNames() }, today);

  view.innerHTML = `
    <header class="page-head"><h1>Akcije</h1></header>
    <p class="muted small">Osveženo ${esc(updatedLabel(data.updatedAt))} · ${stores.filter(([, s]) => s.ok).map(([id, s]) => `${esc(STORE_NAMES[id] ?? id)} ${s.count}`).join(' · ')}${failed ? ' · brez povezave, prikazujem shranjene' : ''}</p>
    ${broken.length ? `<p class="card hint">Branje za ${esc(broken.join(', '))} tokrat ni uspelo (trgovina je morda spremenila stran).</p>` : ''}
    ${old ? '<p class="card hint">Akcije niso bile osvežene več kot dva dni, zato so lahko nekatere že potekle.</p>' : ''}

    <section class="card">
      <div class="card-head"><h2>Zate</h2></div>
      <p class="muted small">Akcije za izdelke, ki jih spremljaš ali kupuješ (iz slikanih računov).</p>
      <div class="watch">
        ${watch.map((w, i) => `<span class="watch-chip">${esc(w)}<button type="button" data-unwatch="${i}" aria-label="Odstrani ${esc(w)}">×</button></span>`).join('')}
        <form id="watchForm" class="watch-add"><input name="w" placeholder="Spremljaj, npr. kava" autocomplete="off" aria-label="Spremljaj izdelek"><button class="btn">Dodaj</button></form>
      </div>
      <div class="deal-list">${forYou.length ? forYou.map(x => dealRow(x.deal, today, x)).join('')
        : `<p class="muted small">${watch.length ? 'Za tvoj seznam ta hip ni akcij.' : 'Dodaj, kaj kupuješ (npr. mleko, kava, pivo), pa ti pokažem akcije zanje.'}</p>`}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Vse akcije</h2></div>
      <div class="deal-filters">
        <input type="search" id="dealQuery" placeholder="Išči, npr. mleko" value="${esc(ui.query)}" autocomplete="off">
        <select id="dealStore" aria-label="Trgovina"><option value="">Vse trgovine</option>${stores.map(([id]) => `<option value="${esc(id)}"${ui.store === id ? ' selected' : ''}>${esc(STORE_NAMES[id] ?? id)}</option>`).join('')}</select>
        <select id="dealSort" aria-label="Razvrsti">
          <option value="discount"${ui.sort === 'discount' ? ' selected' : ''}>Največji popust</option>
          <option value="price"${ui.sort === 'price' ? ' selected' : ''}>Najnižja cena</option>
          <option value="name"${ui.sort === 'name' ? ' selected' : ''}>Po imenu</option>
        </select>
        <label class="check"><input type="checkbox" id="dealFood"${ui.food ? ' checked' : ''}> Samo hrana in pijača</label>
      </div>
      <div id="dealList"></div>
    </section>
    <p class="muted small">Cene so z javnih strani trgovin in se lahko razlikujejo od cen v posamezni trgovini. Hofer, Spar in Mercator niso vključeni, ker njihovih akcij ni mogoče samodejno prebrati.</p>`;

  const list = view.querySelector('#dealList');
  const drawList = () => {
    const all = filterDeals(data.deals, ui, today);
    list.innerHTML = all.length
      ? `<p class="muted small">${all.length} ${all.length === 1 ? 'akcija' : all.length === 2 ? 'akciji' : all.length < 5 ? 'akcije' : 'akcij'}</p>
         <div class="deal-list">${all.slice(0, ui.shown).map(d => dealRow(d, today)).join('')}</div>
         ${all.length > ui.shown ? '<button class="btn ghost" id="dealMore">Pokaži več</button>' : ''}`
      : '<p class="muted small">Ni zadetkov.</p>';
    list.querySelector('#dealMore')?.addEventListener('click', () => { ui.shown += PAGE; drawList(); });
  };
  drawList();

  let timer;
  view.querySelector('#dealQuery').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.query = e.target.value; ui.shown = PAGE; drawList(); }, 200);
  });
  view.querySelector('#dealStore').addEventListener('change', e => { ui.store = e.target.value; ui.shown = PAGE; drawList(); });
  view.querySelector('#dealSort').addEventListener('change', e => { ui.sort = e.target.value; ui.shown = PAGE; drawList(); });
  view.querySelector('#dealFood').addEventListener('change', e => { ui.food = e.target.checked; ui.shown = PAGE; drawList(); });

  view.querySelector('#watchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const w = e.target.w.value.trim().toLowerCase();
    if (!w) return;
    if (!watch.includes(w)) await saveSetting({ id: 'deals', watch: [...watch, w] });
    toast(`Spremljam »${w}«`);
  });
  view.querySelectorAll('[data-unwatch]').forEach(b => b.addEventListener('click', async () => {
    await saveSetting({ id: 'deals', watch: watch.filter((_, i) => i !== Number(b.dataset.unwatch)) });
  }));
}
