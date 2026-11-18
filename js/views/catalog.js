// Nakupi → Izdelki: knjižnica izdelkov. Iskanje pokaže, kje je izdelek zdaj najceneje;
// shranjen izdelek združi različna imena v trgovinah (potrdiš ali zavrneš posamezno ime).

import { state, getSetting, saveSetting } from '../store.js';
import { productOffers, productSummary, searchCatalog, searchGroups, parseList, indexRows } from '../catalog.js';
import { purchases } from '../pantry.js';
import { storeOf } from '../shoplist.js';
import { STORE_NAMES } from '../deals.js';
import { availableDeals } from './deals.js';
import { shopHeader, bindShopHeader } from './shop-nav.js';
import { esc, money, todayISO, toast, ask } from '../ui.js';
import { pushState, enablePush, syncAlert } from './push.js';

const INDEX_URL = 'https://raw.githubusercontent.com/jakobboro-wq/stroski/cene/index.json';
const ui = { query: '', rejected: false };

// Zgodovina akcij (vsi izdelki) z veje »cene«: naloži se ob prvem odprtju, hrani se samo v pomnilniku.
let index = { since: null, rows: [] };
let indexLoading = null;
function loadIndex(onFresh) {
  indexLoading ??= fetch(INDEX_URL, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then(json => { index = { since: json.since, rows: indexRows(json) }; onFresh(); })
    .catch(err => console.warn('Zgodovina izdelkov', err));
  return index;
}

// Starejši izdelki nimajo različice: veljajo kot osnovni izdelek (brez dodatnih besed).
const products = () => (getSetting('catalog', { products: [] }).products ?? []).map(p => ({ ...p, variant: p.variant ?? [] }));
const saveProducts = list => saveSetting({ id: 'catalog', products: list });
const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };
const store = s => STORE_NAMES[s] ?? s;
const sizeLabel = ref => (!ref ? '' : ref.qty < 1 ? `${Math.round(ref.qty * 1000)} ${ref.unit === 'kg' ? 'g' : 'ml'}` : `${String(Math.round(ref.qty * 100) / 100).replace('.', ',')} ${ref.unit}`);
const forRef = s => (s.ref ? ` za ${sizeLabel(s.ref)}` : '');

function sources(today, rerender) {
  return {
    deals: availableDeals(today, rerender),
    index: loadIndex(rerender).rows,
    purchases: purchases(state.transactions),
    storeOf,
  };
}

/** Ena vrstica povzetka: zdaj najceneje ali najceneje doslej. */
function summaryLine(s) {
  if (s.now) return `Zdaj najceneje: <b>${esc(store(s.now.s))} ${esc(money(s.now.eq))}</b>${esc(forRef(s))}${s.now.to ? ` · do ${esc(fmtDay(s.now.to))}` : ''}`;
  const parts = ['Zdaj ni v akciji'];
  if (s.ever) parts.push(`najceneje doslej ${money(s.ever.eq)} (${store(s.ever.row.s)})`);
  if (s.soon) parts.push(`od ${fmtDay(s.soon.f)} v akciji v: ${store(s.soon.s)}`);
  return esc(parts.join(' · '));
}

function productCard(p, s) {
  return `
    <a class="cat-item" href="#/izdelki?p=${esc(p.id)}">
      <span class="cat-name">${p.alert ? '<span title="Obvestila o akcijah">🔔</span> ' : ''}${esc(p.name)}${p.size ? ` <span class="muted">${esc(p.size)}</span>` : ''}</span>
      <span class="muted small">${summaryLine(s)}</span>
    </a>`;
}

function sourceText(r, today) {
  if (r.source === 'deal') {
    const when = r.upcoming ? `akcija od ${fmtDay(r.f)}` : r.to ? `akcija do ${fmtDay(r.to)}` : 'akcija';
    return [when, r.d ? `−${r.d} %` : null, r.plus ? 's kartico' : null].filter(Boolean).join(' · ');
  }
  if (r.source === 'hist') return `zadnja akcija ${fmtDay(r.end)}${r.next ? ` · naslednja ~${fmtDay(r.next)}` : ''}`;
  return `tvoj nakup ${fmtDay(r.date)}`;
}

function offerRow(r, s, today, editable) {
  const pack = r.qty && s.ref && Math.abs(r.qty - s.ref.qty) > 0.0005 ? ` · ${money(r.price)} za pakiranje` : '';
  const unit = r.up != null && r.uu ? ` · ${money(r.up)}/${r.uu}` : '';
  const name = r.u ? `<a href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">${esc(r.n)}</a>` : esc(r.n);
  const btn = (v, text, title) => `<button type="button" class="cat-undo muted small" data-link="${esc(r.key)}" data-v="${v}" title="${title}">${text}</button>`;
  const buttons = !editable ? '' : {
    auto: btn('0', '✗ ni isto', 'To ni ta izdelek'),
    off: btn('1', '+ je isto', 'To je ta izdelek'),
    yes: btn('', 'dodano ročno · razveljavi', 'Prepusti odločitev aplikaciji'),
    no: btn('', 'izločeno ročno · razveljavi', 'Prepusti odločitev aplikaciji'),
  }[r.status];
  return `
    <div class="cat-offer ${r.source}${r.upcoming ? ' later' : ''}${r.status === 'no' || r.status === 'off' ? ' no' : ''}">
      <div class="cat-offer-main">
        <div><b>${esc(store(r.s))}</b> · ${name}</div>
        <div class="muted small">${esc(sourceText(r, today))}${esc(pack)}${esc(unit)}</div>
      </div>
      <div class="cat-offer-price"><b>${r.eq != null ? esc(money(r.eq)) : esc(money(r.price))}</b>${r.eqLo != null && r.eqLo < (r.eq ?? Infinity) - 0.005 ? `<small>najmanj ${esc(money(r.eqLo))}</small>` : ''}</div>
      ${buttons}
    </div>`;
}

function offersList(rows, s, today, editable) {
  const groups = [
    ['Zdaj v akciji', rows.filter(r => r.source === 'deal')],
    ['Tvoje cene z računov', rows.filter(r => r.source === 'mine')],
    ['Bilo v akciji', rows.filter(r => r.source === 'hist')],
  ].filter(([, list]) => list.length);
  return groups.map(([title, list]) => `<h3 class="cat-h">${title}</h3>${list.map(r => offerRow(r, s, today, editable)).join('')}`).join('');
}

function historyNote() {
  return `<p class="muted small">Trgovine objavljajo samo akcije, zato so redne cene znane le iz prečrtanih cen in tvojih računov. ${index.since ? `Zgodovina akcij se zbira od ${esc(fmtDay(index.since))}, zato bo »najceneje doslej« vsak teden bolj zanesljivo.` : ''} Cene so preračunane na isto velikost, da se primerja pakiranje z več kosi.</p>`;
}

export function renderCatalog(view, params = new URLSearchParams()) {
  const today = todayISO();
  const rerender = () => { if (location.hash.startsWith('#/izdelki')) renderCatalog(view, new URLSearchParams(location.hash.split('?')[1])); };
  const src = sources(today, rerender);
  const id = params.get('p');
  const product = id && products().find(p => p.id === id);
  if (product) return renderProduct(view, product, src, today);

  view.innerHTML = `
    ${shopHeader('izdelki')}
    <section class="card">
      <input type="search" id="catQuery" class="deal-search" placeholder="Poišči izdelek, npr. kinder bueno 43 g" value="${esc(ui.query)}" autocomplete="off" aria-label="Poišči izdelek">
      <div id="catResults"></div>
    </section>
    ${historyNote()}`;
  bindShopHeader(view);
  const out = view.querySelector('#catResults');

  const draw = () => {
    const q = ui.query.trim();
    const list = searchCatalog(products(), q);
    const mine = list.map(p => ({ p, s: productSummary(p, productOffers(p, src, today), today) }));
    let html = mine.length
      ? `<div class="cat-list">${mine.map(x => productCard(x.p, x.s)).join('')}</div>`
      : q ? '' : '<p class="muted small">Še nimaš shranjenih izdelkov. Poišči izdelek (npr. »kinder bueno 43 g«) in ga shrani. Imena iz različnih trgovin potem združiš pod en izdelek.</p>';
    let groups = [];
    if (q.length >= 2) {
      groups = searchGroups(q, src, today);
      html += groups.length
        ? `<h3 class="cat-h">V trgovinah${groups.length > 1 ? ' (po izdelkih)' : ''}</h3>${groups.map((g, i) => `
          <div class="cat-group">
            <div class="cat-group-head"><b>${esc(g.title)}</b>${g.product.size ? ` <span class="muted">${esc(g.product.size)}</span>` : ''}<button class="btn small" data-save="${i}">Shrani</button></div>
            <div class="small">${summaryLine(g.summary)}</div>
            ${g.summary.stores.length ? `<div class="cat-stores">${g.summary.stores.slice(0, 5).map((r, j) => `<span class="cat-store${j === 0 ? ' best' : ''}">${esc(store(r.s))} <b>${esc(money(r.eq))}</b></span>`).join('')}</div>` : ''}
          </div>`).join('')}
          <p class="muted small">Isti izdelek z različnimi imeni v trgovinah je združen samodejno; različice (npr. bel, mini, koledar) so ločene.</p>`
        : '<p class="muted small">Ni zadetkov v akcijah, zgodovini ali na tvojih računih. Poskusi z manj besedami.</p>';
    }
    out.innerHTML = html;
    out.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', async () => {
      const { product } = groups[Number(b.dataset.save)];
      const p = { ...product, id: `p${Date.now().toString(36)}` };
      await saveProducts([...products(), p]);
      ui.query = '';
      location.hash = `#/izdelki?p=${p.id}`;
    }));
  };
  draw();
  let timer;
  view.querySelector('#catQuery').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.query = e.target.value; draw(); }, 200);
  });
}

function renderProduct(view, product, src, today) {
  const offers = productOffers(product, src, today, { withRejected: true });
  const s = productSummary(product, offers, today);
  const rejected = offers.filter(o => o.status === 'no' || o.status === 'off');
  const ref = forRef(s);
  const tiles = [
    s.ever && ['Najceneje doslej', money(s.ever.eq), `${store(s.ever.row.s)}${s.ever.date ? `, ${fmtDay(s.ever.date)}` : ''}`],
    s.regular != null && ['Redna cena', money(s.regular), 'najvišja znana'],
    s.soon ? ['Prihodnja akcija', money(s.soon.eq), `${store(s.soon.s)} od ${fmtDay(s.soon.f)}`]
      : s.next && ['Naslednja akcija', `~${fmtDay(s.next.next)}`, `${store(s.next.s)}, napoved iz zgodovine`],
  ].filter(Boolean);

  view.innerHTML = `
    ${shopHeader('izdelki')}
    <a class="cat-back" href="#/izdelki">‹ Vsi izdelki</a>
    <section class="card">
      <div class="card-head"><h2>${esc(product.name)}${product.size ? ` <span class="muted">${esc(product.size)}</span>` : ''}</h2></div>
      ${s.now ? `
        <div class="cat-hero">
          <span class="muted small">Zdaj najceneje${esc(ref)}</span>
          <span class="cat-hero-price">${esc(money(s.now.eq))}</span>
          <span><b>${esc(store(s.now.s))}</b> · ${esc(s.now.n)}${s.now.qty && s.ref && Math.abs(s.now.qty - s.ref.qty) > 0.0005 ? ` · ${esc(money(s.now.price))} za pakiranje` : ''}${s.now.to ? ` · do ${esc(fmtDay(s.now.to))}` : ''}${s.now.plus ? ' · s kartico' : ''}</span>
        </div>` : `<p>${summaryLine(s)}</p>`}
      ${tiles.length ? `<div class="cat-tiles">${tiles.map(([k, v, sub]) => `<div class="tile"><div class="tile-label">${esc(k)}${esc(ref)}</div><div class="tile-value">${esc(v)}</div><div class="muted small">${esc(sub)}</div></div>`).join('')}</div>` : ''}
      ${s.stores.length > 1 ? `<h3 class="cat-h">Po trgovinah${esc(ref)}</h3><div class="cat-stores">${s.stores.map((r, i) => `<span class="cat-store${i === 0 ? ' best' : ''}">${esc(store(r.s))} <b>${esc(money(r.eq))}</b>${r.source === 'mine' ? ' <small>(tvoj nakup)</small>' : ''}</span>`).join('')}</div>` : ''}
    </section>

    <section class="card cat-alert">
      <label class="cat-check"><input type="checkbox" id="catAlert"${product.alert ? ' checked' : ''}> <span><b>🔔 Obvesti me o akcijah</b><br><span class="muted small">Obvestilo na telefon, ko je ta izdelek v akciji ali se akcija še poceni (preverja enkrat na dan, okoli poldneva).</span></span></label>
      ${product.alert ? `<label class="field">Samo, ko je cena${esc(ref)} največ (neobvezno)<input id="catTarget" inputmode="decimal" placeholder="npr. 0,90" value="${product.target != null ? esc(String(product.target).replace('.', ',')) : ''}"></label>
      <div class="cat-device"><span id="pushStatus" class="muted small">Preverjam napravo …</span><button type="button" class="btn small primary" id="pushOn" hidden>Vklopi obvestila na tej napravi</button></div>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>Ponudbe</h2><span class="muted small">prepoznano samodejno</span></div>
      ${s.rows.length ? offersList(s.rows, s, today, true) : '<p class="muted small">Ta hip ni nobene ponudbe. Preveri iskalna imena spodaj.</p>'}
      ${rejected.length ? `<button type="button" class="btn ghost small" id="catRejected">${ui.rejected ? 'Skrij' : 'Pokaži'} druge različice in izločene (${rejected.length})</button>
        ${ui.rejected ? rejected.map(r => offerRow({ ...r, eq: null }, s, today, true)).join('') : ''}` : ''}
    </section>

    <section class="card">
      <h2>Kaj je ta izdelek</h2>
      <form id="catForm" class="cat-form">
        <label class="field">Ime<input name="name" value="${esc(product.name)}" required></label>
        <label class="field">Velikost (za primerjavo cen)<input name="size" value="${esc(product.size ?? '')}" placeholder="npr. 43 g ali 0,5 l"></label>
        <label class="field">Iskalna imena, ločena z vejico<input name="terms" value="${esc((product.terms ?? []).join(', '))}" placeholder="kinder bueno, kind bueno"><span class="muted small">Ime ustreza, če vsebuje vse besede enega od teh imen (tudi začetke: »kind« najde »kinder«). Dodaj okrajšave z računov.</span></label>
        <label class="field">Različica<input name="variant" value="${esc((product.variant ?? []).join(' '))}" placeholder="prazno = osnovni izdelek, npr. white"><span class="muted small">Besede, ki so v imenu poleg iskalnih (okus, »mini«). Prazno pomeni osnovni izdelek. Velikost in vrsta (vafelj, čokolada) ne štejeta.</span></label>
        <label class="field">Vedno izloči imena z besedami<input name="not" value="${esc((product.not ?? []).join(', '))}" placeholder="bel, white, mini"></label>
        <div class="cat-actions"><button class="btn primary">Shrani</button><button type="button" class="btn ghost danger" id="catDelete">Odstrani izdelek</button></div>
      </form>
    </section>
    ${historyNote()}`;
  bindShopHeader(view);

  // Izdelek z zvoncem se uskladi tudi z oblakom, da ga dnevni workflow pozna.
  const update = async changes => {
    const next = { ...product, ...changes };
    await saveProducts(products().map(p => (p.id === product.id ? next : p)));
    if (next.alert || product.alert) syncAlert(next).catch(err => toast(err.message));
  };
  view.querySelector('#catAlert').addEventListener('change', e => update({ alert: e.target.checked }));
  view.querySelector('#catTarget')?.addEventListener('change', e => {
    const v = Number(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
    update({ target: e.target.value.trim() && v > 0 ? v : null });
  });
  const status = view.querySelector('#pushStatus');
  if (status) {
    const btn = view.querySelector('#pushOn');
    const show = st => {
      status.textContent = {
        on: '✓ Ta naprava prejema obvestila.',
        off: 'Ta naprava še ne prejema obvestil.',
        denied: 'Obvestila so za to aplikacijo blokirana. Dovoli jih v nastavitvah telefona ali brskalnika.',
        install: 'Na iPhonu najprej dodaj aplikacijo na začetni zaslon (Deli → Dodaj na začetni zaslon) in jo odpri od tam.',
        unsupported: 'Ta brskalnik ne podpira obvestil.',
      }[st];
      btn.hidden = st !== 'off';
    };
    pushState().then(show).catch(() => show('unsupported'));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { show(await enablePush()); syncAlert({ ...product, alert: true }).catch(() => {}); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
    });
  }
  view.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => {
    const links = { ...product.links };
    if (b.dataset.v === '') delete links[b.dataset.link];
    else links[b.dataset.link] = b.dataset.v === '1';
    update({ links });
  }));
  view.querySelector('#catRejected')?.addEventListener('click', () => { ui.rejected = !ui.rejected; renderProduct(view, product, src, today); });
  view.querySelector('#catForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const terms = parseList(f.terms.value);
    if (!terms.length) { toast('Vpiši vsaj eno iskalno ime.'); return; }
    await update({ name: f.name.value.trim(), size: f.size.value.trim(), terms, variant: f.variant.value.toLowerCase().split(/[\s,]+/).filter(Boolean), not: parseList(f.not.value) });
    toast('Shranjeno');
  });
  view.querySelector('#catDelete').addEventListener('click', async () => {
    if (!(await ask(`Odstranim izdelek »${product.name}« iz knjižnice? Akcij in računov to ne spremeni.`, { yes: 'Odstrani', danger: true }))) return;
    await saveProducts(products().filter(p => p.id !== product.id));
    if (product.alert) syncAlert({ ...product, alert: false }).catch(() => {});
    location.hash = '#/izdelki';
  });
}
