// Nakupi → Izdelki: knjižnica izdelkov. Iskanje pokaže, kje je izdelek zdaj najceneje;
// shranjen izdelek združi različna imena v trgovinah (potrdiš ali zavrneš posamezno ime).

import { state, getSetting, saveSetting } from '../store.js';
import { productOffers, productSummary, searchCatalog, searchGroups, parseList, indexRows, newProduct, withPieceSize, packCount, verdict, isSeasonal } from '../catalog.js';
import { purchases } from '../pantry.js';
import { storeOf } from '../shoplist.js';
import { STORE_NAMES } from '../deals.js';
import { availableDeals, dealsStatus } from './deals.js';
import { shopHeader, bindShopHeader } from './shop-nav.js';
import { esc, money, plural, todayISO, toast, ask } from '../ui.js';
import { pushState, enablePush, syncAlert } from './push.js';

const INDEX_URL = 'https://raw.githubusercontent.com/jakobboro-wq/stroski/cene/index.json';
const ui = { query: '', rejected: false, more: false };

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

/** Izdelek, njegove ponudbe, povzetek in nasvet. */
function evaluate(product, src, today) {
  const offers = productOffers(product, src, today, { withRejected: true });
  const p = withPieceSize(product, offers.filter(o => o.status === 'yes' || o.status === 'auto'));
  const s = productSummary(p, offers, today);
  return { p, offers, s, v: verdict(p, s) };
}

/** »3 kosi 2,89 €«, ko se kupi več kosov skupaj; sicer prazno. */
function packText(r, s) {
  const n = s.ref && packCount(r, s.ref);
  return n > 1 ? `${plural(n, ['kos', 'kosa', 'kosi', 'kosov'])} ${money(r.price)}` : '';
}
const until = r => (r.upcoming ? `od ${fmtDay(r.f)}${r.to ? ` do ${fmtDay(r.to)}` : ''}` : r.to ? `do ${fmtDay(r.to)}` : 'konec ni objavljen');
const unitOf = (p, s) => (p.size ? '/kos' : s.ref && s.rows.some(r => r.qty) ? `/${s.ref.unit}` : '');

const SECTIONS = [
  ['buy', 'Kupi zdaj'],
  ['wait', 'Počakaj, kmalu bo ceneje'],
  ['high', 'V akciji, a ni najbolje'],
  ['none', 'Ni v akciji'],
  ['empty', 'Ni podatkov'],
];

function productCard({ p, s, v }) {
  const r = v === 'wait' ? s.soon : s.now;
  const unit = unitOf(p, s);
  let sub;
  if (r) {
    sub = [packText(r, s), until(r), r.plus ? 's kartico' : ''];
    if (v === 'wait' && s.now) sub.push(`zdaj ${money(s.now.eq)} ${store(s.now.s)}`);
    if (v === 'high') sub.push(p.target != null ? `tvoja meja ${money(p.target)}` : s.ever && `najnižje doslej ${money(s.ever.eq)}`);
    if (p.sell > 0) sub.push(`zaslužek ${money(p.sell - r.eq)}/kos`);
  } else {
    sub = [s.soon && `od ${fmtDay(s.soon.f)} ${store(s.soon.s)} ${money(s.soon.eq)}`, s.ever ? `najnižje doslej ${money(s.ever.eq)}${unit} (${store(s.ever.row.s)})` : 'v akcijah in na računih ga še ni bilo'];
  }
  return `
    <a class="pi-row ${v}" href="#/izdelki?p=${esc(p.id)}">
      <span class="pi-main"><span class="pi-name">${esc(p.name)}${p.size ? ` <span class="muted">${esc(p.size)}</span>` : ''}${p.alert ? ' <span title="Obvestila o akcijah">🔔</span>' : ''}</span>
      <span class="muted small">${esc(sub.filter(Boolean).join(' · '))}</span></span>
      ${r ? `<span class="pi-price"><b>${esc(money(r.eq))}<small>${esc(unit)}</small></b><span>${esc(store(r.s))}</span></span>` : ''}
    </a>`;
}

/** Svežina podatkov: opozori na trgovine, ki danes niso bile prebrane. */
function freshness() {
  const st = dealsStatus();
  if (!st.updatedAt) return '';
  const day = iso => fmtDay(new Date(iso).toLocaleDateString('sv-SE'));
  const stale = st.old.map(o => `${store(o.id)} (${o.at ? `podatki z dne ${day(o.at)}` : 'ni podatkov'})`);
  const late = Date.now() - new Date(st.updatedAt).getTime() > 2 * 86400e3;
  return `<p class="small ${stale.length || late || st.failed ? 'pi-warn' : 'muted'}">Osveženo ${esc(day(st.updatedAt))}${late ? ' (več kot dva dni staro)' : ''}${st.failed ? ' · brez povezave' : ''}${stale.length ? ` · ni prebrano: ${esc(stale.join(', '))}` : ''}</p>`;
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

/** Tabela ponudb: trgovina, cena na kos, pakiranje, velja do. */
function offerTable(rows, p, s) {
  const best = s.now?.key;
  return `<table class="pi-table"><thead><tr><th>Trgovina</th><th>Cena${esc(unitOf(p, s))}</th><th>Pakiranje</th><th>Velja</th></tr></thead><tbody>${rows.map(r => {
    const n = packCount(r, s.ref);
    return `<tr class="${r.upcoming ? 'later' : r.key === best ? 'best' : ''}">
      <td>${r.u ? `<a href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">${esc(store(r.s))} ↗</a>` : esc(store(r.s))}</td>
      <td><b>${esc(r.eq != null ? money(r.eq) : '?')}</b></td>
      <td>${esc(p.size && n > 1 ? `${n} × · ${money(r.price)}` : money(r.price))}${r.plus ? '<br><small>s kartico</small>' : ''}</td>
      <td>${esc(until(r))}</td></tr>`;
  }).join('')}</tbody></table>`;
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
      ${freshness()}
    </section>`;
  bindShopHeader(view);
  const out = view.querySelector('#catResults');

  const groupCard = (g, i) => `
    <div class="cat-group">
      <div class="cat-group-head"><b>${esc(g.title)}</b>${g.product.size ? ` <span class="muted">${esc(g.product.size)}</span>` : ''}<button class="btn small" data-save="${i}">Shrani</button></div>
      <div class="small">${summaryLine(g.summary)}</div>
      ${g.summary.now && g.summary.soon && g.summary.soon.eq < g.summary.now.eq ? `<div class="small">Kmalu ceneje: <b>${esc(store(g.summary.soon.s))} ${esc(money(g.summary.soon.eq))}</b> ${esc(until(g.summary.soon))}</div>` : ''}
    </div>`;

  const draw = () => {
    const q = ui.query.trim();
    const mine = searchCatalog(products(), q).map(p => evaluate(p, src, today));
    const price = x => (x.v === 'wait' ? x.s.soon : x.s.now)?.eq ?? Infinity;
    let html = mine.length
      ? SECTIONS.map(([v, title]) => {
        const list = mine.filter(x => x.v === v).sort((a, b) => price(a) - price(b) || a.p.name.localeCompare(b.p.name, 'sl'));
        return list.length ? `<h3 class="pi-h ${v}">${title}</h3>${list.map(productCard).join('')}` : '';
      }).join('')
      : q ? '' : '<p class="muted small">Še nimaš shranjenih izdelkov. Poišči izdelek, npr. »kinder bueno«, in ga shrani.</p>';
    let groups = [];
    if (q.length >= 2) {
      groups = searchGroups(q, src, today);
      const cards = groups.map((g, i) => ({ g, html: groupCard(g, i) }));
      const usual = cards.filter(c => !isSeasonal(c.g.variant)), seasonal = cards.filter(c => isSeasonal(c.g.variant));
      html += groups.length
        ? `<h3 class="cat-h">V trgovinah</h3>${usual.map(c => c.html).join('')}${seasonal.length ? `<details><summary class="muted small">Koledarji in praznična pakiranja (${seasonal.length})</summary>${seasonal.map(c => c.html).join('')}</details>` : ''}`
        : `<p class="muted small">Ni zadetkov v akcijah, zgodovini ali na tvojih računih. Poskusi z manj besedami, ali pa izdelek vseeno shrani in vklopi 🔔, da izveš, ko bo v akciji.</p><button class="btn small" id="saveEmpty">Shrani »${esc(q)}«</button>`;
    }
    out.innerHTML = html;
    const saveNew = async product => {
      const p = { ...product, id: `p${Date.now().toString(36)}` };
      await saveProducts([...products(), p]);
      ui.query = '';
      location.hash = `#/izdelki?p=${p.id}`;
    };
    out.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => saveNew(groups[Number(b.dataset.save)].product)));
    out.querySelector('#saveEmpty')?.addEventListener('click', () => saveNew(newProduct(q)));
  };
  draw();
  let timer;
  view.querySelector('#catQuery').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.query = e.target.value; draw(); }, 200);
  });
}

function renderProduct(view, product, src, today) {
  const { p: shown, offers, s, v } = evaluate(product, src, today);
  const rejected = offers.filter(o => o.status === 'no' || o.status === 'off');
  const deals = s.rows.filter(r => r.source === 'deal');
  const past = s.rows.filter(r => r.source !== 'deal');
  const ref = forRef(s);
  const unit = unitOf(shown, s);
  const top = v === 'wait' ? s.soon : s.now;
  const facts = [
    s.ever && `najnižje doslej ${money(s.ever.eq)}${unit} (${store(s.ever.row.s)}${s.ever.date ? `, ${fmtDay(s.ever.date)}` : ''})`,
    s.regular != null && `redna cena ${money(s.regular)}${unit}`,
    s.next && `naslednja akcija ~${fmtDay(s.next.next)} (${store(s.next.s)}, napoved)`,
  ].filter(Boolean);
  const profit = top && product.sell > 0 ? ` · zaslužek ${money(product.sell - top.eq)}/kos` : '';
  const num = x => (x != null ? esc(String(x).replace('.', ',')) : '');

  view.innerHTML = `
    ${shopHeader('izdelki')}
    <a class="cat-back" href="#/izdelki">‹ Moji izdelki</a>
    <section class="card">
      <div class="card-head"><h2>${esc(product.name)}${shown.size ? ` <span class="muted">${esc(shown.size)}</span>` : ''}</h2></div>
      <p class="pi-verdict ${v}"><b>${SECTIONS.find(x => x[0] === v)[1]}</b>${top ? `<br>${esc(store(top.s))} ${esc(money(top.eq))}${esc(unit)} · ${esc(until(top))}${esc(profit)}` : ''}</p>
      ${deals.length ? offerTable(deals, shown, s) : ''}
      ${facts.length ? `<p class="muted small">${esc(facts.join(' · '))}</p>` : ''}
      ${freshness()}
    </section>

    <section class="card cat-alert">
      <label class="cat-check"><input type="checkbox" id="catAlert"${product.alert ? ' checked' : ''}> <b>🔔 Obvesti me o akcijah</b></label>
      <div class="row2">
        <label class="field">Kupim največ po (€${esc(ref)})<input id="catTarget" inputmode="decimal" placeholder="neobvezno" value="${num(product.target)}"></label>
        <label class="field">Prodajam po (€/kos)<input id="catSell" inputmode="decimal" placeholder="neobvezno" value="${num(product.sell)}"></label>
      </div>
      ${product.alert ? '<div class="cat-device"><span id="pushStatus" class="muted small">Preverjam napravo …</span><button type="button" class="btn small primary" id="pushOn" hidden>Vklopi obvestila na tej napravi</button></div>' : ''}
    </section>

    <details class="card" id="catMore"${ui.more ? ' open' : ''}><summary>Več: zgodovina, popravki, nastavitve</summary>
      ${deals.length ? `<h3 class="cat-h">Prepoznane akcije</h3>${deals.map(r => offerRow(r, s, today, true)).join('')}` : ''}
      ${past.length ? `<h3 class="cat-h">Prejšnje akcije in tvoji nakupi</h3>${past.map(r => offerRow(r, s, today, true)).join('')}` : ''}
      ${rejected.length ? `<button type="button" class="btn ghost small" id="catRejected">${ui.rejected ? 'Skrij' : 'Pokaži'} druge različice in izločene (${rejected.length})</button>
        ${ui.rejected ? rejected.map(r => offerRow({ ...r, eq: null }, s, today, true)).join('') : ''}` : ''}
      <h3 class="cat-h">Kaj je ta izdelek</h3>
      <form id="catForm" class="cat-form">
        <label class="field">Ime<input name="name" value="${esc(product.name)}" required></label>
        <label class="field">Velikost (za primerjavo cen)<input name="size" value="${esc(product.size ?? '')}" placeholder="npr. 43 g ali 0,5 l"></label>
        <label class="field">Iskalna imena, ločena z vejico<input name="terms" value="${esc((product.terms ?? []).join(', '))}" placeholder="kinder bueno, kind bueno"><span class="muted small">Ime ustreza, če vsebuje vse besede enega od teh imen (tudi začetke: »kind« najde »kinder«). Dodaj okrajšave z računov.</span></label>
        <label class="field">Različica<input name="variant" value="${esc((product.variant ?? []).join(' '))}" placeholder="prazno = osnovni izdelek, npr. white"><span class="muted small">Besede, ki so v imenu poleg iskalnih (okus, »mini«). Prazno pomeni osnovni izdelek. Velikost in vrsta (vafelj, čokolada) ne štejeta.</span></label>
        <label class="field">Vedno izloči imena z besedami<input name="not" value="${esc((product.not ?? []).join(', '))}" placeholder="bel, white, mini"></label>
        <div class="cat-actions"><button class="btn primary">Shrani</button><button type="button" class="btn ghost danger" id="catDelete">Odstrani izdelek</button></div>
      </form>
      ${historyNote()}
    </details>`;
  bindShopHeader(view);

  // Izdelek z zvoncem se uskladi tudi z oblakom, da ga dnevni workflow pozna.
  const update = async changes => {
    const next = { ...product, ...changes };
    await saveProducts(products().map(p => (p.id === product.id ? next : p)));
    if (next.alert || product.alert) syncAlert(next).catch(err => toast(err.message));
  };
  view.querySelector('#catAlert').addEventListener('change', e => update({ alert: e.target.checked }));
  for (const [sel, key] of [['#catTarget', 'target'], ['#catSell', 'sell']]) {
    view.querySelector(sel).addEventListener('change', e => {
      const n = Number(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
      update({ [key]: n > 0 ? n : null });
    });
  }
  view.querySelector('#catMore').addEventListener('toggle', e => { ui.more = e.target.open; });
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
