// Statistika stroškov: prihranki po mesecih, tempo porabe v mesecu, dnevi v tednu, kategorije skozi čas.
// Brez brskalnika, da se da preizkusiti. Prenosi in druge valute ne štejejo (kot v pregledu).

import { addMonths, daysInMonth } from './stats.js';
import { merchantKey } from './subscriptions.js';

const round2 = v => Math.round(v * 100) / 100;

/** Meseci obdobja do vključno `month`: zadnjih n (ali vsi od prvega z zapisi, če je n null). */
export function periodMonths(first, month, n) {
  if (!first) return [];
  const start = n == null ? first : [first, addMonths(month, -(n - 1))].sort().at(-1);
  const out = [];
  for (let m = start; m <= month; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * Prihranek po mesecih iz indeksa (buildIndex): prihodki − poraba.
 * rate: delež prihodkov, ki je ostal (null, če ni prihodkov).
 */
export function monthlySavings(index, months) {
  let cum = 0;
  return months.map(month => {
    const e = index.months.get(month);
    const income = round2(e?.income ?? 0);
    const spend = round2(e?.spend ?? 0);
    const saved = round2(income - spend);
    cum = round2(cum + saved);
    return { month, income, spend, saved, cum, rate: income > 0 ? saved / income : null };
  });
}

/** Povzetek obdobja: skupaj, stopnja varčevanja (iz vsot, ne povprečje stopenj), najboljši in najslabši mesec. */
export function savingsSummary(rows) {
  if (!rows.length) return null;
  const income = rows.reduce((s, r) => s + r.income, 0);
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const saved = round2(income - spend);
  const by = [...rows].sort((a, b) => b.saved - a.saved);
  return { income: round2(income), spend: round2(spend), saved, perMonth: round2(saved / rows.length), rate: income > 0 ? saved / income : null, best: by[0], worst: by.at(-1) };
}

const spendTx = (transactions, kindOf, base) => transactions.filter(t => t.currency === base && kindOf(t.categoryId) === 'expense');

/**
 * Tempo porabe: kumulativna poraba po dnevih v mesecu `month` (do `today`) in povprečna kumulativa
 * zadnjih `lookback` zaključenih mesecev z zapisi. Daljši/krajši meseci: dan d šteje po vrsti (31. dan samo, kjer obstaja).
 * Vrne { days, current: [..] (null po danes), average: [..] | null, months }.
 */
export function spendPace(transactions, kindOf, month, today, { lookback = 6, base = 'EUR' } = {}) {
  const tx = spendTx(transactions, kindOf, base);
  const dim = daysInMonth(month);
  const cumulative = m => {
    const n = daysInMonth(m);
    const daily = new Array(n).fill(0);
    for (const t of tx) if (t.date.slice(0, 7) === m) daily[Number(t.date.slice(8, 10)) - 1] -= t.amount;
    let c = 0;
    return daily.map(v => (c += v));
  };
  const lastDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : dim;
  const cur = cumulative(month).map((v, i) => (i < lastDay ? round2(v) : null));
  const seen = new Set(tx.map(t => t.date.slice(0, 7)));
  const past = [];
  for (let m = addMonths(month, -1); past.length < lookback && m >= [...seen].sort()[0]; m = addMonths(m, -1)) if (seen.has(m)) past.push(m);
  let average = null;
  if (past.length) {
    const curves = past.map(cumulative);
    average = Array.from({ length: dim }, (_, d) => round2(curves.reduce((s, c) => s + c[Math.min(d, c.length - 1)], 0) / curves.length));
  }
  return { days: Array.from({ length: dim }, (_, i) => i + 1), current: cur, average, months: past };
}

/**
 * Povprečna poraba po dnevih v tednu (pon … ned) v obdobju [from, to].
 * Brez ponavljajočih stroškov (najemnina 1. v mesecu ne pove, kdaj zapravljaš). Deli s številom teh dni v obdobju.
 */
export function weekdaySpend(transactions, kindOf, from, to, base = 'EUR') {
  const sums = new Array(7).fill(0);
  for (const t of spendTx(transactions, kindOf, base)) {
    if (t.seriesId || t.date < from || t.date > to) continue;
    sums[(new Date(`${t.date}T12:00:00Z`).getUTCDay() + 6) % 7] -= t.amount;
  }
  const counts = new Array(7).fill(0);
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) counts[(d.getUTCDay() + 6) % 7]++;
  return sums.map((s, i) => (counts[i] ? round2(s / counts[i]) : 0));
}

/**
 * Kategorije skozi čas: poraba po glavnih kategorijah (podkategorije prištete) po mesecih obdobja.
 * change: zadnja tretjina obdobja proti prvi (delež), null pri premalo mesecih ali brez porabe na začetku.
 */
export function categoryTrends(index, months, topOf) {
  const totals = new Map();
  for (const m of months) {
    const e = index.months.get(m);
    if (!e) continue;
    for (const [id, v] of e.byCat) {
      const top = topOf(id);
      if (!totals.has(top)) totals.set(top, new Map());
      totals.get(top).set(m, (totals.get(top).get(m) ?? 0) + v);
    }
  }
  const k = Math.max(1, Math.floor(months.length / 3));
  return [...totals].map(([id, byMonth]) => {
    const values = months.map(m => round2(byMonth.get(m) ?? 0));
    const total = round2(values.reduce((s, v) => s + v, 0));
    const head = values.slice(0, k).reduce((s, v) => s + v, 0) / k;
    const tail = values.slice(-k).reduce((s, v) => s + v, 0) / k;
    return { id, values, total, avg: round2(total / months.length), change: months.length >= 3 && head > 1 ? (tail - head) / head : null };
  }).filter(r => r.total > 0.005).sort((a, b) => b.total - a.total);
}

// ---------- Razširjena statistika: kam gre denar ----------

const lastDate = (tx, to) => tx.reduce((m, t) => (t.date <= to && t.date > m ? t.date : m), '');
const dayCount = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;

/**
 * Napoved porabe do konca meseca: do danes + kolikor običajno porabiš v preostanku meseca.
 * Iz krivulj spendPace; null brez preteklih mesecev ali če je mesec že mimo.
 */
export function monthEndForecast(pace, day) {
  if (!pace.average || day >= pace.days.length) return null;
  const now = pace.current[day - 1] ?? 0;
  const rest = pace.average.at(-1) - pace.average[day - 1];
  return round2(now + Math.max(0, rest));
}

/** Fiksni (ponavljajoči) in spremenljivi del porabe po mesecih ter povprečja (samo zaključeni meseci, če so). */
export function fixedVariable(index, months, current) {
  const rows = months.map(month => {
    const e = index.months.get(month);
    const fixed = round2(e?.fixed ?? 0);
    return { month, fixed, variable: round2((e?.spend ?? 0) - fixed) };
  });
  const done = rows.filter(r => r.month < current);
  const base = done.length ? done : rows;
  const fixed = base.reduce((s, r) => s + r.fixed, 0) / (base.length || 1);
  const variable = base.reduce((s, r) => s + r.variable, 0) / (base.length || 1);
  return { rows, fixed: round2(fixed), variable: round2(variable), share: fixed + variable > 0 ? fixed / (fixed + variable) : null };
}

/**
 * Prejemniki z največ porabe v obdobju (ključ merchantKey, da sklici ne razbijejo prejemnika).
 * Vrne { name, sum, count, perVisit, share, categoryId } – kategorija je najpogostejša pri prejemniku.
 */
export function topMerchants(transactions, kindOf, from, to, { base = 'EUR', n = 8, keyOf = merchantKey } = {}) {
  const tx = spendTx(transactions, kindOf, base).filter(t => t.date >= from && t.date <= to);
  const total = tx.reduce((s, t) => s - t.amount, 0);
  const map = new Map();
  for (const t of tx) {
    const key = keyOf(t.description) || '—';
    const e = map.get(key) ?? { name: t.description || 'Brez opisa', sum: 0, count: 0, cats: new Map() };
    e.sum -= t.amount;
    if (t.amount < 0) e.count++;
    e.cats.set(t.categoryId, (e.cats.get(t.categoryId) ?? 0) + 1);
    map.set(key, e);
  }
  return [...map.values()].filter(e => e.sum > 0.005).sort((a, b) => b.sum - a.sum).slice(0, n).map(e => ({
    name: e.name, sum: round2(e.sum), count: e.count, perVisit: e.count ? round2(e.sum / e.count) : 0,
    share: total > 0 ? e.sum / total : 0, categoryId: [...e.cats].sort((a, b) => b[1] - a[1])[0][0],
  }));
}

export const SIZE_BUCKETS = [10, 30, 100, 300];

/**
 * Velikost posameznih nakupov (brez ponavljajočih in vračil): koliko jih je in koliko denarja gre skoznje po razredih.
 * Razredi: < 10, 10–30, 30–100, 100–300, ≥ 300 €.
 */
export function purchaseSizes(transactions, kindOf, from, to, base = 'EUR') {
  const edges = [0, ...SIZE_BUCKETS, Infinity];
  const rows = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], count: 0, sum: 0 }));
  for (const t of spendTx(transactions, kindOf, base)) {
    if (t.seriesId || t.amount >= 0 || t.date < from || t.date > to) continue;
    const v = -t.amount;
    const r = rows.find(b => v >= b.lo && v < b.hi);
    r.count++;
    r.sum += v;
  }
  const total = rows.reduce((s, r) => s + r.sum, 0);
  const count = rows.reduce((s, r) => s + r.count, 0);
  return { rows: rows.map(r => ({ ...r, sum: round2(r.sum), share: total > 0 ? r.sum / total : 0 })), total: round2(total), count, median: medianOf(transactions, kindOf, from, to, base) };
}

function medianOf(transactions, kindOf, from, to, base) {
  const v = spendTx(transactions, kindOf, base).filter(t => !t.seriesId && t.amount < 0 && t.date >= from && t.date <= to).map(t => -t.amount).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return round2(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}

/** Največji posamezni izdatki v obdobju (brez ponavljajočih: najemnina ni presenečenje). */
export function largestExpenses(transactions, kindOf, from, to, { base = 'EUR', n = 5 } = {}) {
  return spendTx(transactions, kindOf, base)
    .filter(t => !t.seriesId && t.amount < 0 && t.date >= from && t.date <= to)
    .sort((a, b) => a.amount - b.amount).slice(0, n);
}

/**
 * Dnevi brez porabe (ponavljajoči stroški ne štejejo) od `from` do zadnjega dne z zapisi (najkasneje `to`):
 * po zadnjem uvozu izpiska ne vemo, ali si kaj zapravil, zato tisti dnevi ne štejejo.
 * Vrne { days, total, longest, until } ali null brez podatkov.
 */
export function noSpendDays(transactions, kindOf, from, to, base = 'EUR') {
  const all = transactions.filter(t => t.currency === base);
  const until = lastDate(all, to);
  if (!until || until < from) return null;
  const spent = new Set(spendTx(all, kindOf, base).filter(t => !t.seriesId && t.amount < 0).map(t => t.date));
  let days = 0, run = 0, longest = 0;
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= until; d.setUTCDate(d.getUTCDate() + 1)) {
    if (spent.has(d.toISOString().slice(0, 10))) run = 0;
    else { days++; longest = Math.max(longest, ++run); }
  }
  return { days, total: dayCount(from, until), longest, until };
}
