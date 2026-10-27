// Premoženje (z amortizacijo) in dolgovi (z odplačevanjem). Vse vrednosti se izračunajo za izbran datum.

/** Vrste premoženja s privzetim načinom amortizacije (uporabnik jih lahko spremeni). */
export const ASSET_TYPES = {
  car: { label: 'Avto / motor', emoji: '🚗', method: 'declining', rate: 0.15, residual: 0 },
  bike: { label: 'Kolo / šport', emoji: '🚲', method: 'declining', rate: 0.15, residual: 0 },
  computer: { label: 'Računalnik', emoji: '💻', method: 'linear', life: 4, residual: 0 },
  phone: { label: 'Telefon / elektronika', emoji: '📱', method: 'linear', life: 3, residual: 0 },
  watch: { label: 'Ura / nakit', emoji: '⌚', method: 'declining', rate: 0.05, residual: 0 },
  property: { label: 'Nepremičnina', emoji: '🏠', method: 'none' },
  cash: { label: 'Denar / račun', emoji: '💶', method: 'manual' },
  investment: { label: 'Naložbe', emoji: '📈', method: 'manual' },
  other: { label: 'Drugo', emoji: '📦', method: 'linear', life: 5, residual: 0 },
};

export const DEBT_TYPES = {
  loan: { label: 'Kredit', emoji: '🏦', method: 'amortized' },
  leasing: { label: 'Leasing', emoji: '🚙', method: 'amortized' },
  card: { label: 'Kreditna kartica', emoji: '💳', method: 'manual' },
  person: { label: 'Dolg osebi', emoji: '🤝', method: 'manual' },
  other: { label: 'Drugo', emoji: '📄', method: 'manual' },
};

export const METHODS = {
  linear: 'Enakomerno (linearno)',
  declining: 'Odstotek na leto (padajoče)',
  none: 'Ne izgublja vrednosti',
  manual: 'Ročno vpisujem vrednost',
};

const round2 = n => Math.round(n * 100) / 100;
const parse = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addYears = (iso, n) => { const [y, m, d] = iso.split('-'); return `${Number(y) + n}-${m}-${d}`; };

/** Leta med datumoma po koledarju: cela leta do zadnje obletnice + delež do naslednje. */
function yearsBetween(a, b) {
  if (b <= a) return 0;
  let whole = Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  if (addYears(a, whole) > b) whole--;
  const from = parse(addYears(a, whole)), to = parse(addYears(a, whole + 1));
  return whole + (parse(b) - from) / (to - from);
}

/** Vrednost premoženja na datum `at`. */
export function assetValue(a, at) {
  const price = a.price ?? 0;
  const residual = Math.min(a.residual ?? 0, price);
  if (a.method === 'manual') return round2(a.value ?? price);
  if (a.method === 'none' || !a.purchaseDate) return round2(price);
  const y = yearsBetween(a.purchaseDate, at);
  if (a.method === 'linear') {
    if (!(a.life > 0)) return round2(price);
    return round2(price - (price - residual) * Math.min(1, y / a.life));
  }
  if (a.method === 'declining') return round2(Math.max(residual, price * (1 - (a.rate ?? 0)) ** y));
  return round2(price);
}

/** Za koliko bo premoženje v naslednjem letu izgubilo vrednost. */
export const lossNextYear = (a, today) => round2(assetValue(a, today) - assetValue(a, addYears(today, 1)));

const monthsBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
};

/**
 * Stanje dolga na datum `at`. Pri obročnem odplačevanju: vsak mesec od začetka se prištejejo obresti
 * (letna mera / 12) in odšteje obrok. Pri ročnem je stanje tisto, kar vpišeš.
 */
export function debtBalance(d, at) {
  if (d.method !== 'amortized') return round2(d.balance ?? d.amount ?? 0);
  if (!d.startDate || at < d.startDate) return round2(d.amount ?? 0);
  const r = (d.rate ?? 0) / 12;
  let bal = d.amount ?? 0;
  for (let i = 0, n = monthsBetween(d.startDate, at); i < n && bal > 0; i++) bal = bal * (1 + r) - (d.payment ?? 0);
  return round2(Math.max(0, bal));
}

/** Kdaj bo dolg odplačan: { months, date } ali null, če obrok ne pokrije obresti. */
export function payoff(d, today) {
  if (d.method !== 'amortized' || !(d.payment > 0)) return null;
  let bal = debtBalance(d, today);
  if (bal <= 0) return { months: 0, date: today };
  const r = (d.rate ?? 0) / 12;
  if (bal * r >= d.payment) return null;
  let months = 0, interest = 0;
  while (bal > 0 && months < 1200) {
    interest += bal * r;
    bal = bal * (1 + r) - d.payment;
    months++;
  }
  const [y, m] = today.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  return { months, date: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`, interest: round2(interest) };
}

/** Seštevki na datum: premoženje, dolgovi, neto. */
export function totals(items, at) {
  let assets = 0, debts = 0;
  for (const x of items) {
    if (x.kind === 'debt') debts += debtBalance(x, at);
    else assets += assetValue(x, at);
  }
  return { assets: round2(assets), debts: round2(debts), net: round2(assets - debts) };
}
