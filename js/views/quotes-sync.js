// Samodejne cene delnic in skladov z oznako (ticker): enkrat na dan prek Supabase, v evrih.
// Cene so javni podatki: zgodovina je v predpomnilniku te naprave, trenutna vrednost pa v naložbi (sinhronizira se).

import { state, saveInvestment } from '../store.js';
import * as cloud from '../cloud.js';
import { fxSymbol, parseQuote, inEur, fundMarketValue, portfolioVolatility, changeSince } from '../quotes.js';
import { position, stockValue } from '../stocks.js';
import { todayISO, toast } from '../ui.js';

const CACHE_KEY = 'quotes-cache';
const RANGE = '5y'; // dovolj za stara vplačila v sklade
export const quoteStatus = { busy: false, error: null };

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') ?? { at: null, data: {} }; } catch { return { at: null, data: {} }; }
}
function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* predpomnilnik ni nujen */ }
}

const historyOf = q => q.history.map(([date, close]) => ({ date, close }));
const tickered = () => state.investments.filter(x => (x.kind === 'stock' || x.kind === 'fund') && x.ticker);
const norm = t => t.trim().toUpperCase();

/** Cena v evrih za oznako iz predpomnilnika: { price, date, history, name } ali null. */
export const cachedQuote = ticker => (ticker ? readCache().data[norm(ticker)] ?? null : null);

/** Sprememba cene v zadnjem letu za oznako (delež) ali null. */
export const yearChange = ticker => { const q = cachedQuote(ticker); return q ? changeSince(historyOf(q), todayISO(), 365) : null; };

/**
 * Prenese cene (največ enkrat na dan, razen force) in posodobi vrednosti naložb.
 * Tiho ne naredi nič, če ni oznak ali prijave.
 */
export async function refreshQuotes({ force = false } = {}) {
  const today = todayISO();
  const items = tickered();
  if (!items.length || !cloud.currentUser() || quoteStatus.busy) return;
  const cache = readCache();
  const symbols = [...new Set(items.map(x => norm(x.ticker)))];
  if (!force && cache.at === today && symbols.every(s => cache.data[s])) return;
  quoteStatus.busy = true;
  quoteStatus.error = null;
  document.dispatchEvent(new CustomEvent('quotes-status'));
  try {
    const raw = (await cloud.stockChart(symbols, RANGE)).map(parseQuote);
    const fxNeeded = [...new Set(raw.filter(q => !q.error).map(q => fxSymbol(q.currency)).filter(Boolean))];
    const fx = fxNeeded.length ? (await cloud.stockChart(fxNeeded, RANGE)).map(parseQuote) : [];
    const data = {};
    const failed = [];
    for (const q of raw) {
      const e = inEur(q, fx.find(f => f.symbol === fxSymbol(q.currency)));
      if (e.error) { failed.push(q.symbol); continue; }
      data[q.symbol] = { price: e.price, date: e.date, name: e.name, history: e.history.map(h => [h.date, Math.round(h.close * 1e4) / 1e4]) };
    }
    writeCache({ at: today, data: { ...cache.data, ...data } });
    await applyPrices(today);
    if (failed.length) quoteStatus.error = `Ni cene za: ${failed.join(', ')} (preveri oznako).`;
  } catch (err) {
    quoteStatus.error = err.message;
    if (force) toast(err.message);
  } finally {
    quoteStatus.busy = false;
    document.dispatchEvent(new CustomEvent('quotes-status'));
  }
}

/** Zapiše današnje vrednosti v delnice (cena na kos) in sklade (vrednost na dan). */
async function applyPrices(today) {
  const deposits = state.investments.filter(x => x.kind === 'deposit');
  for (const x of tickered()) {
    const q = cachedQuote(x.ticker);
    if (!q) continue;
    if (x.kind === 'stock') {
      if (x.price != null && Math.abs(x.price - q.price) < 1e-6 && x.priceDate === today) continue;
      await saveInvestment({ ...x, price: q.price, priceDate: today, priceAuto: true });
    } else {
      // Ročno vpisana vrednost (value, valueDate) ostane sidro; tržna se zapiše posebej.
      const value = fundMarketValue(x, deposits, historyOf(q), q.price, today);
      if (value == null || (x.marketDate === today && Math.abs((x.marketValue ?? 0) - value) < 0.005)) continue;
      await saveInvestment({ ...x, marketValue: value, marketDate: today });
    }
  }
}

/** Letna volatilnost naložb z oznako iz zadnjega leta cen (za simulacijo) ali null. */
export function investVolatility() {
  const trades = state.investments.filter(x => x.kind === 'trade');
  const items = tickered().map(x => {
    const q = cachedQuote(x.ticker);
    if (!q) return null;
    const weight = x.kind === 'stock' ? stockValue(x, position(trades.filter(t => t.stockId === x.id))) : x.marketValue ?? x.value ?? 0;
    return { history: historyOf(q), weight };
  }).filter(Boolean);
  return portfolioVolatility(items);
}
