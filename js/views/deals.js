// Zavihek Akcije: akcije trgovin (osvežene vsako jutro). Privzeto hrana, pregled po skupinah živil.

import { state, getSetting, saveSetting } from '../store.js';
import { DEALS_URL, STORE_NAMES, dealsForYou, filterDeals, baseFilter, groupCounts, byGroup, validity, mergeLeaflet, isFoodDeal, isUpcoming, unitLabel, historyNotes, notReal } from '../deals.js';
import { GROUP, enrichDeal } from '../products.js';
import { readLeafletPdf, parseLeaflet } from '../hofer.js';
import { shopHeader, bindShopHeader } from './shop-nav.js';
import { esc, money, todayISO, toast } from '../ui.js';

const HOFER_LEAFLETS = 'https://www.hofer.si/aktualni-letaki-in-brosure';

const CACHE_KEY = 'deals-cache';
const UI_KEY = 'deals-ui';
const PAGE = 60;
let data = null;      // { updatedAt, stores, deals }
let loading = null;
let failed = false;
let enriched = { src: null, list: [] };

// Filtri ostanejo med obiski (samo na tej napravi). Iskanje se ne shrani.
const DEFAULT_UI = { mode: 'food', group: '', stores: [], sort: 'discount', minDisc: 0, noCard: false, upcoming: false, realOnly: false };
const ui = { ...DEFAULT_UI, ...loadUi(), query: '', shown: PAGE };
function loadUi() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) ?? {}; } catch { return {}; }
}
function saveUi() {
  const { query, shown, ...keep } = ui;
  try { localStorage.setItem(UI_KEY, JSON.stringify(keep)); } catch { /* ni nujno */ }
}

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

/** Akcije s skupino in ceno na enoto. Starejši deals.json ju nima, zato ju dopolnimo enkrat na nalaganje. */
function autoDeals() {
  const src = data?.deals ?? [];
  if (enriched.src !== src) enriched = { src, list: src.map(d => (d.g || d.up ? d : enrichDeal(d))) };
  return enriched.list;
}

/** Za druge poglede (Shramba): vse akcije z letakom vred; ob prvem klicu jih naloži in pokliče onFresh. */
export function availableDeals(today, onFresh = () => {}) {
  if (!loading) loading = fetchDeals().then(onFresh);
  data ??= cached();
  const hofer = (getSetting('hofer', {}).deals ?? []).filter(d => !d.to || d.to >= today).map(d => (d.g ? d : enrichDeal(d)));
  return mergeLeaflet(autoDeals(), hofer);
}

/** Kdaj so bile akcije osvežene in katere trgovine danes niso bile prebrane (kažejo starejše podatke). */
export const dealsStatus = () => ({
  updatedAt: data?.updatedAt ?? null,
  old: Object.entries(data?.stores ?? {}).filter(([, s]) => !s.ok).map(([id, s]) => ({ id, at: s.stale ? s.at : null })),
  failed,
});

const watchList = () => getSetting('deals', { watch: [] }).watch ?? [];
const boughtNames = () => [
  ...state.transactions.flatMap(t => t.items?.map(i => i.name) ?? []),
  ...Object.keys(getSetting('receipts', { items: {} }).items ?? {}),
];

function dealRow(d, today, match = null) {
  const why = match && `${match.watched ? 'spremljaš' : 'kupuješ'}: ${match.why}`;
  // Popust samo s kartico (Lidl Plus, Pika), če to ne piše že v oznaki.
  const card = d.plus && !/kartic|plus/i.test(d.t ?? '') ? 's kartico' : null;
  const meta = [STORE_NAMES[d.s] ?? d.s, d.t, card, validity(d, today), d.q, why].filter(Boolean);
  const unit = unitLabel(d);
  const notes = historyNotes(d);
  return `
    <a class="deal${isUpcoming(d, today) ? ' later' : ''}${notReal(d) ? ' fake' : ''}" href="${esc(d.u ?? '#')}" target="_blank" rel="noopener noreferrer">
      ${d.i ? `<img src="${esc(d.i)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="deal-noimg">${GROUP[d.g]?.emoji ?? '🏷️'}</span>`}
      <span class="deal-main"><span class="deal-name">${esc(d.n)}</span><span class="deal-meta">${esc(meta.join(' · '))}</span>${notes.length ? `<span class="deal-hist">${esc(notes.join(' · '))}</span>` : ''}</span>
      <span class="deal-price"><b>${esc(money(d.p))}</b>${d.d ? `<em>−${d.d} %</em>` : d.o ? `<s>${esc(money(d.o))}</s>` : ''}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
    </a>`;
}

const updatedLabel = iso => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ob ${d.getHours()}.${String(d.getMinutes()).padStart(2, '0')}`;
};
const plural = (n, [one, two, few, many]) => `${n} ${n % 100 === 1 ? one : n % 100 === 2 ? two : n % 100 === 3 || n % 100 === 4 ? few : many}`;
const nDeals = n => plural(n, ['akcija', 'akciji', 'akcije', 'akcij']);

export function renderDeals(view) {
  const today = todayISO();
  // Enkrat na zagon naloži sveže akcije; medtem pokaži shranjene.
  if (!loading) {
    loading = fetchDeals().then(() => { if (location.hash.startsWith('#/akcije')) renderDeals(view); });
  }
  data ??= cached();
  const hofer = getSetting('hofer', {});
  const hoferDeals = (hofer.deals ?? []).filter(d => !d.to || d.to >= today).map(d => (d.g ? d : enrichDeal(d)));
  if (!data?.deals && !hofer.deals) {
    view.innerHTML = `${shopHeader('akcije')}${failed
      ? '<section class="card"><p>Akcij trenutno ni mogoče naložiti. Preveri povezavo in poskusi znova.</p><button class="btn" id="dealsRetry">Poskusi znova</button></section>'
      : '<p class="muted">Nalagam akcije …</p>'}`;
    view.querySelector('#dealsRetry')?.addEventListener('click', () => { loading = null; failed = false; renderDeals(view); });
    return;
  }

  const allDeals = mergeLeaflet(autoDeals(), hoferDeals);
  const stores = Object.entries(data?.stores ?? {});
  const hoferAll = allDeals.filter(d => d.s === 'hofer').length;
  const hoferWeb = stores.find(([id]) => id === 'hofer');
  if (hoferWeb) hoferWeb[1] = { ...hoferWeb[1], count: hoferAll };
  else if (hoferDeals.length) stores.push(['hofer', { ok: true, count: hoferAll }]);
  const broken = stores.filter(([, s]) => !s.ok).map(([id, s]) =>
    `${STORE_NAMES[id] ?? id}${s.stale && s.at ? ` (prikazujem akcije z dne ${updatedLabel(s.at).split(' ob')[0]})` : ''}`);
  const old = data?.updatedAt && Date.now() - new Date(data.updatedAt).getTime() > 2 * 86400e3;
  const watch = watchList();
  const forYou = dealsForYou(allDeals.filter(d => !isUpcoming(d, today)), { watch, bought: boughtNames() }, today);
  const fmt = isoDay => { const [, m, d] = isoDay.split('-'); return `${+d}. ${+m}.`; };
  const hoferPeriod = hofer.f ? `${fmt(hofer.f)}${hofer.to ? `–${fmt(hofer.to)}` : ''}` : '';
  const hoferExpired = hofer.deals && !hoferDeals.length;
  const foodCount = allDeals.filter(d => isFoodDeal(d) && !isUpcoming(d, today) && (!d.to || d.to >= today)).length;

  view.innerHTML = `
    ${shopHeader('akcije')}
    <p class="muted small">${data?.updatedAt ? `Osveženo ${esc(updatedLabel(data.updatedAt))} · ` : ''}${esc(nDeals(foodCount))} za hrano in pijačo v ${stores.filter(([, s]) => s.ok || s.stale).length} trgovinah${failed ? ' · brez povezave, prikazujem shranjene' : ''}</p>
    ${broken.length ? `<p class="card hint">Branje za ${esc(broken.join(', '))} danes ni uspelo (trgovina je morda spremenila stran).</p>` : ''}
    ${old ? '<p class="card hint">Akcije niso bile osvežene več kot dva dni, zato so lahko nekatere že potekle.</p>' : ''}

    <section class="card">
      <div class="card-head"><h2>Zate</h2></div>
      <p class="muted small">Akcije za izdelke, ki jih spremljaš ali kupuješ (iz slikanih računov).</p>
      <div class="watch">
        ${watch.map((w, i) => `<span class="watch-chip">${esc(w)}<button type="button" data-unwatch="${i}" aria-label="Odstrani ${esc(w)}">×</button></span>`).join('')}
        <form id="watchForm" class="watch-add"><input name="w" placeholder="Spremljaj, npr. kava" autocomplete="off" aria-label="Spremljaj izdelek"><button class="btn">Dodaj</button></form>
      </div>
      <div class="deal-list">${forYou.length ? forYou.slice(0, 12).map(x => dealRow(x.deal, today, x)).join('')
        : `<p class="muted small">${watch.length ? 'Za tvoj seznam ta hip ni akcij.' : 'Dodaj, kaj kupuješ (npr. mleko, kava, pivo), pa ti pokažem akcije zanje.'}</p>`}</div>
    </section>

    <section class="card deals-browse">
      <div class="deals-top">
        <div class="seg-mini" role="group" aria-label="Kaj prikažem">
          <button type="button" data-mode="food" class="${ui.mode === 'food' ? 'on' : ''}">🍽️ Hrana in pijača</button>
          <button type="button" data-mode="all" class="${ui.mode === 'all' ? 'on' : ''}">Vse</button>
        </div>
        <select id="dealSort" aria-label="Razvrsti">
          <option value="discount"${ui.sort === 'discount' ? ' selected' : ''}>Največji popust</option>
          <option value="unit"${ui.sort === 'unit' ? ' selected' : ''}>Najnižja cena na kg/l</option>
          <option value="price"${ui.sort === 'price' ? ' selected' : ''}>Najnižja cena</option>
          <option value="name"${ui.sort === 'name' ? ' selected' : ''}>Po imenu</option>
        </select>
      </div>
      <input type="search" id="dealQuery" class="deal-search" placeholder="Išči, npr. mleko, kava, piščanec" value="${esc(ui.query)}" autocomplete="off">
      <div class="chips-row" id="groupChips" aria-label="Skupine"></div>
      <div class="chips-row" id="storeChips" aria-label="Trgovine">
        ${stores.map(([id]) => `<button type="button" class="fchip${ui.stores.includes(id) ? ' on' : ''}" data-store="${esc(id)}">${esc(STORE_NAMES[id] ?? id)}</button>`).join('')}
      </div>
      <div class="chips-row small">
        ${[0, 20, 30, 50].map(v => `<button type="button" class="fchip${ui.minDisc === v ? ' on' : ''}" data-disc="${v}">${v ? `−${v} % in več` : 'Vsi popusti'}</button>`).join('')}
        <button type="button" class="fchip${ui.noCard ? ' on' : ''}" data-toggle="noCard">Brez kartice</button>
        <button type="button" class="fchip${ui.upcoming ? ' on' : ''}" data-toggle="upcoming">Tudi prihodnje</button>
        <button type="button" class="fchip${ui.realOnly ? ' on' : ''}" data-toggle="realOnly" title="Skrij akcije, ki niso nižje od najnižje cene v zadnjih 30 dneh">Prava znižanja</button>
      </div>
      <div id="dealList"></div>
    </section>

    <section class="card hofer-card">
      <div>
        <h2>Hoferjev letak</h2>
        <p class="muted small">${hofer.deals
          ? (hoferExpired ? `Letak (${esc(hoferPeriod)}) je potekel. Uvozi novega.` : `Letak ${esc(hoferPeriod)} · ${hoferDeals.length} izdelkov`)
          : 'Posebna ponudba in znižane cene s hofer.si se berejo samodejno. Popusti (stara cena, −%) so samo v letaku: prenesi ga (PDF) in izberi tukaj.'}</p>
        <p class="muted small" id="hoferStatus" hidden></p>
      </div>
      <div class="hofer-actions">
        <a class="btn ghost" href="${HOFER_LEAFLETS}" target="_blank" rel="noopener noreferrer">1. Odpri letake ↗</a>
        <label class="btn${hoferExpired ? ' primary' : ''}">2. Uvozi PDF<input type="file" accept="application/pdf,.pdf" id="hoferFile" hidden></label>
      </div>
    </section>
    <p class="muted small">Cene so z javnih strani trgovin in iz uvoženega Hoferjevega letaka; v posamezni prodajalni se lahko razlikujejo. Mercatorjeve cene so iz spletne trgovine Mercator Online. Spar ni vključen. Skupine so določene samodejno iz imena in kategorije trgovine, zato se lahko kak izdelek znajde v napačni.</p>`;

  // V pogledu »Hrana« so v »Ostalo« živila brez jasne skupine.
  const groupName = id => (id === 'drugo' && ui.mode === 'food' ? 'Ostala hrana' : GROUP[id]?.name ?? '');
  bindShopHeader(view);
  const list = view.querySelector('#dealList');
  const groupChips = view.querySelector('#groupChips');

  const drawList = () => {
    const base = baseFilter(allDeals, ui, today);
    const groups = groupCounts(base);
    if (ui.group && !groups.some(g => g.id === ui.group)) ui.group = '';
    groupChips.innerHTML = `<button type="button" class="fchip${ui.group ? '' : ' on'}" data-group="">${ui.mode === 'food' ? 'Vsa hrana' : 'Vse'} <span>${base.length}</span></button>`
      + groups.map(g => `<button type="button" class="fchip${ui.group === g.id ? ' on' : ''}" data-group="${g.id}">${g.emoji} ${esc(groupName(g.id))} <span>${g.count}</span></button>`).join('');

    // Pregled po skupinah, dokler ne iščeš in ne izbereš skupine.
    if (!ui.group && !ui.query.trim() && groups.length > 1) {
      list.innerHTML = byGroup(base, ui.sort, 4).map(g => `
        <div class="deal-group">
          <button type="button" class="deal-group-head" data-group="${g.id}"><span>${g.emoji} ${esc(groupName(g.id))}</span><span class="muted small">${esc(nDeals(g.count))} ›</span></button>
          <div class="deal-list">${g.top.map(d => dealRow(d, today)).join('')}</div>
        </div>`).join('') || '<p class="muted small">Ni zadetkov.</p>';
      return;
    }
    const all = filterDeals(allDeals, ui, today);
    list.innerHTML = all.length
      ? `<p class="muted small">${esc(nDeals(all.length))}${ui.group ? ` · ${esc(groupName(ui.group))}` : ''}</p>
         <div class="deal-list">${all.slice(0, ui.shown).map(d => dealRow(d, today)).join('')}</div>
         ${all.length > ui.shown ? '<button class="btn ghost" id="dealMore">Pokaži več</button>' : ''}`
      : '<p class="muted small">Ni zadetkov. Poskusi brez katerega od filtrov.</p>';
    list.querySelector('#dealMore')?.addEventListener('click', () => { ui.shown += PAGE; drawList(); });
  };
  const update = (changes = {}) => {
    Object.assign(ui, changes, { shown: PAGE });
    saveUi();
    drawList();
  };
  drawList();

  // Klik na čip ali glavo skupine.
  view.querySelector('.deals-browse').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) {
      view.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
      update({ mode: b.dataset.mode, group: '' });
    } else if (b.dataset.group !== undefined) {
      update({ group: b.dataset.group });
      if (b.classList.contains('deal-group-head')) view.querySelector('#groupChips').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (b.dataset.store) {
      const on = !ui.stores.includes(b.dataset.store);
      b.classList.toggle('on', on);
      update({ stores: on ? [...ui.stores, b.dataset.store] : ui.stores.filter(s => s !== b.dataset.store) });
    } else if (b.dataset.disc !== undefined) {
      view.querySelectorAll('[data-disc]').forEach(x => x.classList.toggle('on', x === b));
      update({ minDisc: Number(b.dataset.disc) });
    } else if (b.dataset.toggle) {
      const k = b.dataset.toggle;
      b.classList.toggle('on', !ui[k]);
      update({ [k]: !ui[k] });
    }
  });

  let timer;
  view.querySelector('#dealQuery').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => update({ query: e.target.value }), 200);
  });
  view.querySelector('#dealSort').addEventListener('change', e => update({ sort: e.target.value }));

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

  view.querySelector('#hoferFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const status = view.querySelector('#hoferStatus');
    status.hidden = false;
    status.textContent = 'Berem letak …';
    try {
      const pages = await readLeafletPdf(file, p => { status.textContent = `Berem letak … ${Math.round(p * 100)} %`; });
      const deals = parseLeaflet(pages, today).map(enrichDeal);
      if (!deals.length) {
        status.textContent = 'V tem PDF-ju ni bilo mogoče najti izdelkov s cenami. Je to Hoferjev letak?';
        return;
      }
      const periods = deals.map(d => d.f).filter(Boolean).sort();
      const ends = deals.map(d => d.to).filter(Boolean).sort();
      await saveSetting({ id: 'hofer', deals, f: periods[0] ?? null, to: ends.at(-1) ?? null, importedAt: Date.now() });
      toast(`Hofer: uvoženih ${deals.length} izdelkov`);
    } catch (err) {
      console.error(err);
      status.textContent = err.message || 'Letaka ni bilo mogoče prebrati.';
    }
  });
}
