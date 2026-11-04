// Lov na naročnine: v transakcijah poišče plačila istemu prejemniku, ki se ponavljajo v rednem ritmu
// in s podobnim zneskom. Vse se izračuna na napravi, nič se ne pošilja nikamor.

import { normalize } from './categorize.js';
import { EVERY } from './recurring.js';

// typical: običajen razmik v dneh, allowed: razmik, ki ga še dopustimo (vikendi, krajši meseci),
// min: najmanj plačil za predlog, sure: od koliko plačil dalje ni več le »mogoče«,
// grace: koliko dni po zadnjem plačilu še velja za aktivno (po tem je verjetno že ukinjeno).
const CADENCES = [
  { every: 'week', typical: [6, 8], allowed: [5, 9], min: 4, sure: 4, grace: 14 },
  { every: 'month', typical: [26, 35], allowed: [24, 38], min: 2, sure: 3, grace: 45 },
  { every: 'quarter', typical: [85, 98], allowed: [80, 103], min: 2, sure: 3, grace: 125 },
  { every: 'year', typical: [350, 380], allowed: [340, 390], min: 2, sure: 3, grace: 400 },
];

const dayNumber = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
const median = list => {
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const within = (v, [lo, hi]) => v >= lo && v <= hi;

/** Podražitev ali popust naj ostane isto plačilo, 1 € in 10 € pri istem trgovcu pa ne. */
const similarAmount = (a, b) => Math.abs(Math.abs(a) - Math.abs(b)) <= Math.max(0.2 * Math.abs(b), 0.5);

/** Ime prejemnika brez sklicev: »PAYPAL *SPOTIFY 12345« in »PAYPAL *SPOTIFY 67890« sta isti prejemnik. */
export function merchantKey(description) {
  const clean = normalize(description).replace(/[^\p{L}\p{N}\s.*&/-]/gu, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const kept = words.filter(w => !/^\d+$/.test(w) && !(/\d/.test(w) && w.length >= 5));
  return (kept.length ? kept : words).join(' ');
}

/** Plačila istega prejemnika razdeli po znesku, ker en prejemnik lahko zaračunava več različnih naročnin. */
function splitByAmount(sorted) {
  const groups = [];
  for (const t of sorted) {
    const fits = groups.filter(g => similarAmount(t.amount, g.at(-1).amount));
    const best = fits.sort((a, b) => Math.abs(a.at(-1).amount - t.amount) - Math.abs(b.at(-1).amount - t.amount))[0];
    if (best) best.push(t);
    else groups.push([t]);
  }
  return groups;
}

function cadenceOf(group) {
  const days = group.map(t => dayNumber(t.date));
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  if (!gaps.length) return null;
  const typical = median(gaps);
  const cadence = CADENCES.find(c => within(typical, c.typical));
  if (!cadence || group.length < cadence.min) return null;
  const regular = gaps.filter(g => within(g, cadence.allowed)).length;
  return regular / gaps.length >= 0.75 ? cadence : null;
}

/**
 * Najde verjetna ponavljajoča se plačila, ki še niso označena. Najdražja so prva.
 * asOf je datum zadnjega uvoza: če izpiska dolgo nisi uvozil, se plačila ne smejo zdeti ukinjena.
 */
export function detectSubscriptions(transactions, { kindOf, series = [], currency = 'EUR', today }) {
  const imported = transactions.filter(t => t.source === 'csv').map(t => t.date).sort();
  const asOf = dayNumber(imported.at(-1) ?? today);

  const byMerchant = new Map();
  for (const t of transactions) {
    if (t.amount >= 0 || t.seriesId || t.currency !== currency || !t.description || kindOf(t.categoryId) !== 'expense') continue;
    const key = merchantKey(t.description);
    if (!key) continue;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key).push(t);
  }

  const found = [];
  for (const [key, all] of byMerchant) {
    all.sort((a, b) => a.date.localeCompare(b.date));
    for (const group of splitByAmount(all)) {
      const cadence = cadenceOf(group);
      if (!cadence) continue;
      const first = group[0];
      const last = group.at(-1);
      if (group.length === 2 && Math.abs(first.amount - last.amount) > 0.05 * Math.abs(first.amount)) continue;
      if (asOf - dayNumber(last.date) > cadence.grace) continue;
      // Pri trgovcu, kjer pogosto kupuješ, je nekaj podobnih zneskov v rednih razmikih le naključje.
      const sameSpan = all.filter(t => t.date >= first.date && t.date <= last.date).length;
      if (group.length / sameSpan < 1 / 3) continue;
      if (series.some(s => merchantKey(s.description) === key && similarAmount(last.amount, s.amount))) continue;

      const distinct = new Set(group.map(t => t.amount)).size;
      found.push({
        id: `${key}|${cadence.every}`,
        key,
        every: cadence.every,
        sure: group.length >= cadence.sure,
        count: group.length,
        amount: last.amount,
        perYear: Math.abs(last.amount) * EVERY[cadence.every].perMonth * 12,
        lastDate: last.date,
        description: last.description,
        categoryId: last.categoryId,
        account: last.account,
        currency,
        txIds: group.map(t => t.id),
        priceUp: distinct <= 3 && Math.abs(last.amount) > Math.abs(first.amount) ? { from: Math.abs(first.amount), to: Math.abs(last.amount) } : null,
      });
    }
  }
  return found.sort((a, b) => b.perYear - a.perYear);
}

/** Potrjena naročnina, ki ji pripada to uvoženo plačilo (null, če je ni). */
export function matchSeries(t, series) {
  if (t.amount >= 0) return null;
  const key = merchantKey(t.description);
  const fits = series.filter(s => s.imported && s.matchKey === key && s.currency === t.currency && similarAmount(t.amount, s.amount));
  return fits.sort((a, b) => Math.abs(a.amount - t.amount) - Math.abs(b.amount - t.amount))[0] ?? null;
}
