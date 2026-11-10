// Akcije trgovin: iskanje, filtri in ujemanje z izdelki, ki jih kupuješ ali spremljaš. Brez brskalnika, da se da preizkusiti.

import { normalize } from './categorize.js';

export const DEALS_URL = 'https://raw.githubusercontent.com/jakobboro-wq/stroski/akcije/deals.json';
export const STORE_NAMES = { tus: 'Tuš', lidl: 'Lidl', hofer: 'Hofer' };

// Besede, ki same po sebi ne povedo, kaj je izdelek.
const STOP = new Set(['akcija', 'novo', 'paket', 'kos', 'kosi', 'izdelek', 'postavka', 'razno', 'mix', 'bio', 'eko', 'super', 'extra', 'mega', 'maxi', 'mini', 'classic', 'original', 'premium', 'selection', 'family', 'pack', 'xxl', 'spar', 'tus', 'lidl', 'mercator', 'hofer']);

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

/** Iskanje in filtri za seznam vseh akcij. */
export function filterDeals(deals, { query = '', store = '', food = false, sort = 'discount' }, today) {
  const list = deals.filter(d => isCurrent(d, today) && (!store || d.s === store) && (!food || d.food !== false) && nameHas(d, query));
  const by = {
    discount: (a, b) => (b.d ?? -1) - (a.d ?? -1) || a.p - b.p,
    price: (a, b) => a.p - b.p,
    name: (a, b) => a.n.localeCompare(b.n, 'sl'),
  }[sort] ?? (() => 0);
  return list.sort(by);
}

const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };
/** »do 18. 11.«, »od 12. 11.« ali nič. */
export function validity(deal, today) {
  if (deal.f && deal.f > today) return `od ${fmtDay(deal.f)}`;
  if (deal.to) return `do ${fmtDay(deal.to)}`;
  return '';
}
