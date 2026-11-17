// Statistika stroškov: prihranki po mesecih, tempo porabe v mesecu, dnevi v tednu, kategorije skozi čas.
// Brez brskalnika, da se da preizkusiti. Prenosi in druge valute ne štejejo (kot v pregledu).

import { addMonths, daysInMonth } from './stats.js';

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
