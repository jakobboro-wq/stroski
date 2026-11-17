// Knjižnica izdelkov: en izdelek (npr. Kinder Bueno 43 g) združi različna imena v trgovinah in na računih.
// Za vsak izdelek zbere ponudbe (zdajšnje akcije, zgodovino akcij, tvoje cene z računov) in pove,
// kje je zdaj najceneje in kakšna je najnižja znana cena. Brez brskalnika, da se da preizkusiti.
//
// Ujemanje: ime ustreza izdelku, če vsebuje vse besede vsaj enega od imen (»kinder bueno«, »kind bueno«)
// in nobene od izključenih besed (»bel«, »white«). Posamezno ime v trgovini lahko ročno potrdiš ali zavrneš.

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

/** Nov izdelek iz iskanja: ime in velikost iz besedila (»kinder bueno 43 g«). */
export function newProduct(query, id = `p${Date.now().toString(36)}`) {
  const size = packSize(query);
  const name = query.replace(/\d+(?:[.,]\d+)?\s?(kg|dag|g|ml|cl|dl|l)\b/i, '').replace(/\s+/g, ' ').trim();
  return { id, name: name ? name[0].toUpperCase() + name.slice(1) : query, size: size ? query.match(/\d+(?:[.,]\d+)?\s?(kg|dag|g|ml|cl|dl|l)\b/i)[0] : '', terms: [name.toLowerCase() || query.toLowerCase()], not: [], links: {} };
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
 * status: 'yes' (potrdil si), 'auto' (samodejno), 'no' (zavrnil si; vrnjeno samo z withRejected).
 * sources: { deals, index (indexRows), purchases (pantry.purchases), storeOf }
 */
export function productOffers(product, { deals = [], index = [], purchases = [], storeOf = () => null }, today, { withRejected = false } = {}) {
  const links = product.links ?? {};
  const status = key => (links[key] === true ? 'yes' : links[key] === false ? 'no' : 'auto');
  const keep = key => withRejected || links[key] !== false;
  const hist = new Map();
  for (const r of index) {
    if (!nameMatches(product, r.n)) continue;
    hist.set(offerKey(r.s, r.n), r);
  }
  const out = [];
  const seen = new Set();
  for (const d of deals) {
    if (!(d.p > 0) || (d.to && d.to < today) || !nameMatches(product, d.n)) continue;
    const key = offerKey(d.s, d.n);
    if (!keep(key)) continue;
    const prev = out.find(o => o.key === key);
    if (prev && prev.price <= d.p) continue;
    if (prev) out.splice(out.indexOf(prev), 1);
    seen.add(key);
    const h = hist.get(key);
    const size = qtyOf(d.p, d.up, d.uu, d.q, d.n);
    out.push({
      key, s: d.s, n: d.n, source: 'deal', status: status(key), price: d.p, qty: size?.qty ?? null, uu: size?.unit ?? null,
      to: d.to ?? null, f: d.f ?? null, upcoming: !!d.f && d.f > today, d: d.d ?? null, o: d.o ?? null, plus: !!d.plus, u: d.u ?? null,
      lo: Math.min(d.p, h?.lo ?? Infinity, d.lo ?? Infinity), lod: h?.lod ?? null, reg: d.o ?? h?.reg ?? null, cy: h?.cy ?? d.cy ?? null,
    });
  }
  for (const [key, h] of hist) {
    if (seen.has(key) || !keep(key)) continue;
    const size = h.k > 0 ? { qty: h.k, unit: h.uu } : packSize(h.n);
    out.push({
      key, s: h.s, n: h.n, source: 'hist', status: status(key), price: h.lp, qty: size?.qty ?? null, uu: size?.unit ?? null,
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
    if (!keep(key)) continue;
    const size = p.kg ? { qty: p.kg / p.qty, unit: 'kg' } : packSize(p.name);
    out.push({ key, s: p.store, n: p.name, source: 'mine', status: status(key), price: p.unit, qty: size?.qty ?? null, uu: size?.unit ?? null, date: p.date, lo: p.lo });
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
  const rows = offers.filter(o => o.status !== 'no').map(o => ({
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
