// Izračuni za pregled: poraba po mesecih in kategorijah, povprečja.

export const monthOf = date => date.slice(0, 7);

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Seštevki po mesecih v osnovni valuti. Prenosi med računi se ne štejejo.
 * Pozitiven znesek v kategoriji stroška (npr. vračilo) zmanjša porabo te kategorije.
 */
export function buildIndex(transactions, kindOf, baseCurrency) {
  const months = new Map();
  let first = null;
  let otherCurrency = 0;
  for (const t of transactions) {
    if (t.currency !== baseCurrency) { otherCurrency++; continue; }
    const kind = kindOf(t.categoryId);
    if (kind === 'transfer') continue;
    const m = monthOf(t.date);
    if (!first || m < first) first = m;
    let e = months.get(m);
    if (!e) months.set(m, (e = { spend: 0, fixed: 0, income: 0, count: 0, byCat: new Map() }));
    e.count++;
    if (kind === 'income') e.income += t.amount;
    else {
      e.spend -= t.amount;
      if (t.seriesId) e.fixed -= t.amount; // ponavljajoči strošek
      e.byCat.set(t.categoryId, (e.byCat.get(t.categoryId) ?? 0) - t.amount);
    }
  }
  return { months, first, otherCurrency };
}

/** Povprečje zadnjih n mesecev pred `month` (meseci brez transakcij štejejo kot 0). null, če ni zgodovine. */
export function average(index, month, pick, n = 6) {
  if (!index.first || month <= index.first) return null;
  let sum = 0, count = 0;
  for (let i = 1; i <= n; i++) {
    const key = addMonths(month, -i);
    if (key < index.first) break;
    sum += pick(index.months.get(key));
    count++;
  }
  return count ? sum / count : null;
}

export const spendOf = e => e?.spend ?? 0;
/** Poraba brez ponavljajočih stroškov (hrana, izhodi …) – osnova za oceno prihodnjih mesecev. */
export const variableOf = e => (e?.spend ?? 0) - (e?.fixed ?? 0);
export const incomeOf = e => e?.income ?? 0;
export const catSpendOf = id => e => e?.byCat.get(id) ?? 0;

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
