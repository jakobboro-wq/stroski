// Naložbe: vplačila, trenutna vrednost in izračun rasti po predpostavljenih letnih donosih.
// Donos je predpostavka za izračun, ne napoved: dejanski trg lahko raste počasneje ali pade.

import { addMonths } from './stats.js';

export const DEFAULT_RATE = 0.07;
export const RATE_SPREAD = 0.03; // razpon: predpostavljen donos ± 3 odstotne točke

const round2 = n => Math.round(n * 100) / 100;
const sum = list => list.reduce((s, d) => s + d.amount, 0);

const depositsOf = (fund, deposits, at) => deposits.filter(d => d.fundId === fund.id && d.date <= at);

export const investedOf = (fund, deposits, at) => round2(sum(depositsOf(fund, deposits, at)));

/** Vpisana vrednost z Revoluta + kasnejša vplačila; brez vpisane vrednosti kar vsota vplačil (brez ocene donosa). */
export function currentValue(fund, deposits, at) {
  const own = depositsOf(fund, deposits, at);
  if (fund.value == null || !fund.valueDate || fund.valueDate > at) return round2(sum(own));
  return round2(fund.value + sum(own.filter(d => d.date > fund.valueDate)));
}

const monthlyFactor = annual => (1 + annual) ** (1 / 12);

/** Mesečne točke od danes naprej (i = 0 je danes). Mesečni znesek se vplača na koncu vsakega naslednjega meseca. */
export function projectFund(fund, deposits, today, months) {
  const rate = fund.rate ?? DEFAULT_RATE;
  const factors = { low: monthlyFactor(Math.max(0, rate - RATE_SPREAD)), mid: monthlyFactor(rate), high: monthlyFactor(rate + RATE_SPREAD) };
  const monthly = fund.monthly ?? 0;
  const start = currentValue(fund, deposits, today);
  const invested = investedOf(fund, deposits, today);
  const v = { low: start, mid: start, high: start };
  const points = [{ invested, ...v }];
  for (let i = 1; i <= months; i++) {
    for (const k of ['low', 'mid', 'high']) v[k] = v[k] * factors[k] + monthly;
    points.push({ invested: invested + monthly * i, ...v });
  }
  return points;
}

/** Skupna pričakovana vrednost izbranih naložb čez n let (osrednji scenarij). */
export const valueInYears = (funds, deposits, today, years) =>
  round2(funds.reduce((s, f) => s + projectFund(f, deposits, today, years * 12).at(-1).mid, 0));

/**
 * Točke za graf: pretekli meseci (samo vloženo) in prihodnost (vloženo + razpon).
 * [{ month, invested, low, mid, high }], kjer so low/mid/high v preteklosti null.
 */
export function projectionSeries(funds, deposits, today, years) {
  const ids = new Set(funds.map(f => f.id));
  const own = deposits.filter(d => ids.has(d.fundId) && d.date <= today);
  const nowMonth = today.slice(0, 7);
  const out = [];
  const first = own.map(d => d.date.slice(0, 7)).sort()[0];
  if (first) {
    for (let m = first; m < nowMonth; m = addMonths(m, 1)) {
      out.push({ month: m, invested: round2(sum(own.filter(d => d.date.slice(0, 7) <= m))), low: null, mid: null, high: null });
    }
  }
  const perFund = funds.map(f => projectFund(f, deposits, today, years * 12));
  for (let i = 0; i <= years * 12; i++) {
    const total = { invested: 0, low: 0, mid: 0, high: 0 };
    for (const points of perFund) for (const k of Object.keys(total)) total[k] += points[i][k];
    out.push({ month: addMonths(nowMonth, i), invested: round2(total.invested), low: round2(total.low), mid: round2(total.mid), high: round2(total.high) });
  }
  return out;
}
