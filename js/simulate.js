// Simulacija naslednjih mesecev (Monte Carlo): denar na računih in neto premoženje.
// Brez brskalnika, da se da preizkusiti.
//
// Model:
// - stalni prihodki in stroški: iz ponavljajočih predlog (znani zneski po mesecih),
// - spremenljivi del (hrana, izhodi, nepravilni prihodki): naključno izbran pretekli mesec (bootstrap);
//   prihodek in strošek iz istega meseca, da ostane povezava (npr. dopust in regres),
// - naložbe: mesečni donos lognormalen okoli pričakovanega letnega donosa, z letno volatilnostjo (predpostavka),
// - stvari in dolgovi: po svojih pravilih (amortizacija, odplačilo), brez naključja.

import { occurrencesBetween } from './recurring.js';
import { assetValue, debtBalance } from './assets.js';
import { addMonths } from './stats.js';

const round2 = v => Math.round(v * 100) / 100;

/** Ponovljiv generator naključnih števil (mulberry32), da so rezultati in testi stabilni. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = rand => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };

/**
 * Pretekli meseci: { month, incFix, incVar, outFix, outVar } (out pozitiven). Prenosi in druge valute ne štejejo.
 * Samo zaključeni meseci pred `month` (tekoči še ni cel).
 */
export function monthlyHistory(transactions, kindOf, month, base = 'EUR') {
  const m = new Map();
  for (const t of transactions) {
    if (t.currency && t.currency !== base) continue;
    const key = t.date?.slice(0, 7);
    if (!key || key >= month) continue;
    const kind = kindOf(t.categoryId);
    if (kind === 'transfer') continue;
    const e = m.get(key) ?? { month: key, incFix: 0, incVar: 0, outFix: 0, outVar: 0 };
    if (kind === 'income') e[t.seriesId ? 'incFix' : 'incVar'] += t.amount;
    else e[t.seriesId ? 'outFix' : 'outVar'] -= t.amount;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).map(e => ({ ...e, incFix: round2(e.incFix), incVar: round2(e.incVar), outFix: round2(e.outFix), outVar: round2(e.outVar) }));
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/**
 * Simulacija.
 * opts: {
 *   months: ['2026-12', …] (prihodnji meseci),
 *   history: [{ incVar, outVar }] (vzorec za spremenljivi del),
 *   fixed: [{ inc, out }] za vsak prihodnji mesec,
 *   cash0, invest0, investMonthly, rate (letni donos), vol (letna volatilnost),
 *   other: [vrednost stvari po mesecih], debts: [dolg po mesecih],
 *   varScale: [delež spremenljivega dela po mesecih] (npr. 0,4 za preostanek tekočega meseca),
 *   runs, seed, threshold
 * }
 * Vrne { cash, net, invest: [{ p10, p50, p90 }] po mesecih, pBelow, minCash: { p10, p50 }, runs }.
 */
export function simulate({ months, history, fixed, cash0 = 0, invest0 = 0, investMonthly = 0, rate = 0.07, vol = 0.15, other = [], debts = [], varScale = [], runs = 2000, seed = 1, threshold = 0 }) {
  const H = months.length;
  const rand = rng(seed);
  const mu = Math.log(1 + rate) / 12;
  const sd = vol / Math.sqrt(12);
  const cash = Array.from({ length: H }, () => new Float64Array(runs));
  const inv = Array.from({ length: H }, () => new Float64Array(runs));
  const minCash = new Float64Array(runs);
  let below = 0;
  for (let r = 0; r < runs; r++) {
    let c = cash0, v = invest0, lo = Infinity;
    for (let i = 0; i < H; i++) {
      const h = history.length ? history[Math.floor(rand() * history.length)] : { incVar: 0, outVar: 0 };
      const f = fixed[i] ?? { inc: 0, out: 0 };
      const k = varScale[i] ?? 1;
      const put = investMonthly * k;
      c += f.inc - f.out + k * (h.incVar - h.outVar) - put;
      v = v * Math.exp(k * (mu - (sd * sd) / 2) + Math.sqrt(k) * sd * gauss(rand)) + put;
      cash[i][r] = c;
      inv[i][r] = v;
      lo = Math.min(lo, c);
    }
    minCash[r] = lo;
    if (lo < threshold) below++;
  }
  const bands = (arr, add = () => 0) => arr.map((col, i) => {
    const s = Float64Array.from(col, x => x + add(i)).sort();
    return { p10: round2(pct(s, 0.1)), p50: round2(pct(s, 0.5)), p90: round2(pct(s, 0.9)) };
  });
  // Neto = denar + naložbe + stvari − dolgovi (stvari in dolgovi so v vseh poteh enaki).
  const net = cash.map((col, i) => {
    const s = Float64Array.from(col, (x, r) => x + inv[i][r] + (other[i] ?? 0) - (debts[i] ?? 0)).sort();
    return { p10: round2(pct(s, 0.1)), p50: round2(pct(s, 0.5)), p90: round2(pct(s, 0.9)) };
  });
  const mins = Float64Array.from(minCash).sort();
  return {
    cash: bands(cash), invest: bands(inv), net,
    pBelow: Math.round((below / runs) * 1000) / 1000,
    minCash: { p10: round2(pct(mins, 0.1)), p50: round2(pct(mins, 0.5)) },
    runs,
  };
}

/** Povprečni mesec iz zgodovine (za razlago): { inc, out, net }. */
export function averageMonth(history, fixed) {
  const n = history.length || 1;
  const v = history.reduce((a, h) => ({ inc: a.inc + h.incVar, out: a.out + h.outVar }), { inc: 0, out: 0 });
  const f = fixed.length ? fixed.reduce((a, x) => ({ inc: a.inc + x.inc, out: a.out + x.out }), { inc: 0, out: 0 }) : { inc: 0, out: 0 };
  const fn = fixed.length || 1;
  const inc = v.inc / n + f.inc / fn, out = v.out / n + f.out / fn;
  return { inc: round2(inc), out: round2(out), net: round2(inc - out) };
}

// ---------- Vhod iz podatkov aplikacije ----------

const lastDay = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/**
 * Sestavi vhod za simulate():
 * - meseci: preostanek tekočega + `horizon` naslednjih,
 * - stalni del iz ponavljajočih predlog (samo ponovitve po današnjem dnevu),
 * - spremenljivi del: zadnjih `lookback` zaključenih mesecev (prvi mesec z delnim deležem),
 * - denar danes: vsota premoženja vrste »Denar / račun« ali ročno vpisano stanje,
 * - stvari in dolgovi po mesecih (brez denarja in ročnih naložb, ki jih štejemo posebej).
 */
export function buildInputs({ transactions, recurring = [], assets = [], kindOf, today, horizon = 12, lookback = 12, cashStart = null, base = 'EUR' }) {
  const month = today.slice(0, 7);
  const months = [month, ...Array.from({ length: horizon }, (_, i) => addMonths(month, i + 1))];
  const dim = lastDay(month);
  const day = Number(today.slice(8, 10));
  const varScale = months.map((_, i) => (i ? 1 : Math.max(0, (dim - day) / dim)));
  const fixed = months.map(m => {
    const from = m === month ? today : `${m}-01`;
    const to = `${m}-${String(lastDay(m)).padStart(2, '0')}`;
    let inc = 0, out = 0;
    for (const s of recurring) {
      if (s.currency && s.currency !== base) continue;
      const kind = kindOf(s.categoryId);
      if (kind === 'transfer') continue;
      const n = occurrencesBetween(s, from, to).filter(d => d > today).length;
      if (!n) continue;
      if (kind === 'income') inc += n * s.amount; else out -= n * s.amount;
    }
    return { inc: round2(inc), out: round2(out) };
  });
  const history = monthlyHistory(transactions, kindOf, month, base).slice(-lookback);
  const cashAssets = assets.filter(a => a.kind !== 'debt' && a.type === 'cash');
  const cash0 = cashStart ?? round2(cashAssets.reduce((s, a) => s + assetValue(a, today), 0));
  const ends = months.map(m => `${m}-${String(lastDay(m)).padStart(2, '0')}`);
  const things = assets.filter(a => a.kind !== 'debt' && a.type !== 'cash');
  const other = ends.map(d => round2(things.reduce((s, a) => s + assetValue(a, d), 0)));
  const debts = ends.map(d => round2(assets.filter(a => a.kind === 'debt').reduce((s, a) => s + debtBalance(a, d), 0)));
  return { months, varScale, fixed, history, cash0, cashFromAssets: cashStart == null && cashAssets.length > 0, other, debts };
}
