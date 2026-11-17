// Cene delnic in skladov: obdelava odgovora funkcije stock_chart (Yahoo Finance), pretvorba v evre,
// vrednost sklada iz vplačil in volatilnost portfelja. Brez brskalnika, da se da preizkusiti.

const round2 = v => Math.round(v * 100) / 100;
const isoDay = sec => new Date(sec * 1000).toISOString().slice(0, 10);

/** Oznaka za tečaj: EURUSD=X pove, koliko USD je 1 EUR. Za evre null. */
export const fxSymbol = currency => (!currency || currency === 'EUR' ? null : `EUR${currency}=X`);

/**
 * En element odgovora → { symbol, currency, name, price, date, history: [{ date, close }] } ali { symbol, error }.
 * Penny (GBp) se pretvori v funte. Manjkajoči dnevi (null) se izpustijo; en zapis na dan (zadnji).
 */
export function parseQuote(raw) {
  if (!raw || raw.error != null || raw.price == null) return { symbol: raw?.symbol, error: raw?.error ?? 'ni podatka' };
  const pence = raw.currency === 'GBp' || raw.currency === 'GBX';
  const k = pence ? 0.01 : 1;
  const byDay = new Map();
  (raw.t ?? []).forEach((t, i) => { const c = raw.c?.[i]; if (c != null && Number.isFinite(c)) byDay.set(isoDay(t), c * k); });
  const history = [...byDay].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
  return { symbol: raw.symbol, currency: pence ? 'GBP' : raw.currency, name: raw.name ?? null, price: raw.price * k, date: raw.time ? isoDay(raw.time) : history.at(-1)?.date ?? null, history };
}

/** Zadnja znana cena na dan `date` ali prej; null, če je dan pred začetkom zgodovine. */
export function priceOn(history, date) {
  let lo = 0, hi = history.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].date <= date) { best = history[mid].close; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Cena in zgodovina v evrih. fx: parseQuote za EURxxx=X (ali null pri evrih). Brez tečaja na dan se vzame najbližji prejšnji, sicer današnji. */
export function inEur(q, fx) {
  if (q.error || !fxSymbol(q.currency)) return q;
  if (!fx || fx.error) return { ...q, error: `ni tečaja za ${q.currency}` };
  const rate = d => priceOn(fx.history, d) ?? fx.history[0]?.close ?? fx.price;
  return { ...q, currency: 'EUR', price: q.price / fx.price, history: q.history.map(h => ({ date: h.date, close: h.close / rate(h.date) })) };
}

/** Sprememba cene v zadnjih `days` dneh (delež) ali null. */
export function changeSince(history, today, days) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  const then = priceOn(history, d.toISOString().slice(0, 10));
  const now = history.at(-1)?.close;
  return then && now ? now / then - 1 : null;
}

/**
 * Vrednost sklada po tržnih cenah: vsako vplačilo kupi enote po ceni tistega dne.
 * Če je vpisana vrednost z Revoluta (value, valueDate), se ta prenese naprej z gibanjem cene, vplačila po tem dnevu pa dodajo.
 * null, če za kakšen potreben dan ni cene (zgodovina prekratka) – takrat velja običajen izračun.
 */
export function fundMarketValue(fund, deposits, history, price, today) {
  const own = deposits.filter(d => d.fundId === fund.id && d.date <= today);
  const anchor = fund.value != null && fund.valueDate && fund.valueDate <= today ? fund.valueDate : null;
  let value = 0;
  if (anchor) {
    const p0 = priceOn(history, anchor);
    if (!p0) return null;
    value += fund.value * (price / p0);
  }
  for (const d of own) {
    if (anchor && d.date <= anchor) continue;
    const p = priceOn(history, d.date);
    if (!p) return null;
    value += d.amount * (price / p);
  }
  return round2(value);
}

/**
 * Letna volatilnost portfelja iz dnevnih cen (zadnjih ~252 trgovalnih dni).
 * items: [{ history, weight }] (teža = trenutna vrednost v evrih). Upošteva povezanost delnic,
 * ker računa donose skupnega indeksa. null pri manj kot 60 skupnih dneh.
 */
export function portfolioVolatility(items) {
  const use = items.filter(x => x.weight > 0 && x.history.length > 1);
  if (!use.length) return null;
  const total = use.reduce((s, x) => s + x.weight, 0);
  const dates = [...new Set(use.flatMap(x => x.history.map(h => h.date)))].sort().slice(-253);
  const start = dates[0];
  if (use.some(x => priceOn(x.history, start) == null)) return null;
  const index = dates.map(d => use.reduce((s, x) => s + (x.weight / total) * (priceOn(x.history, d) / priceOn(x.history, start)), 0));
  const r = index.slice(1).map((v, i) => Math.log(v / index[i]));
  if (r.length < 60) return null;
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / (r.length - 1));
  return sd * Math.sqrt(252);
}
