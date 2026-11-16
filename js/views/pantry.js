// Zavihek Shramba: zaloga iz slikanih računov, napoved, kdaj kaj zmanjka, kdaj kupiti in prihranki.

import { state, getSetting, saveSetting } from '../store.js';
import { pantry, savings, spendByGroup, recommendations, cheaperElsewhere, statsRows, predictedDeal } from '../pantry.js';
import { isFoodGroup, GROUP } from '../products.js';
import { STORE_NAMES, STATS_URL, validity, unitLabel } from '../deals.js';
import { availableDeals } from './deals.js';
import { shopHeader, bindShopHeader } from './shop-nav.js';
import { esc, money, todayISO, toast } from '../ui.js';

const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };
const daysText = n => (n <= 0 ? 'zmanjkalo' : n === 1 ? 'jutri' : n < 5 ? `čez ${n} dni` : `čez ~${n} dni`);
const everyText = d => (d < 1.5 ? 'vsak dan' : d < 10 ? `vsakih ${Math.round(d)} dni` : d < 45 ? `vsakih ~${Math.round(d / 7)} ${Math.round(d / 7) === 1 ? 'teden' : Math.round(d / 7) === 2 ? 'tedna' : 'tedne'}` : `vsakih ~${Math.round(d / 30)} mes.`);
const prettyName = n => (n === n.toUpperCase() ? n[0] + n.slice(1).toLowerCase() : n);
const UI_KEY = 'pantry-ui';
const STATS_KEY = 'stats-cache';

// Zgodovina cen (cikli akcij) z veje »cene«: enkrat na zagon, medtem shranjena kopija.
let stats = null;
let statsLoading = null;
function loadStats(onFresh) {
  if (!stats) { try { stats = JSON.parse(localStorage.getItem(STATS_KEY)); } catch { stats = null; } }
  statsLoading ??= fetch(STATS_URL, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then(json => { stats = json; try { localStorage.setItem(STATS_KEY, JSON.stringify(json)); } catch { /* ni nujno */ } onFresh(); })
    .catch(err => console.warn('Zgodovina cen', err));
  return statsRows(stats);
}
const ui = (() => { try { return { food: true, ...JSON.parse(localStorage.getItem(UI_KEY)) }; } catch { return { food: true }; } })();

function dealLine(d, today) {
  const unit = unitLabel(d);
  return `<a class="pt-deal" href="${esc(d.u ?? '#')}" target="_blank" rel="noopener noreferrer">${esc(STORE_NAMES[d.s] ?? d.s)}: <b>${esc(money(d.p))}</b>${d.d ? ` −${d.d} %` : ''}${unit ? ` · ${esc(unit)}` : ''} · ${esc(d.n)}${validity(d, today) ? ` · ${esc(validity(d, today))}` : ''}</a>`;
}

function recRow(r, today) {
  const it = r.item;
  const em = it.group?.emoji ?? '🛒';
  const when = it.left == null ? '' : daysText(it.left);
  const why = {
    now: `${it.left <= 0 ? 'Zmanjkalo je.' : `Zmanjka ${when}.`} Zdaj je v akciji${r.similar ? ' podoben izdelek' : ''}:`,
    wait: r.predicted
      ? `Zdrži še do ${fmtDay(it.runout)}. Po zgodovini cen bo v akciji okoli ${fmtDay(r.predicted.next)} (${STORE_NAMES[r.predicted.s] ?? r.predicted.s}, običajno ${money(r.predicted.typ)}, vsakih ~${r.predicted.cy} dni). Napoved, ne objava.`
      : `Zdrži še do ${fmtDay(it.runout)}. Počakaj na akcijo od ${fmtDay(r.deal?.f ?? today)}:`,
    stock: `Kupiš ${everyText(it.daysPerPack ?? 30)}, zdaj je močno znižano. Vzemi na zalogo:`,
    buy: `${it.left <= 0 ? 'Zmanjkalo je.' : `Zmanjka ${when}.`} Akcije ni; običajno plačaš ${money(it.usual)}${it.cheapestStore ? `, najceneje si kupil v: ${it.cheapestStore}` : ''}.`,
  }[r.type];
  const tag = { now: 'Kupi zdaj', wait: 'Počakaj', stock: 'Na zalogo', buy: 'Kupi' }[r.type];
  return `
    <div class="pt-rec ${r.type}">
      <span class="pt-em">${em}</span>
      <div class="pt-main">
        <div class="pt-name">${esc(prettyName(it.name))} <span class="pt-tag ${r.type}">${tag}</span></div>
        <div class="muted small">${esc(why)}</div>
        ${r.deal ? dealLine(r.deal, today) : ''}
      </div>
      ${markButtons(it)}
    </div>`;
}

const markButtons = it => `<div class="pt-marks">
  <button type="button" class="btn ghost small" data-empty="${esc(it.key)}" title="Zmanjkalo je danes">Porabil</button>
  <button type="button" class="btn ghost small" data-have="${esc(it.key)}" title="Še imam, napoved je prezgodnja">Še imam</button>
</div>`;

function stockRow(it, rows = [], today = '') {
  const full = it.daysPerPack ? it.daysPerPack * it.lastQty : null;
  const pctLeft = full && it.left != null ? Math.max(0, Math.min(100, Math.round((it.left / full) * 100))) : null;
  const status = it.status === 'unknown' ? 'premalo nakupov za napoved' : daysText(it.left);
  const meta = [
    it.daysPerPack ? `kupiš ${everyText(it.daysPerPack)}` : null,
    `zadnjič ${fmtDay(it.last)}${it.lastStore ? ` (${it.lastStore})` : ''}`,
    `običajno ${money(it.usual)}`,
    it.confidence === 'low' ? 'groba ocena' : null,
  ].filter(Boolean).join(' · ');
  const pred = rows.length && it.count >= 2 ? predictedDeal(it, rows, today) : null;
  return `
    <div class="pt-item ${it.status}">
      <span class="pt-em">${it.group?.emoji ?? '🛒'}</span>
      <div class="pt-main">
        <div class="pt-name">${esc(prettyName(it.name))} <span class="pt-when ${it.status}">${esc(status)}</span></div>
        ${pctLeft != null ? `<div class="pt-bar" role="img" aria-label="Ostalo približno ${pctLeft} %"><i style="width:${pctLeft}%"></i></div>` : ''}
        <div class="muted small">${esc(meta)}</div>
        ${pred ? `<div class="deal-hist">naslednja akcija ~${esc(fmtDay(pred.next))} (${esc(STORE_NAMES[pred.s] ?? pred.s)}, ~${esc(money(pred.typ))})</div>` : ''}
      </div>
      ${it.status !== 'unknown' ? markButtons(it) : ''}
    </div>`;
}

export function renderPantry(view) {
  const today = todayISO();
  const from = `${today.slice(0, 7)}-01`;
  const marks = getSetting('pantry', { marks: {} }).marks ?? {};
  const deals = availableDeals(today, () => { if (location.hash.startsWith('#/zaloga')) renderPantry(view); });
  const tx = state.transactions;
  const all = pantry(tx, today, marks);
  const items = ui.food ? all.filter(it => isFoodGroup(it.g)) : all;
  const repeat = items.filter(it => it.count >= 2);
  const once = items.filter(it => it.count < 2);
  const rows = loadStats(() => { if (location.hash.startsWith('#/zaloga')) renderPantry(view); });
  const recs = recommendations(items, deals, today, { predictions: rows });
  const save = savings(tx, from, today);
  const groups = spendByGroup(tx, from, today);
  const foodSpend = groups.filter(g => isFoodGroup(g.id)).reduce((s, g) => s + g.amount, 0);
  const maxGroup = Math.max(1, ...groups.map(g => g.amount));
  const elsewhere = cheaperElsewhere(tx, deals, today);
  const receipts = new Set(tx.filter(t => t.source === 'receipt').map(t => t.receiptId)).size;

  view.innerHTML = `
    ${shopHeader('zaloga')}
    ${!all.length ? `
      <section class="card">
        <h2>Kako deluje</h2>
        <p>Slikaj račun iz trgovine. Iz postavk ugotovim, kaj kupuješ in kako hitro porabiš, napovem, kdaj ti bo kaj zmanjkalo, in povem, ali je pametno kupiti zdaj (akcija) ali počakati.</p>
        <p class="muted small">Napoved dobi izdelek po drugem nakupu; po tretjem je zanesljivejša. Če se zmoti, klikni »Porabil« ali »Še imam«.</p>
      </section>` : `
    <div class="tiles four">
      <div class="tile"><div class="tile-label">Prihranek ta mesec</div><div class="tile-value good">${esc(money(save.total))}</div></div>
      <div class="tile"><div class="tile-label">Popusti na računih</div><div class="tile-value">${esc(money(save.receipt))}</div></div>
      <div class="tile"><div class="tile-label">Pod tvojo običajno ceno</div><div class="tile-value">${esc(money(save.vsUsual))}</div></div>
      <div class="tile"><div class="tile-label">Hrana ta mesec</div><div class="tile-value">${esc(money(foodSpend))}</div></div>
    </div>
    ${save.overUsual > 0.5 ? `<p class="muted small">Pri nekaterih izdelkih si ta mesec plačal ${esc(money(save.overUsual))} več od svoje običajne cene.</p>` : ''}

    <section class="card">
      <div class="card-head"><h2>Kaj kupiti</h2>
        <div class="seg-mini" role="group" aria-label="Prikaz">
          <button type="button" data-food="1" class="${ui.food ? 'on' : ''}">Hrana</button>
          <button type="button" data-food="0" class="${ui.food ? '' : 'on'}">Vse</button>
        </div>
      </div>
      ${recs.length ? recs.map(r => recRow(r, today)).join('') : '<p class="muted small">Ta hip ti nič ne zmanjkuje in ni posebnih akcij za to, kar kupuješ.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h2>Zaloga</h2><span class="muted small">${repeat.length} izdelkov, ki jih kupuješ redno</span></div>
      ${repeat.length ? repeat.map(it => stockRow(it, rows, today)).join('') : '<p class="muted small">Ko kak izdelek kupiš drugič, se tu pojavi z napovedjo.</p>'}
      ${once.length ? `<details class="pt-once"><summary>Kupljeno enkrat (${once.length})</summary>${once.map(it => stockRow(it)).join('')}</details>` : ''}
    </section>

    ${elsewhere.length ? `
    <section class="card">
      <div class="card-head"><h2>Ta teden ceneje drugje</h2></div>
      <p class="muted small">Akcije za izdelke, ki si jih kupil zadnja dva tedna, z nižjo ceno (na kg ali l, če je znana). Ocena, ne izračunan prihranek.</p>
      ${elsewhere.map(e => `
        <div class="pt-rec">
          <span class="pt-em">${GROUP[e.purchase.g]?.emoji ?? '🛒'}</span>
          <div class="pt-main">
            <div class="pt-name">${esc(prettyName(e.purchase.name))} <span class="muted small">plačal ${esc(money(e.purchase.unit))} (${esc(e.purchase.store)})${e.similar ? ' · podoben izdelek' : ''}</span></div>
            ${dealLine(e.deal, today)}
          </div>
          <span class="pt-diff">−${esc(money(e.diff))}</span>
        </div>`).join('')}
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Kam gre denar ta mesec</h2><span class="muted small">postavke z ${receipts} ${receipts === 1 ? 'računa' : 'računov'}</span></div>
      ${groups.length ? groups.map(g => `
        <div class="pt-group">
          <span>${g.group.emoji} ${esc(g.group.name)}</span>
          <span class="pt-gbar"><i style="width:${Math.round((g.amount / maxGroup) * 100)}%"></i></span>
          <b>${esc(money(g.amount))}</b>
        </div>`).join('') : '<p class="muted small">Ta mesec še ni slikanih računov.</p>'}
    </section>

    ${save.best.length ? `
    <section class="card">
      <div class="card-head"><h2>Največji prihranki ta mesec</h2></div>
      ${save.best.map(b => `<div class="pt-group"><span>${esc(prettyName(b.name))} <span class="muted small">${esc(fmtDay(b.date))}, ${esc(b.store)}</span></span><span class="muted small">${esc(money(b.paid))} namesto ${esc(money(b.usual))}</span><b class="good">−${esc(money(b.saved))}</b></div>`).join('')}
    </section>` : ''}
    <p class="muted small">Napoved temelji na razmikih med tvojimi nakupi (mediana, deljena s kupljeno količino). Izdelke loči po imenu na računu, zato je isti izdelek iz dveh trgovin lahko dvakrat. ${stats?.since ? `Zgodovina cen se zbira od ${esc(fmtDay(stats.since))} (${stats.days} ${stats.days === 1 ? 'dan' : 'dni'}); cikli akcij se pokažejo, ko je izdelek v akciji vsaj dvakrat.` : ''}</p>`}`;

  bindShopHeader(view);
  view.querySelectorAll('[data-food]').forEach(b => b.addEventListener('click', () => {
    ui.food = b.dataset.food === '1';
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ni nujno */ }
    renderPantry(view);
  }));
  const mark = async (key, field, msg) => {
    const next = { ...marks, [key]: { ...(marks[key] ?? {}), [field]: today } };
    await saveSetting({ id: 'pantry', marks: next });
    toast(msg);
  };
  view.querySelectorAll('[data-empty]').forEach(b => b.addEventListener('click', () => mark(b.dataset.empty, 'empty', 'Zabeleženo: porabljeno danes')));
  view.querySelectorAll('[data-have]').forEach(b => b.addEventListener('click', () => mark(b.dataset.have, 'have', 'Zabeleženo: še imaš, napoved zamaknjena')));
}
