// Knjižnica izdelkov: en izdelek (npr. Kinder Bueno 43 g) združi različna imena v trgovinah in na računih.
// Za vsak izdelek zbere ponudbe (zdajšnje akcije, zgodovino akcij, tvoje cene z računov) in pove,
// kje je zdaj najceneje in kakšna je najnižja znana cena. Brez brskalnika, da se da preizkusiti.
//
// Ujemanje: ime ustreza izdelku, če vsebuje vse besede vsaj enega od imen (»kinder bueno«, »kind bueno«)
// in nobene od izključenih besed. Med takimi imeni aplikacija sama prepozna isti izdelek (ista različica
// in združljiva velikost, glej variantOf); ročna potrditev ali zavrnitev imena ima prednost.

import { norm, packSize } from './products.js';

const round2 = v => Math.round(v * 100) / 100;
const words = text => norm(text).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean);
const wordCache = new Map();
const wordsOf = text => {
  let w = wordCache.get(text);
  if (!w) { w = words(text); if (wordCache.size > 50000) wordCache.clear(); wordCache.set(text, w); }
  return w;
};

/** Ključ imena v trgovini: »tus|vafelj kinder bueno, 3 x 43 g«. */
export const offerKey = (store, name) => `${store}|${norm(name)}`;

/** Ali ime ustreza izdelku (iskalnim imenom in izključenim besedam). */
export function nameMatches(product, name) {
  const w = wordsOf(name);
  const has = part => w.some(x => x.startsWith(part));
  if ((product.not ?? []).some(n => words(n).length && words(n).every(has))) return false;
  return (product.terms ?? []).some(t => { const q = words(t); return q.length > 0 && q.every(has); });
}

// ---------- Samodejno prepoznavanje istega izdelka ----------
// Iz imena v trgovini odstranimo iskalne besede, velikost, števila in splošne besede, ki jih trgovine
// dodajo pred ime (»Vafelj Kinder Bueno« in »Čokolada Kinder Bueno« sta isto). Kar ostane, je različica
// (»bel«, »mini«, »koledar«). Besede primerjamo po prvih štirih črkah, da sklon ne moti (lešnik/lešniki).
const stem = w => (w.length > 4 ? w.slice(0, 4) : w);
// Angleška imena na embalaži → slovenska osnova.
const SYN = Object.fromEntries(Object.entries({
  bel: 'white blanc weiss bianco bela beli belo',
  temn: 'dark noir temna temni temno',
  mlec: 'milk milch latte',
  lesn: 'hazelnut haselnuss nocciola hazelnuts',
  jago: 'strawberry erdbeer',
  mand: 'almond almonds',
  kara: 'caramel karamel',
  koko: 'coconut',
  vani: 'vanilla',
  pome: 'orange pomaranca',
  cesn: 'cherry',
  zero: 'sugarfree light',
}).flatMap(([to, from]) => from.split(' ').map(f => [f, to])));
// Splošne besede: vrsta izdelka, embalaža, oznake trgovine. Ne ločijo izdelkov med seboj.
const GENERIC = new Set(`vafelj vaflji cokolada cokoladni cokoladna cokoladica ploscica ploscice desert piskot piskoti keksi bonboni
  bombon bomboni mlecna mlecni mlecno napitek pijaca pijace gazirana gazirani osvezilna sok bonbon izdelek
  energijski energijska energijsko namaz kremni
  kos kosov kom pakiranje paket multipack pack x novo akcija original classic klasicni klasik okus z s in iz za the of and
  tus lidl hofer mercator eurospin spar`.split(/\s+/).filter(Boolean).map(w => SYN[w] ?? stem(w)));
const canon = w => SYN[w] ?? stem(w);

/** Različica imena glede na iskalna imena: urejen seznam besed, ki ostanejo (prazen = osnovni izdelek). */
export function variantOf(terms, name) {
  const q = [...new Set((terms ?? []).flatMap(words))];
  const out = new Set();
  const all = wordsOf(name);
  // »brez sladkorja« je isto kot »zero«
  const sugarFree = all.includes('brez') && all.some(w => w.startsWith('sladk'));
  if (sugarFree) out.add('zero');
  for (const w of all) {
    if (/\d/.test(w) || w.length < 2) continue;
    if (sugarFree && (w === 'brez' || w.startsWith('sladk'))) continue;
    if (q.some(t => w.startsWith(t) || t.startsWith(w))) continue;
    const c = canon(w);
    if (GENERIC.has(c) || UNITS.has(w)) continue;
    out.add(c);
  }
  return [...out].sort();
}
const UNITS = new Set(['g', 'kg', 'dag', 'ml', 'cl', 'dl', 'l', 'x']);
/** Različica, ki jo je vpisal uporabnik (besede, npr. »white«), v primerljivi obliki. */
export const variantKey = list => [...new Set((list ?? []).flatMap(words).map(canon))].sort().join(' ');

/** Velikost se ujema, če je pakiranje celo število kosov velikosti izdelka (43 g, 3 × 43 g). Neznana velikost se ujema. */
export function sizeFits(size, qty, unit) {
  if (!size || !qty) return true;
  if (unit && unit !== size.unit) return false;
  const k = qty / size.qty;
  return k >= 0.98 && Math.abs(k - Math.round(k)) <= 0.03 * Math.round(k);
}

/** Nov izdelek iz iskanja: ime in velikost iz besedila (»kinder bueno 43 g«). */
export function newProduct(query, id = `p${Date.now().toString(36)}`) {
  const size = packSize(query);
  const name = query.replace(/\d+(?:[.,]\d+)?\s?(kg|dag|g|ml|cl|dl|l)\b/i, '').replace(/\s+/g, ' ').trim();
  return { id, name: name ? name[0].toUpperCase() + name.slice(1) : query, size: size ? query.match(/\d+(?:[.,]\d+)?\s?(kg|dag|g|ml|cl|dl|l)\b/i)[0] : '', terms: [name.toLowerCase() || query.toLowerCase()], variant: [], not: [], links: {} };
}

/** index.json z veje »cene« → vrstice kot predmeti. */
export function indexRows(json) {
  if (!json?.cols || !Array.isArray(json.rows)) return [];
  return json.rows.map(r => Object.fromEntries(json.cols.map((c, i) => [c, r[i]])));
}

/** Velikost pakiranja (kg ali l) iz cene na enoto ali iz besedila. */
function qtyOf(price, up, uu, ...texts) {
  if (up > 0 && uu) return { qty: price / up, unit: uu };
  for (const t of texts) { const s = packSize(t); if (s) return s; }
  return null;
}

/**
 * Vse ponudbe za izdelek: [{ key, s, n, source: 'deal'|'hist'|'mine', price, qty, uu, status, ... }].
 * - deal: zdajšnja akcija (to, f, d, o, plus, u), z zgodovino istega imena (lo, lod, reg, cy, next)
 * - hist: ime, ki je bilo v akciji (zadnja cena lp kot price, end = zadnji dan)
 * - mine: tvoja zadnja cena v trgovini (date), iz računov
 * status: 'yes' (potrdil si), 'auto' (samodejno prepoznan), 'no' (zavrnil si), 'off' (samodejno izločen:
 * druga različica ali velikost); 'no' in 'off' sta vrnjena samo z withRejected.
 * Vsaka ponudba ima tudi variant (ključ različice) in fits (velikost se ujema).
 * product.variant === undefined: brez samodejnega izločanja (za iskanje, ki ponudbe šele razvrsti v skupine).
 * sources: { deals, index (indexRows), purchases (pantry.purchases), storeOf }
 */
export function productOffers(product, { deals = [], index = [], purchases = [], storeOf = () => null }, today, { withRejected = false } = {}) {
  const links = product.links ?? {};
  const want = product.variant === undefined ? null : variantKey(product.variant);
  const size = packSize(product.size);
  const out = [];
  const seen = new Set();
  const push = o => {
    o.variant = variantOf(product.terms, o.n).join(' ');
    o.fits = sizeFits(size, o.qty, o.uu);
    o.status = links[o.key] === true ? 'yes' : links[o.key] === false ? 'no' : want == null || (o.variant === want && o.fits) ? 'auto' : 'off';
    if (withRejected || o.status === 'yes' || o.status === 'auto') out.push(o);
  };
  const hist = new Map();
  for (const r of index) {
    if (!nameMatches(product, r.n)) continue;
    hist.set(offerKey(r.s, r.n), r);
  }
  const best = new Map();
  for (const d of deals) {
    if (!(d.p > 0) || (d.to && d.to < today) || !nameMatches(product, d.n)) continue;
    const key = offerKey(d.s, d.n);
    if (!best.has(key) || d.p < best.get(key).p) best.set(key, d);
  }
  for (const [key, d] of best) {
    seen.add(key);
    const h = hist.get(key);
    const sz = qtyOf(d.p, d.up, d.uu, d.q, d.n);
    push({
      key, s: d.s, n: d.n, source: 'deal', price: d.p, qty: sz?.qty ?? null, uu: sz?.unit ?? null,
      to: d.to ?? null, f: d.f ?? null, upcoming: !!d.f && d.f > today, d: d.d ?? null, o: d.o ?? null, plus: !!d.plus, u: d.u ?? null,
      lo: Math.min(d.p, h?.lo ?? Infinity, d.lo ?? Infinity), lod: h?.lod ?? null, reg: d.o ?? h?.reg ?? null, cy: h?.cy ?? d.cy ?? null,
    });
  }
  for (const [key, h] of hist) {
    if (seen.has(key)) continue;
    const sz = h.k > 0 ? { qty: h.k, unit: h.uu } : packSize(h.n);
    push({
      key, s: h.s, n: h.n, source: 'hist', price: h.lp, qty: sz?.qty ?? null, uu: sz?.unit ?? null,
      end: h.end, lo: h.lo, lod: h.lod, reg: h.reg, cy: h.cy, next: h.next && h.next > today ? h.next : null,
    });
  }
  const mine = new Map();
  for (const p of purchases) {
    const store = storeOf(p.store);
    if (!store || !nameMatches(product, p.name)) continue;
    const key = `mine:${offerKey(store, p.name)}`;
    const prev = mine.get(key);
    if (!prev || p.date >= prev.date) mine.set(key, { ...p, store, lo: Math.min(p.unit, prev?.lo ?? Infinity) });
    else prev.lo = Math.min(prev.lo, p.unit);
  }
  for (const [key, p] of mine) {
    const sz = p.kg ? { qty: p.kg / p.qty, unit: 'kg' } : packSize(p.name);
    push({ key, s: p.store, n: p.name, source: 'mine', price: p.unit, qty: sz?.qty ?? null, uu: sz?.unit ?? null, date: p.date, lo: p.lo });
  }
  return out;
}

/** Referenčna velikost za primerjavo: velikost izdelka, sicer 1 kg ali 1 l (prevladujoča enota med ponudbami). */
export function referenceSize(product, offers) {
  const own = packSize(product.size);
  if (own) return own;
  const c = {};
  for (const o of offers) if (o.qty && o.uu) c[o.uu] = (c[o.uu] ?? 0) + 1;
  const unit = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
  return unit ? { qty: 1, unit } : null;
}

/** Cena, preračunana na referenčno velikost (npr. za en 43 g Bueno). Brez velikosti: cena pakiranja. */
export function perRef(price, offer, ref) {
  if (price == null || !Number.isFinite(price)) return null;
  if (!ref || !offer.qty) return round2(price);
  if (offer.uu !== ref.unit) return null;
  return round2((price / offer.qty) * ref.qty);
}

/**
 * Povzetek izdelka: kje je zdaj najceneje, najnižja znana cena, redna cena in napoved naslednje akcije.
 * Vse cene so preračunane na referenčno velikost (eq). Vrne tudi razvrščene ponudbe.
 */
export function productSummary(product, offers, today) {
  const ref = referenceSize(product, offers);
  const rows = offers.filter(o => o.status === 'yes' || o.status === 'auto').map(o => ({
    ...o,
    eq: perRef(o.price, o, ref),
    eqLo: perRef(o.lo, o, ref),
    eqReg: perRef(o.reg, o, ref),
    up: o.qty ? round2(o.price / o.qty) : null,
  }));
  const rank = { deal: 0, mine: 1, hist: 2 };
  rows.sort((a, b) => rank[a.source] - rank[b.source] || (a.upcoming - b.upcoming) || (a.eq ?? Infinity) - (b.eq ?? Infinity));
  const nowList = rows.filter(r => r.source === 'deal' && !r.upcoming && r.eq != null).sort((a, b) => a.eq - b.eq);
  const ever = rows.filter(r => r.eqLo != null && !r.upcoming).sort((a, b) => a.eqLo - b.eqLo)[0] ?? null;
  const regs = rows.map(r => r.eqReg).filter(v => v != null);
  const soon = rows.filter(r => r.upcoming && r.eq != null).sort((a, b) => a.eq - b.eq)[0] ?? null;
  const next = rows.filter(r => r.next && r.next > today).sort((a, b) => a.next.localeCompare(b.next))[0] ?? null;
  // Najceneje po trgovinah (zdaj v akciji, sicer tvoja zadnja cena).
  const byStore = new Map();
  for (const r of rows) {
    if (r.eq == null || r.source === 'hist' || r.upcoming) continue;
    const prev = byStore.get(r.s);
    if (!prev || (r.source === 'deal' && prev.source !== 'deal') || (r.source === prev.source && r.eq < prev.eq)) byStore.set(r.s, r);
  }
  return {
    ref, rows,
    now: nowList[0] ?? null,
    ever: ever && { row: ever, eq: ever.eqLo, date: ever.source === 'mine' ? ever.date : ever.lod },
    regular: regs.length ? Math.max(...regs) : null,
    next, soon,
    stores: [...byStore.values()].sort((a, b) => a.eq - b.eq),
    auto: rows.filter(r => r.status === 'auto').length,
  };
}

/** Iskanje po knjižnici: ime ali iskalna imena izdelka vsebujejo vse besede poizvedbe. */
export function searchCatalog(products, query) {
  const q = words(query);
  if (!q.length) return products;
  return products.filter(p => {
    const w = words([p.name, ...(p.terms ?? [])].join(' '));
    return q.every(part => w.some(x => x.startsWith(part)));
  });
}

/** Seznam besed iz polja »besede, ločene z vejico«. */
export const parseList = text => [...new Set(String(text ?? '').split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))];

/** Najpogostejša velikost kosa iz imen z več kosi (»Vafelj, 3 x 43 g« → »43 g«) ali null. */
export function pieceSize(names) {
  const c = new Map();
  for (const n of names) {
    const m = norm(n).match(/\d+\s?x\s?(\d+(?:[.,]\d+)?)\s?(g|ml)\b/);
    if (m) { const k = `${m[1]} ${m[2]}`; c.set(k, (c.get(k) ?? 0) + 1); }
  }
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Iskanje brez shranjenega izdelka: ponudbe, razvrščene v izdelke po različici (»Kinder Bueno«, »… bel«, »… koledar«).
 * Vrne [{ variant, words, title, product, summary, count }]: najprej osnovni izdelek, nato po številu trgovin.
 */
export function searchGroups(query, sources, today, limit = 8) {
  const base = newProduct(query, 'tmp');
  const { variant, ...open } = base;
  const offers = productOffers(open, sources, today);
  const groups = new Map();
  for (const o of offers) groups.set(o.variant, [...(groups.get(o.variant) ?? []), o]);
  const size = packSize(base.size);
  const out = [];
  for (const [key, list] of groups) {
    // Izvirne besede različice iz najkrajšega imena (za ime izdelka: »Kinder bueno white«).
    const rep = [...list].sort((a, b) => (b.source === 'deal') - (a.source === 'deal') || a.n.length - b.n.length)[0];
    const keys = new Set(key.split(' ').filter(Boolean));
    const words_ = [...new Set(wordsOf(rep.n).filter(w => keys.has(canon(w)) && !/\d/.test(w)))];
    const product = { ...base, name: [base.name, ...words_].join(' '), variant: variantKey(words_) === key ? words_ : key ? key.split(' ') : [] };
    const fit = list.filter(o => o.fits).map(o => ({ ...o, status: 'auto' }));
    if (!fit.length) continue;
    // Velikost kosa iz »3 x 43 g«, če se ujema z vsemi pakiranji v skupini: cene so potem na kos.
    if (!product.size) {
      const piece = pieceSize(fit.map(o => o.n));
      if (piece && fit.every(o => sizeFits(packSize(piece), o.qty, o.uu))) product.size = piece;
    }
    const summary = productSummary(product, fit, today);
    out.push({ variant: key, title: product.name, product, summary, count: new Set(fit.map(o => o.s)).size, now: fit.some(o => o.source === 'deal' && !o.upcoming) });
  }
  return out.sort((a, b) => (a.variant === '' ? 0 : 1) - (b.variant === '' ? 0 : 1) || b.now - a.now || b.count - a.count || a.variant.length - b.variant.length).slice(0, limit);
}
