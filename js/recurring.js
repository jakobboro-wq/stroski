// Ponavljajoči stroški in prihodki (naročnine, zavarovanje, najemnina, plača …).
// Predloga (series) hrani znesek, kategorijo in ritem; ko pride datum, aplikacija sama doda transakcijo.

export const EVERY = {
  week: { label: 'Vsak teden', short: 'tedensko', perMonth: 52 / 12 },
  month: { label: 'Vsak mesec', short: 'mesečno', perMonth: 1 },
  quarter: { label: 'Vsake 3 mesece', short: 'na 3 mesece', perMonth: 1 / 3 },
  year: { label: 'Vsako leto', short: 'letno', perMonth: 1 / 12 },
};

const iso = d => d.toISOString().slice(0, 10);

/** n-ta ponovitev od začetnega datuma. Pri mesecih ostane isti dan (31. → zadnji dan krajših mesecev). */
export function occurrence(anchor, every, n) {
  const [y, m, d] = anchor.split('-').map(Number);
  if (every === 'week') return iso(new Date(Date.UTC(y, m - 1, d + 7 * n)));
  const total = m - 1 + { month: 1, quarter: 3, year: 12 }[every] * n;
  const yy = y + Math.floor(total / 12);
  const mm = total % 12;
  const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(yy, mm, Math.min(d, lastDay))));
}

/** Datumi ponovitev med from in to (vključno), brez začetne (n = 0), ki je že vnesena transakcija. */
export function occurrencesBetween(series, from, to) {
  const out = [];
  for (let n = 1; n < 2000; n++) {
    const date = occurrence(series.anchor, series.every, n);
    if (date > to || (series.until && date > series.until)) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/** Prva ponovitev po datumu `after` (null, če je ponavljanje končano). */
export function nextOccurrence(series, after) {
  for (let n = 1; n < 2000; n++) {
    const date = occurrence(series.anchor, series.every, n);
    if (series.until && date > series.until) return null;
    if (date > after) return date;
  }
  return null;
}

/** Transakcije, ki bi morale do danes nastati iz predloge. Id je določen z datumom, zato dve napravi ne ustvarita dvojnikov. */
export function dueTransactions(series, today) {
  return occurrencesBetween(series, series.anchor, today).map(date => ({
    id: `${series.id}:${date}`,
    seriesId: series.id,
    date,
    amount: series.amount,
    currency: series.currency,
    description: series.description,
    account: series.account,
    categoryId: series.categoryId,
    categorySource: 'manual',
    source: 'recurring',
  }));
}

/** Znesek ponovitev predloge v mesecu "YYYY-MM" (predznačen kot transakcija). */
export function amountInMonth(series, month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = occurrencesBetween(series, `${month}-01`, `${month}-${String(last).padStart(2, '0')}`);
  if (series.anchor.startsWith(month)) dates.push(series.anchor);
  return dates.length ? dates.length * series.amount : 0;
}
