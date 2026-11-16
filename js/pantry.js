// Zaloga iz slikanih računov: kaj kupuješ, kako hitro porabiš, kdaj bo zmanjkalo, koliko si prihranil
// in kdaj je ugodno kupiti (glede na akcije). Brez brskalnika, da se da preizkusiti.
//
// Model: za vsak izdelek (ključ iz imena na računu) iz razmikov med nakupi oceni, koliko dni traja
// eno pakiranje (mediana, da posamezen izlet ali zabava ne pokvari ocene). Zaloga = zadnji nakup,
// porabljen s to hitrostjo. Ročna oznaka »porabil« ali »še imam« oceno popravi.

import { itemKey } from './receipt.js';
import { classify, GROUP, isFoodGroup, packSize } from './products.js';
import { keywordOf, nameHas, isCurrent } from './deals.js';

const DAY = 86400e3;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const round2 = v => Math.round(v * 100) / 100;
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

// Skupine, ki zdržijo dlje: tu se splača kupiti na zalogo, ko je akcija.
export const STORABLE = new Set(['shramba', 'pijace', 'alkohol', 'zamrznjeno', 'drogerija', 'zajtrk', 'sladko', 'zivali']);

/** Vse postavke z računov kot nakupi: { key, name, date, store, amount, qty, kg, disc, g, unit (cena na kos) }. */
export function purchases(transactions) {
  const out = [];
  for (const t of transactions) {
    if (t.source !== 'receipt' || !t.items?.length || !t.date) continue;
    for (const i of t.items) {
      const key = itemKey(i.name);
      if (!key || !(i.amount > 0)) continue;
      const qty = i.qty > 1 ? i.qty : 1;
      out.push({ key, name: i.name, date: t.date, store: t.description ?? '', amount: i.amount, qty, kg: i.kg ?? null, disc: i.disc ?? 0, g: i.g ?? classify(i.name), unit: round2(i.amount / qty) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Izdelki z napovedjo zaloge.
 * marks: { [key]: { empty?: iso, have?: iso } } (ročne oznake: porabil / še imam ob datumu).
 */
export function pantry(transactions, today, marks = {}) {
  const byKey = new Map();
  for (const p of purchases(transactions)) {
    const list = byKey.get(p.key) ?? [];
    // Isti dan, isti izdelek (dva računa ali dve vrstici) = en nakup.
    const same = list.find(x => x.date === p.date);
    if (same) { same.qty += p.qty; same.amount = round2(same.amount + p.amount); same.disc = round2(same.disc + p.disc); }
    else list.push({ ...p });
    byKey.set(p.key, list);
  }
  const out = [];
  for (const [key, list] of byKey) {
    const last = list.at(-1);
    // Dni na pakiranje: razmik do naslednjega nakupa, deljen s kupljeno količino.
    const perPack = [];
    for (let i = 0; i < list.length - 1; i++) {
      const gap = days(list[i].date, list[i + 1].date);
      if (gap > 0) perPack.push(gap / list[i].qty);
    }
    const m = marks[key] ?? {};
    // »Porabil« po zadnjem nakupu je natančna meritev trajanja zadnjega nakupa.
    if (m.empty && m.empty > last.date) perPack.push(days(last.date, m.empty) / last.qty);
    const dpp = perPack.length ? Math.min(180, Math.max(1, median(perPack))) : null;
    let runout = dpp ? addDays(last.date, Math.round(dpp * last.qty)) : null;
    if (m.empty && m.empty >= last.date) runout = m.empty;
    // »Še imam« po napovedanem koncu: zamakni za tretjino običajnega trajanja.
    if (m.have && m.have >= last.date && runout && m.have >= runout) runout = addDays(m.have, Math.max(1, Math.round((dpp ?? 7) / 3)));
    const left = runout ? days(today, runout) : null;
    const units = list.map(x => x.amount / x.qty);
    out.push({
      key, name: last.name, g: last.g, group: GROUP[last.g] ?? null,
      count: list.length, last: last.date, lastStore: last.store, lastQty: last.qty,
      daysPerPack: dpp ? Math.round(dpp * 10) / 10 : null,
      confidence: perPack.length >= 3 ? 'high' : perPack.length >= 1 ? 'low' : 'none',
      runout, left,
      status: left == null ? 'unknown' : left <= 0 ? 'out' : left <= 3 ? 'soon' : 'ok',
      usual: round2(median(units)), min: round2(Math.min(...units)),
      cheapestStore: list.reduce((a, b) => (b.amount / b.qty < a.amount / a.qty ? b : a)).store,
      spent: round2(list.reduce((s, x) => s + x.amount, 0)),
      perMonth: dpp ? round2((30 / dpp) * median(units)) : null,
    });
  }
  const rank = { out: 0, soon: 1, ok: 2, unknown: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.left ?? 999) - (b.left ?? 999) || b.count - a.count);
}

/**
 * Prihranki v obdobju [from, to]:
 * - receipt: popusti, odšteti na računu,
 * - vsUsual: koliko manj si plačal od svoje običajne cene (mediana prejšnjih nakupov, vsaj 2),
 * - overUsual: koliko več (pošteno: tudi to se zgodi).
 */
export function savings(transactions, from, to) {
  const all = purchases(transactions);
  const seen = new Map();
  let receipt = 0, vsUsual = 0, overUsual = 0;
  const best = [];
  for (const p of all) {
    const prev = seen.get(p.key) ?? [];
    if (p.date >= from && p.date <= to) {
      receipt += p.disc;
      if (prev.length >= 2) {
        const usual = median(prev);
        const diff = (usual - p.unit) * p.qty;
        if (diff > 0.005) { vsUsual += diff; best.push({ name: p.name, date: p.date, store: p.store, saved: round2(diff), usual: round2(usual), paid: p.unit }); }
        else if (diff < -0.005) overUsual -= diff;
      }
    }
    prev.push(p.unit);
    seen.set(p.key, prev);
  }
  return { receipt: round2(receipt), vsUsual: round2(vsUsual), overUsual: round2(overUsual), total: round2(receipt + vsUsual), best: best.sort((a, b) => b.saved - a.saved).slice(0, 5) };
}

/** Poraba po skupinah živil v obdobju (samo postavke z računov). */
export function spendByGroup(transactions, from, to) {
  const c = {};
  for (const p of purchases(transactions)) {
    if (p.date < from || p.date > to) continue;
    const g = p.g ?? 'drugo';
    c[g] = round2((c[g] ?? 0) + p.amount);
  }
  return Object.entries(c).map(([id, amount]) => ({ id, amount, group: GROUP[id] ?? GROUP.drugo })).sort((a, b) => b.amount - a.amount);
}

const UNITS = /^(?:\d.*|kos|kom|pak|pakirano|cena|za|in|z|s|v|na)$/;
/**
 * Kako dobro se akcija ujema z izdelkom z računa: 2 = isti izdelek (ujema se še ena beseda, npr. znamka),
 * 1 = podoben (samo glavna beseda, npr. »kava«).
 */
export function matchStrength(item, deal) {
  const words = itemKey(item.name).split(' ').filter(w => w.length >= 4 && !UNITS.test(w));
  const hits = words.filter(w => nameHas(deal, w)).length;
  return hits >= 2 || (hits === 1 && words.length === 1) ? 2 : hits ? 1 : 0;
}

/** Akcije, ki ustrezajo izdelku z računa: ista ključna beseda in (če je znana) ista skupina. */
export function matchingDeals(item, deals, today, { upcoming = false } = {}) {
  const kw = keywordOf(item.name);
  if (!kw) return [];
  return deals.filter(d => isCurrent(d, today) && (upcoming || !d.f || d.f <= today)
    && nameHas(d, kw) && (!item.g || !d.g || d.g === item.g));
}

// Cena na enoto za izdelek z računa, če je velikost v imenu (»MLEKO 1L«).
const itemUnitPrice = (name, price) => { const s = packSize(name); return s ? { up: price / s.qty, uu: s.unit } : null; };

/**
 * Priporočila, kdaj kupiti:
 * - now: zmanjkuje (ali je zmanjkalo) in je akcija zdaj,
 * - wait: zmanjkuje čez nekaj dni, akcija pa se začne pred tem,
 * - stock: zdržljiv izdelek, ki ga kupuješ redno, je zdaj močno znižan (na zalogo),
 * - buy: zmanjkuje, akcije ni (z najcenejšo trgovino iz tvojih nakupov).
 */
export function recommendations(items, deals, today, { horizon = 7, stockDiscount = 25 } = {}) {
  const out = [];
  for (const it of items) {
    if (it.status === 'unknown' && it.count < 2) continue;
    const now = matchingDeals(it, deals, today);
    const later = matchingDeals(it, deals, today, { upcoming: true }).filter(d => d.f && d.f > today);
    const mine = itemUnitPrice(it.name, it.usual);
    const cheaper = d => (mine && d.up != null && d.uu === mine.uu ? d.up < mine.up : d.p < it.usual);
    // Najprej isti izdelek (znamka), nato podoben; znotraj tega največji popust.
    const byMatch = (a, b) => matchStrength(it, b) - matchStrength(it, a) || (b.d ?? 0) - (a.d ?? 0) || a.p - b.p;
    const bestNow = now.filter(cheaper).sort(byMatch)[0] ?? null;
    const needSoon = it.left != null && it.left <= horizon;
    const similar = d => !!d && matchStrength(it, d) < 2;
    if (needSoon && bestNow) out.push({ type: 'now', item: it, deal: bestNow, similar: similar(bestNow) });
    else if (needSoon && it.left > 0) {
      // Čakanje se splača samo na isti izdelek.
      const wait = later.filter(d => d.f <= it.runout && cheaper(d) && matchStrength(it, d) === 2).sort((a, b) => a.f.localeCompare(b.f) || (b.d ?? 0) - (a.d ?? 0))[0];
      if (wait) out.push({ type: 'wait', item: it, deal: wait, similar: false });
      else if (it.left <= 3) out.push({ type: 'buy', item: it, deal: null });
    } else if (needSoon) out.push({ type: 'buy', item: it, deal: null });
    else if (bestNow && !similar(bestNow) && STORABLE.has(it.g) && it.count >= 2 && ((bestNow.d ?? 0) >= stockDiscount || bestNow.p <= it.usual * 0.8)) {
      // Na zalogo samo isti izdelek (znamka), ne katerakoli kava.
      out.push({ type: 'stock', item: it, deal: bestNow, similar: false });
    }
  }
  const rank = { now: 0, buy: 1, wait: 2, stock: 3 };
  return out.sort((a, b) => rank[a.type] - rank[b.type] || (a.item.left ?? 99) - (b.item.left ?? 99));
}

/** Akcije drugje, ki bi bile pri zadnjih nakupih cenejše (ocena, ne prihranek). */
export function cheaperElsewhere(transactions, deals, today, sinceDays = 14) {
  const from = addDays(today, -sinceDays);
  const seen = new Set();
  const out = [];
  for (const p of purchases(transactions).filter(x => x.date >= from).reverse()) {
    if (seen.has(p.key) || !isFoodGroup(p.g)) continue;
    seen.add(p.key);
    const mine = itemUnitPrice(p.name, p.unit);
    const best = matchingDeals(p, deals, today)
      .filter(d => (mine && d.up != null && d.uu === mine.uu ? d.up < mine.up * 0.9 : !mine && d.p < p.unit * 0.9))
      .sort((a, b) => matchStrength(p, b) - matchStrength(p, a) || (a.up ?? a.p) - (b.up ?? b.p))[0];
    if (best) out.push({ purchase: p, deal: best, similar: matchStrength(p, best) < 2, diff: round2(mine && best.up != null ? (mine.up - best.up) * (packSize(p.name)?.qty ?? 1) : p.unit - best.p) });
  }
  return out.sort((a, b) => b.diff - a.diff).slice(0, 8);
}
