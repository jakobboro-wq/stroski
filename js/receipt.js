// Branje računa iz besedila, ki ga prebere OCR na napravi. Brez dostopa do brskalnika, da se da preizkusiti.

import { normalize, matchRule } from './categorize.js';

// Znesek: 12,34 ali 1.234,56 (OCR včasih vrine presledek ob vejici). Lahko z minusom (popust).
const AMOUNT = /(-\s?)?(\d{1,3}(?:[.\s]\d{3})*|\d+)\s?[,.]\s?(\d{2})(?!\d)/g;
// Vrstice, ki niso postavke (vsote, davki, plačilo, zvestoba). Primerja se z normaliziranim besedilom.
const NOT_ITEM = /datum|skupaj|za placilo|placilo|placano|znesek|total|suma|ddv|osnova|davek|davcn|stopnja|neto|bruto|gotovina|vracilo|drobiz|prejeto|kartic|maestro|visa|mastercard|debit|zoi|eor|blagajn|racun st|st\. racuna|tock|prihran|ugodnost|saldo|tel\.|www\.|d\.o\.o|d\.d\./;
const TOTAL_KEYS = [/skupaj za placilo/, /za placilo/, /znesek racuna/, /^skupaj\b/, /\btotal\b/, /\bskupaj\b/, /\bznesek\b/, /\bsuma\b/];
const END_OF_ITEMS = /za placilo|^skupaj\b|\btotal\b|znesek racuna/;
// Datumi in ure niso zneski (10.11.2026 bi se sicer prebral kot 10,11).
const DATE_TIME = /\b\d{1,2}\s?[./-]\s?\d{1,2}\s?[./-]\s?\d{2,4}\b|\b\d{1,2}:\d{2}(:\d{2})?\b/g;

/** Vsi zneski v vrstici kot števila. */
export function amountsIn(line) {
  return [...line.replace(DATE_TIME, ' ').matchAll(AMOUNT)].map(m => {
    const whole = m[2].replace(/[.\s]/g, '');
    return (m[1] ? -1 : 1) * Number(`${whole}.${m[3]}`);
  });
}

const round2 = v => Math.round(v * 100) / 100;

function findDate(lines, today) {
  for (const line of lines) {
    for (const m of line.matchAll(/(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./-]\s?(\d{4}|\d{2})(?!\d)/g)) {
      const d = +m[1], mo = +m[2];
      let y = +m[3];
      if (y < 100) y += 2000;
      if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000) continue;
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso <= today) return iso;
    }
  }
  return null;
}

function findTotal(lines) {
  for (const key of TOTAL_KEYS) {
    for (let i = 0; i < lines.length; i++) {
      const text = normalize(lines[i]);
      if (!key.test(text) || /ddv|osnova|davek|prihran/.test(text)) continue;
      // Znesek je lahko v isti vrstici ali v naslednji.
      const here = amountsIn(lines[i]).filter(v => v > 0);
      if (here.length) return here.at(-1);
      const next = lines[i + 1] && amountsIn(lines[i + 1]).filter(v => v > 0);
      if (next?.length && !/[a-z]{3}/.test(normalize(lines[i + 1]).replace(/eur/g, ''))) return next.at(-1);
    }
  }
  return null;
}

function findPayment(lines) {
  const text = normalize(lines.join(' '));
  // Najprej gotovina: »Pika kartica« ipd. je kartica zvestobe, ne plačilna.
  if (/gotovina|drobiz/.test(text)) return 'cash';
  if (/placilna kartica|placilo s kartico|kartica\s*[:=]?\s*\d|maestro|visa|mastercard|debit|contactless|brezstik|apple pay|google pay|revolut/.test(text)) return 'card';
  return null;
}

const titleCase = s => s.replace(/\S+/g, w => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()));

const cleanStore = line => titleCase(line
  .replace(/[\s,]+d\.\s?[od]\.(\s?o\.)?.*$/i, '')
  .replace(/[^\p{L}\d&.' -]/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, 40);
const storeName = (line, hit) => (hit.builtin ? (hit.pattern.length <= 3 ? hit.pattern.toUpperCase() : titleCase(hit.pattern)) : cleanStore(line));

/**
 * Trgovina iz glave računa. `rules`: tvoja pravila (dajo tudi kategorijo),
 * `names`: znana imena trgovin (samo za ime, ker si privzete kategorije morda izbrisal).
 */
function findStore(lines, rules, names) {
  const head = lines.slice(0, 8);
  for (const line of head) {
    const hit = matchRule(line, rules);
    if (hit) return { name: storeName(line, hit), categoryId: hit.categoryId };
  }
  for (const line of head) {
    const hit = matchRule(line, names);
    if (hit) return { name: storeName(line, hit), categoryId: null };
  }
  const first = head.find(l => (l.match(/\p{L}/gu) ?? []).length >= 3);
  return { name: first ? cleanStore(first) : '', categoryId: null };
}

/** Ime postavke brez količine, cene na enoto in davčne oznake. */
export function cleanItemName(text) {
  return text
    .replace(AMOUNT, ' ')
    .replace(/\b\d+([.,]\d+)?\s*(x|kos|kom|kg|g|l|ml)\b/gi, ' ')
    .replace(/\s[xX*]\s/g, ' ')
    .replace(/\s[A-E]\s*$/, '')
    .replace(/[|_=~*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ključ za zapomnitev kategorije postavke (brez številk, ker se teže in cene spreminjajo). */
const UNITS = new Set(['x', 'kos', 'kom', 'kg', 'g', 'l', 'ml', 'cl', 'dl']);
export const itemKey = name => normalize(cleanItemName(name)).replace(/[^a-z ]/g, ' ').split(' ')
  .filter(w => w.length >= 2 && !UNITS.has(w)).join(' ');

function findItems(lines) {
  const items = [];
  let pendingName = '';
  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    const text = normalize(line);
    if (!line) continue;
    // Po vsoti so samo še plačilo, davki in noga računa.
    if (started && END_OF_ITEMS.test(text)) break;
    const amounts = amountsIn(line);
    if (NOT_ITEM.test(text)) { pendingName = ''; continue; }
    const letters = (cleanItemName(line).match(/[a-zčšžćđ]/gi) ?? []).length;
    if (!amounts.length) {
      // Vrstica z imenom, cena je v naslednji (npr. Mercator: »1,000 KOS x 1,99   1,99 C«).
      if (letters >= 3) pendingName = cleanItemName(line);
      continue;
    }
    const amount = amounts.at(-1);
    let name = letters >= 3 ? cleanItemName(line) : pendingName;
    pendingName = '';
    if (!name) continue;
    if (amount < 0 || /popust|akcija|znizan/.test(text)) {
      // Popust zmanjša prejšnjo postavko, da se vsota ujema.
      if (items.length) items.at(-1).amount = round2(items.at(-1).amount - Math.abs(amount));
      continue;
    }
    if (amount === 0 || amount > 5000) continue;
    started = true;
    items.push({ name: name.slice(0, 60), amount });
  }
  return items;
}

/**
 * Prebere račun. Vrne trgovino, datum, skupni znesek, način plačila in postavke.
 * `itemRules`: zapomnjene kategorije postavk {ključ: categoryId}.
 */
export function parseReceipt(text, { rules = [], names = [], itemRules = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const store = findStore(lines, rules, names);
  const items = findItems(lines).map(i => ({ ...i, categoryId: itemRules[itemKey(i.name)] ?? null }));
  const itemsSum = round2(items.reduce((s, i) => s + i.amount, 0));
  let total = findTotal(lines);
  if (total == null) total = itemsSum || Math.max(0, ...lines.flatMap(amountsIn));
  return {
    store: store.name,
    storeCategoryId: store.categoryId,
    date: findDate(lines, today),
    total: round2(total),
    payment: findPayment(lines),
    items,
    itemsSum,
    matches: items.length > 0 && Math.abs(itemsSum - total) < 0.015,
  };
}

/**
 * Iz pregledanega računa naredi transakcije: ena na kategorijo, da so stroški pravilno razporejeni.
 * Razlika do skupnega zneska (neprebrane postavke) gre v kategorijo trgovine.
 */
export function receiptTransactions({ store, date, total, account, currency, storeCategoryId, items }, receiptId) {
  const groups = new Map();
  const add = (categoryId, amount, item) => {
    const g = groups.get(categoryId) ?? { amount: 0, items: [] };
    g.amount = round2(g.amount + amount);
    if (item) g.items.push(item);
    groups.set(categoryId, g);
  };
  for (const i of items) if (i.amount) add(i.categoryId || storeCategoryId, i.amount, { name: i.name, amount: i.amount });
  const rest = round2(total - [...groups.values()].reduce((s, g) => s + g.amount, 0));
  if (Math.abs(rest) >= 0.01) add(storeCategoryId, rest, null);
  return [...groups.entries()]
    .filter(([, g]) => Math.abs(g.amount) >= 0.01)
    .map(([categoryId, g]) => ({
      amount: -round2(g.amount),
      date,
      description: store || 'Račun',
      categoryId,
      categorySource: 'manual',
      account,
      currency,
      source: 'receipt',
      receiptId,
      items: g.items,
    }));
}

/** Ali je vrstica izpiska isto plačilo kot že vnesen račun (vsota vseh delov računa). */
export function receiptGroups(transactions) {
  const byId = new Map();
  for (const t of transactions) {
    if (t.source !== 'receipt' || !t.receiptId || t.account === 'Gotovina') continue;
    const g = byId.get(t.receiptId) ?? { id: t.receiptId, amount: 0, date: t.date, currency: t.currency };
    g.amount = round2(g.amount + t.amount);
    byId.set(t.receiptId, g);
  }
  return [...byId.values()];
}
