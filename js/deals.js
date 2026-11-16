// Akcije trgovin: iskanje, filtri in ujemanje z izdelki, ki jih kupuješ ali spremljaš. Brez brskalnika, da se da preizkusiti.

import { normalize } from './categorize.js';
import { GROUPS, isFoodGroup } from './products.js';

export const DEALS_URL = 'https://raw.githubusercontent.com/jakobboro-wq/stroski/akcije/deals.json';
export const STORE_NAMES = { tus: 'Tuš', lidl: 'Lidl', hofer: 'Hofer', mercator: 'Mercator', eurospin: 'Eurospin', spar: 'Spar' };

// Besede, ki same po sebi ne povedo, kaj je izdelek.
const STOP = new Set(['akcija', 'novo', 'paket', 'kos', 'kosi', 'izdelek', 'postavka', 'razno', 'mix', 'bio', 'eko', 'super', 'extra', 'mega', 'maxi', 'mini', 'classic', 'original', 'premium', 'selection', 'family', 'pack', 'xxl', 'spar', 'tus', 'lidl', 'mercator', 'hofer', 'eurospin']);

const words = s => normalize(s).replace(/[^a-z ]/g, ' ').split(' ').filter(Boolean);

/** Ključne besede iz imena izdelka z računa (npr. »MLEKO ALPSKO 1L« → »mleko«). */
export function keywordOf(name) {
  return words(name).find(w => w.length >= 4 && !STOP.has(w)) ?? null;
}

/** Ali ime akcije vsebuje iskano besedo (tudi kot začetek besede: »mlek« najde »mleko«, »mlečni« ne). */
export function nameHas(deal, query) {
  const q = words(query);
  if (!q.length) return true;
  const w = deal._w ??= words(deal.n);
  return q.every(part => w.some(x => x.startsWith(part)));
}

/**
 * Združi samodejno pobrane akcije z uvoženim Hoferjevim letakom.
 * Izdelek iz letaka, ki je tudi na spletu (isto ime in cena), ne podvoji: spletni dobi popust in rok iz letaka.
 */
export function mergeLeaflet(auto, leaflet) {
  const key = d => `${d.s}|${words(d.n).join(' ')}|${d.p}`;
  const fromLeaflet = new Map(leaflet.map(d => [key(d), d]));
  const merged = auto.map(d => {
    const l = fromLeaflet.get(key(d));
    if (!l) return d;
    fromLeaflet.delete(key(d));
    return { ...d, o: d.o ?? l.o, d: d.d ?? l.d, f: d.f ?? l.f, to: d.to ?? l.to };
  });
  return [...merged, ...fromLeaflet.values()];
}

/** Akcija še velja (ali se šele začne), glede na današnji datum. */
export const isCurrent = (deal, today) => !deal.to || deal.to >= today;

/**
 * Akcije zate: ujemanje s tvojim seznamom (spremljam) in s tem, kar kupuješ (postavke z računov).
 * Vrne [{ deal, why }] razvrščeno po popustu.
 */
export function dealsForYou(deals, { watch = [], bought = [] }, today, limit = 40) {
  const sources = [
    ...watch.map(w => ({ q: w, why: w, watched: true })),
    ...[...new Set(bought.map(keywordOf).filter(Boolean))].filter(k => !watch.some(w => normalize(w) === k)).map(k => ({ q: k, why: k, watched: false })),
  ];
  const out = [];
  const seen = new Set();
  for (const d of deals) {
    if (!isCurrent(d, today)) continue;
    const hit = sources.find(s => nameHas(d, s.q));
    if (!hit) continue;
    const key = `${d.s}|${d.n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ deal: d, why: hit.why, watched: hit.watched });
  }
  return out.sort((a, b) => (b.deal.d ?? 0) - (a.deal.d ?? 0)).slice(0, limit);
}

/** Hrana: po skupini, sicer po podatku trgovine. Neznano ni hrana (da pogled »Hrana« ostane čist). */
export const isFoodDeal = d => (d.g ? isFoodGroup(d.g) : d.food === true);
/** Akcija se začne šele kasneje (npr. Eurospin za naslednji teden). */
export const isUpcoming = (d, today) => !!d.f && d.f > today;

const SORTS = {
  discount: (a, b) => (b.d ?? -1) - (a.d ?? -1) || a.p - b.p,
  price: (a, b) => a.p - b.p,
  // Cena na kg/l: brez podatka na konec, kg in l ločeno (najprej kg).
  unit: (a, b) => (a.up == null) - (b.up == null) || (a.uu ?? '').localeCompare(b.uu ?? '') || (a.up ?? 0) - (b.up ?? 0) || a.p - b.p,
  name: (a, b) => a.n.localeCompare(b.n, 'sl'),
};

/**
 * Filtri brez skupine (za štetje po skupinah) in s skupino (za seznam).
 * opts: { query, store | stores[], mode: 'food'|'all', food (staro: kot mode food), group, minDisc, noCard, upcoming }
 */
export function baseFilter(deals, opts, today) {
  const { query = '', store = '', stores = [], mode = 'all', food = false, minDisc = 0, noCard = false, upcoming = true } = opts;
  const pick = stores.length ? new Set(stores) : store ? new Set([store]) : null;
  const onlyFood = food || mode === 'food';
  return deals.filter(d => isCurrent(d, today)
    && (upcoming || !isUpcoming(d, today))
    && (!pick || pick.has(d.s))
    && (!onlyFood || isFoodDeal(d))
    && (!minDisc || (d.d ?? 0) >= minDisc)
    && (!noCard || !d.plus)
    && nameHas(d, query));
}

/** Iskanje in filtri za seznam vseh akcij. */
export function filterDeals(deals, opts, today) {
  const { group = '', sort = 'discount' } = opts;
  const list = baseFilter(deals, opts, today).filter(d => !group || (d.g ?? 'drugo') === group);
  if (sort === 'unit') {
    // Najprej enota, ki prevladuje (pri »mleko« €/l), da se primerja primerljivo.
    const c = {};
    for (const d of list) if (d.uu) c[d.uu] = (c[d.uu] ?? 0) + 1;
    const main = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
    const rank = d => (d.up == null ? 2 : d.uu === main ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || SORTS.unit(a, b));
  }
  return list.sort(SORTS[sort] ?? (() => 0));
}

/** Število akcij po skupinah (v vrstnem redu GROUPS), samo neprazne. */
export function groupCounts(list) {
  const c = {};
  for (const d of list) { const g = d.g ?? 'drugo'; c[g] = (c[g] ?? 0) + 1; }
  return GROUPS.filter(g => c[g.id]).map(g => ({ ...g, count: c[g.id] }));
}

/** Pregled po skupinah: najboljše akcije vsake skupine. */
export function byGroup(list, sort = 'discount', perGroup = 4) {
  const sorted = [...list].sort(SORTS[sort] ?? SORTS.discount);
  return groupCounts(list).map(g => ({ ...g, top: sorted.filter(d => (d.g ?? 'drugo') === g.id).slice(0, perGroup) }));
}

const eur = v => v.toFixed(2).replace('.', ',');
/** »6,98 €/kg« ali ''. */
export const unitLabel = d => (d.up != null && d.uu ? `${eur(d.up)} €/${d.uu}` : '');

const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };
/** »do 18. 11.«, »od 12. 11.« ali nič. */
export function validity(deal, today) {
  if (deal.f && deal.f > today) return `od ${fmtDay(deal.f)}`;
  if (deal.to) return `do ${fmtDay(deal.to)}`;
  return '';
}
