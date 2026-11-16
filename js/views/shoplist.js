// Nakupi → Seznam: nakupovalni seznam in razpored po trgovinah, da je skupaj najceneje.

import { state, getSetting, saveSetting } from '../store.js';
import { optimize } from '../shoplist.js';
import { pantry } from '../pantry.js';
import { STORE_NAMES, unitLabel } from '../deals.js';
import { availableDeals } from './deals.js';
import { shopHeader, bindShopHeader } from './shop-nav.js';
import { esc, money, todayISO } from '../ui.js';

const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };
const eur = v => v.toFixed(2).replace('.', ',');
const DEFAULTS = { items: [], maxStores: 2, extra: 3 };
const conf = () => ({ ...DEFAULTS, ...getSetting('shoplist', {}) });
const save = changes => saveSetting({ ...conf(), ...changes, id: 'shoplist' });

/** Besedilo za seznam iz imena z računa: prvi dve besedi brez številk (»MLEKO ALPSKO 1L« → »mleko alpsko«). */
const listText = name => name.toLowerCase().replace(/[^\p{L} ]/gu, ' ').split(/\s+/).filter(w => w.length >= 3).slice(0, 2).join(' ');

function offerLine(p) {
  const o = p.offer;
  if (!o) return `<span class="muted small">ni akcije v tej trgovini; računam z najvišjo znano ceno</span>`;
  const per = p.unit ? ` · ${eur(o.up)} €/${o.uu}` : '';
  if (o.source === 'deal') {
    const d = o.deal;
    return `<a class="pt-deal" href="${esc(d.u ?? '#')}" target="_blank" rel="noopener noreferrer">${esc(d.n)} · <b>${esc(money(d.p))}</b>${d.d ? ` −${d.d} %` : ''}${esc(per)}${d.plus ? ' · s kartico' : ''}</a>`;
  }
  return `<span class="muted small">tvoja cena ${esc(fmtDay(o.date))}: ${esc(o.name)} · ${esc(money(o.price))}${esc(per)}</span>`;
}

export function renderShoplist(view) {
  const today = todayISO();
  const c = conf();
  const deals = availableDeals(today, () => { if (location.hash.startsWith('#/seznam')) renderShoplist(view); });
  const marks = getSetting('pantry', { marks: {} }).marks ?? {};
  const have = new Set(c.items.map(i => i.text.toLowerCase()));
  const running = pantry(state.transactions, today, marks)
    .filter(it => it.left != null && it.left <= 7)
    .map(it => listText(it.name)).filter(t => t && !have.has(t));
  const r = c.items.length ? optimize(c.items, deals, state.transactions, today, { maxStores: c.maxStores, extraStoreCost: c.extra }) : null;
  const best = r?.best;
  const single = r?.single ?? [];
  const bestSingle = single[0];
  const saved = best && bestSingle && best.stores.length > 1 ? Math.round((bestSingle.total - best.total) * 100) / 100 : 0;
  const byStore = best ? best.stores.map(s => ({ s, items: best.plan.filter(p => p.store === s) })).filter(g => g.items.length) : [];

  view.innerHTML = `
    ${shopHeader('seznam')}
    <section class="card">
      <div class="card-head"><h2>Seznam</h2>${c.items.length ? '<button type="button" class="btn ghost small" id="slClear">Počisti</button>' : ''}</div>
      <form id="slAdd" class="watch-add"><input name="t" placeholder="Dodaj, npr. mleko, kava barcaffe, piščančji file" autocomplete="off" aria-label="Dodaj na seznam"><button class="btn">Dodaj</button></form>
      ${running.length ? `<button type="button" class="btn ghost small" id="slRunning">＋ Dodaj, kar zmanjkuje (${running.length})</button>` : ''}
      <div class="watch sl-items">${c.items.map((it, i) => `<span class="watch-chip">${esc(it.text)}<button type="button" data-del="${i}" aria-label="Odstrani ${esc(it.text)}">×</button></span>`).join('')}</div>
      <div class="sl-opts">
        <span class="muted small">Največ trgovin</span>
        <div class="seg-mini" role="group" aria-label="Največ trgovin">${[1, 2, 3].map(n => `<button type="button" data-max="${n}" class="${c.maxStores === n ? 'on' : ''}">${n}</button>`).join('')}</div>
        <label class="muted small">Dodatna trgovina se splača od <input id="slExtra" type="number" min="0" step="0.5" value="${esc(String(c.extra))}" inputmode="decimal"> €</label>
      </div>
    </section>

    ${!c.items.length ? '<p class="muted">Dodaj, kaj rabiš. Za vsako postavko poiščem akcije in tvoje cene z računov ter povem, v katerih trgovinah je skupaj najceneje.</p>' : !best ? `
    <section class="card"><p>Za nobeno postavko ni podatka o ceni (ni v akciji in je še nisi kupil s slikanim računom).</p></section>` : `
    <section class="card">
      <div class="card-head"><h2>Najceneje: ${esc(best.stores.map(s => STORE_NAMES[s] ?? s).join(' + '))}</h2><b>${esc(money(best.total))}</b></div>
      ${saved > 0 ? `<p class="small">Prihranek proti najcenejši eni trgovini (${esc(STORE_NAMES[bestSingle.store] ?? bestSingle.store)}, ${esc(money(bestSingle.total))}): <b class="good">${esc(money(saved))}</b>.</p>` : ''}
      ${byStore.map(g => `
        <div class="deal-group">
          <div class="deal-group-head"><span>${esc(STORE_NAMES[g.s] ?? g.s)}</span><span class="muted small">${esc(money(g.items.reduce((a, p) => a + p.cost, 0)))}</span></div>
          ${g.items.map(p => `
            <div class="sl-row">
              <div><b>${esc(p.text)}</b>${p.unit ? ` <span class="muted small">(za ${esc(String(p.ref).replace('.', ','))} ${esc(p.unit)})</span>` : ''}<br>${offerLine(p)}</div>
              <span class="${p.estimated ? 'muted' : ''}">${esc(money(p.cost))}</span>
            </div>`).join('')}
        </div>`).join('')}
      ${r.unknown.length ? `<p class="muted small">Brez podatka o ceni: ${esc(r.unknown.join(', '))} (ni v akciji in še nisi kupil s slikanim računom).</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Vse v eni trgovini</h2></div>
      ${single.map(x => `<div class="pt-group"><span>${esc(STORE_NAMES[x.store] ?? x.store)}</span><span class="muted small">cena znana za ${x.known} od ${r.count}</span><b>${esc(money(x.total))}</b></div>`).join('')}
    </section>
    <p class="muted small">Cene primerjam za enako količino: na 1 kg ali 1 l (ali količino, ki jo običajno kupiš), kjer to ni mogoče, pa na pakiranje. Vir so akcije in tvoje cene z računov; kjer v trgovini ni podatka, računam z najvišjo znano ceno postavke, zato so vsote ocena.</p>`}`;

  bindShopHeader(view);
  view.querySelector('#slAdd').addEventListener('submit', async e => {
    e.preventDefault();
    const t = e.target.t.value.trim().toLowerCase();
    if (!t || have.has(t)) return;
    await save({ items: [...c.items, { text: t }] });
  });
  view.querySelector('#slRunning')?.addEventListener('click', () => save({ items: [...c.items, ...running.map(text => ({ text }))] }));
  view.querySelector('#slClear')?.addEventListener('click', () => save({ items: [] }));
  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => save({ items: c.items.filter((_, i) => i !== Number(b.dataset.del)) })));
  view.querySelectorAll('[data-max]').forEach(b => b.addEventListener('click', () => save({ maxStores: Number(b.dataset.max) })));
  view.querySelector('#slExtra').addEventListener('change', e => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (Number.isFinite(v) && v >= 0) save({ extra: v });
  });
}
