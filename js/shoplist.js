// Nakupovalni seznam: v katerih trgovinah kupiti, da je skupaj najceneje.
// Brez brskalnika, da se da preizkusiti.
//
// Za vsako postavko zberemo ponudbe po trgovinah: akcije in tvoje pretekle cene z računov.
// Primerjamo stroške za enako količino: če imajo ponudbe ceno na kg/l, je strošek = cena na enoto × količina,
// ki jo običajno kupiš (iz računov), sicer na 1 kg oz. 1 l; brez cene na enoto pa cena pakiranja.
// Nato preverimo vse kombinacije 1..maxStores trgovin; vsaka dodatna trgovina »stane« extraStoreCost €.

import { nameHas, isCurrent } from './deals.js';
import { norm, packSize, classify } from './products.js';
import { purchases } from './pantry.js';

const round2 = v => Math.round(v * 100) / 100;

const STORE_RX = [['mercator', /mercator|\bmerc\b/], ['lidl', /lidl/], ['tus', /\btus\b|tus d\.|tus market|engrotus/], ['hofer', /hofer|aldi/], ['eurospin', /eurospin/], ['spar', /spar|interspar/]];
/** Trgovina iz imena na računu (»MERCATOR d.d.« → mercator) ali null. */
export function storeOf(name) {
  const n = norm(name);
  return STORE_RX.find(([, rx]) => rx.test(n))?.[0] ?? null;
}

/** Besede iz besedila postavke (vsaj 2 črki), za iskanje po imenih. */
const words = text => norm(text).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 2 && !/^\d/.test(w));
// obj ima polje n (akcija ali { n: ime z računa }); nameHas si besede zapomni na objektu.
const wordCache = new Map();
const wordsOf = text => { if (!wordCache.has(text)) wordCache.set(text, words(text)); return wordCache.get(text); };
const matches = (obj, text) => { const w = wordsOf(text); return w.length > 0 && w.every(x => nameHas(obj, x)); };

/**
 * Ponudbe za eno postavko: [{ store, price, up, uu, size, source: 'deal'|'mine', deal?, date? }].
 * Iz akcij vzame najugodnejšo na trgovino, iz računov zadnjo ceno na trgovino.
 */
export function offersFor(text, deals, history, today) {
  const out = [];
  // Skupina postavke (»sir« → mlečni), da »sir« ne najde »širokih rezancev«.
  const g = classify(text);
  const sameGroup = x => !g || !x || x === g;
  for (const d of deals) {
    if (!isCurrent(d, today) || (d.f && d.f > today) || !sameGroup(d.g) || !matches(d, text)) continue;
    const size = packSize(d.q) ?? packSize(d.n);
    out.push({ store: d.s, price: d.p, up: d.up ?? (size ? d.p / size.qty : null), uu: d.uu ?? size?.unit ?? null, size: size?.qty ?? null, source: 'deal', deal: d });
  }
  const lastByStore = new Map();
  for (const p of history) {
    const store = storeOf(p.store);
    if (!store || !sameGroup(p.g) || !matches(p.ref ??= { n: p.name }, text)) continue;
    const prev = lastByStore.get(store);
    if (!prev || p.date >= prev.date) lastByStore.set(store, p);
  }
  for (const [store, p] of lastByStore) {
    const size = packSize(p.name);
    out.push({ store, price: p.unit, up: size ? p.unit / size.qty : null, uu: size?.unit ?? null, size: size?.qty ?? null, source: 'mine', date: p.date, name: p.name });
  }
  return out;
}

/**
 * Strošek ponudbe za primerjavo: na enoto × referenčna količina, če je mogoče, sicer cena pakiranja.
 * Vrne { costs: Map store → { cost, offer }, unit, ref }.
 */
export function costsFor(offers, history, text) {
  const withUnit = offers.filter(o => o.up != null && o.uu);
  const counts = {};
  for (const o of withUnit) counts[o.uu] = (counts[o.uu] ?? 0) + 1;
  const unit = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // Količina, ki jo običajno kupiš (zadnji nakup s pakiranjem); sicer primerjava na 1 kg oz. 1 l.
  const mine = history.filter(p => matches(p.ref ??= { n: p.name }, text)).map(p => packSize(p.name)).filter(s => s && s.unit === unit).at(-1);
  const ref = unit ? (mine?.qty ?? 1) : null;
  const costs = new Map();
  for (const o of offers) {
    const cost = unit ? (o.uu === unit && o.up != null ? o.up * ref : null) : o.price;
    if (cost == null) continue;
    const prev = costs.get(o.store);
    // Na trgovino: najcenejša ponudba (akcija ima prednost pred tvojo staro ceno, če je enaka).
    if (!prev || cost < prev.cost - 0.001 || (Math.abs(cost - prev.cost) < 0.001 && o.source === 'deal')) costs.set(o.store, { cost: round2(cost), offer: o });
  }
  return { costs, unit, ref };
}

/** Vse kombinacije k elementov. */
function combos(list, k, start = 0, acc = [], out = []) {
  if (acc.length === k) { out.push([...acc]); return out; }
  for (let i = start; i < list.length; i++) { acc.push(list[i]); combos(list, k, i + 1, acc, out); acc.pop(); }
  return out;
}

/**
 * Optimalen razpored seznama po trgovinah.
 * items: [{ text }], deals: obogatene akcije, transactions: za tvoje cene z računov.
 * Postavka brez cene v izbrani trgovini se šteje z najvišjo znano ceno te postavke (previdno: tam ni akcije).
 * Vrne { best: { stores, total, plan }, single: [{ store, total, known }], items: [...], unknown: [...] }.
 */
export function optimize(items, deals, transactions, today, { maxStores = 2, extraStoreCost = 3, stores: allowed = null } = {}) {
  const history = purchases(transactions);
  const rows = items.map(it => {
    const offers = offersFor(it.text, deals, history, today);
    const { costs, unit, ref } = costsFor(offers, history, it.text);
    const known = [...costs.values()].map(c => c.cost);
    return { text: it.text, costs, unit, ref, fallback: known.length ? Math.max(...known) : null };
  });
  const priced = rows.filter(r => r.fallback != null);
  const unknown = rows.filter(r => r.fallback == null).map(r => r.text);
  let storeList = [...new Set(priced.flatMap(r => [...r.costs.keys()]))];
  if (allowed?.length) storeList = storeList.filter(s => allowed.includes(s));
  const costIn = (r, s) => r.costs.get(s)?.cost ?? r.fallback;
  const evaluate = set => {
    let total = 0;
    const plan = priced.map(r => {
      let bestS = null, bestC = Infinity;
      for (const s of set) { const c = costIn(r, s); if (c < bestC - 0.001 || (Math.abs(c - bestC) < 0.001 && r.costs.has(s) && !r.costs.has(bestS))) { bestC = c; bestS = s; } }
      total += bestC;
      const hit = r.costs.get(bestS);
      return { text: r.text, store: bestS, cost: round2(bestC), offer: hit?.offer ?? null, estimated: !hit, unit: r.unit, ref: r.ref };
    });
    return { stores: set, total: round2(total), plan, score: total + extraStoreCost * (set.length - 1) };
  };
  let best = null;
  for (let k = 1; k <= Math.min(maxStores, storeList.length); k++) {
    for (const set of combos(storeList, k)) {
      const e = evaluate(set);
      if (!best || e.score < best.score - 0.001) best = e;
    }
  }
  const single = storeList.map(s => ({ store: s, total: evaluate([s]).total, known: priced.filter(r => r.costs.has(s)).length })).sort((a, b) => a.total - b.total);
  return { best, single, unknown, count: priced.length };
}
