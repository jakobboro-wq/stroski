// Stanje aplikacije v pomnilniku + shranjevanje v IndexedDB.
// Vsak zapis ima updatedAt, izbrisi se beležijo v tombstones — oboje potrebuje sinhronizacija.

import * as db from './db.js';
import { DEFAULT_CATEGORIES, RULES_VERSION, builtinRules, guessCategory, matchRule, normalize } from './categorize.js';
import { SYNCED_STORES } from './merge.js';

export const BASE_CURRENCY = 'EUR';
export const state = { transactions: [], categories: [], rules: [], tombstones: emptyTombstones() };

const uid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
function emptyTombstones() { return { transactions: {}, categories: {}, rules: {} }; }
const DEFAULT_IDS = new Set(DEFAULT_CATEGORIES.map(c => c.id));

/** Obvesti prikaz, da so se podatki spremenili. */
export const changed = () => document.dispatchEvent(new CustomEvent('data-changed'));

/** Sprememba na tej napravi: osveži prikaz in sproži sinhronizacijo. */
function localChange() {
  changed();
  document.dispatchEvent(new CustomEvent('local-change'));
}

async function bury(store, ids) {
  const now = Date.now();
  for (const id of ids) state.tombstones[store][id] = now;
  await db.put('meta', { key: 'tombstones', value: state.tombstones });
}

export async function load() {
  let [transactions, categories, rules, meta] = await Promise.all(['transactions', 'categories', 'rules', 'meta'].map(db.getAll));
  if (!categories.length) {
    categories = DEFAULT_CATEGORIES.map((c, order) => ({ ...c, order }));
    await db.putMany('categories', categories);
  }
  state.transactions = transactions;
  state.categories = categories.sort((a, b) => a.order - b.order);
  state.rules = rules;
  state.tombstones = { ...emptyTombstones(), ...meta.find(m => m.key === 'tombstones')?.value };
  navigator.storage?.persist?.();

  if (meta.find(m => m.key === 'rulesVersion')?.value !== RULES_VERSION) {
    await reapplyRules();
    await db.put('meta', { key: 'rulesVersion', value: RULES_VERSION });
  }
}

/** Ponovno razvrsti uvožene transakcije, ki jih nisi ročno razvrstil (npr. po izboljšavi vgrajenih pravil). */
async function reapplyRules() {
  const rules = allRules();
  const changedTx = [];
  for (const t of state.transactions) {
    if (t.source !== 'csv' || t.categorySource === 'manual') continue;
    const { categoryId, source } = guessCategory(t, rules);
    if (categoryId !== t.categoryId) {
      Object.assign(t, { categoryId, categorySource: source, updatedAt: Date.now() });
      changedTx.push(t);
    }
  }
  if (changedTx.length) await db.putMany('transactions', changedTx);
}

export const category = id => state.categories.find(c => c.id === id) ?? state.categories.find(c => c.id === 'other');
export const kindOf = id => category(id)?.kind ?? 'expense';

export function allRules() {
  const ids = new Set(state.categories.map(c => c.id));
  return [...state.rules, ...builtinRules()].filter(r => ids.has(r.categoryId));
}

export function accounts() {
  const set = new Set(['Revolut', 'Gotovina']);
  for (const t of state.transactions) if (t.account) set.add(t.account);
  return [...set];
}

export async function saveTransactions(list) {
  const now = Date.now();
  const byId = new Map(state.transactions.map(t => [t.id, t]));
  for (const t of list) {
    t.id ??= uid();
    t.createdAt ??= now;
    t.updatedAt = now;
    byId.set(t.id, t);
  }
  state.transactions = [...byId.values()];
  await db.putMany('transactions', list);
  localChange();
}

export async function deleteTransactions(ids) {
  const set = new Set(ids);
  state.transactions = state.transactions.filter(t => !set.has(t.id));
  await Promise.all([db.removeMany('transactions', ids), bury('transactions', ids)]);
  localChange();
}

/** Shrani kategorijo brez ponovnega izrisa (urejanje imena ne sme izgubiti fokusa). */
export async function saveCategory(c) {
  c.id ??= uid();
  c.order ??= Math.max(-1, ...state.categories.map(x => x.order)) + 1;
  c.updatedAt = Date.now();
  const i = state.categories.findIndex(x => x.id === c.id);
  if (i >= 0) state.categories[i] = c;
  else state.categories.push(c);
  await db.put('categories', c);
  document.dispatchEvent(new CustomEvent('local-change'));
}

/** Izbriše kategorijo; njene transakcije gredo v »Ostalo« (oz. »Drugi prihodki«). */
export async function deleteCategory(id) {
  const c = state.categories.find(x => x.id === id);
  if (!c) return;
  const target = c.kind === 'income' ? 'income_other' : 'other';
  const now = Date.now();
  const moved = state.transactions.filter(t => t.categoryId === id);
  moved.forEach(t => Object.assign(t, { categoryId: target, updatedAt: now }));
  const rules = state.rules.filter(r => r.categoryId === id);
  state.categories = state.categories.filter(x => x.id !== id);
  state.rules = state.rules.filter(r => r.categoryId !== id);
  await Promise.all([
    db.removeMany('categories', [id]),
    db.removeMany('rules', rules.map(r => r.id)),
    db.putMany('transactions', moved),
  ]);
  await bury('categories', [id]);
  await bury('rules', rules.map(r => r.id));
  localChange();
}

/** Doda pravilo in ga uporabi na obstoječih transakcijah, ki jih nisi ročno razvrstil. Vrne število spremenjenih. */
export async function addRule(pattern, categoryId) {
  const now = Date.now();
  const rule = { id: uid(), pattern: normalize(pattern), categoryId, createdAt: now, updatedAt: now };
  if (!rule.pattern) return 0;
  const replaced = state.rules.filter(r => r.pattern === rule.pattern);
  state.rules = [...state.rules.filter(r => r.pattern !== rule.pattern), rule];

  const affected = state.transactions.filter(t =>
    t.categorySource !== 'manual' && t.categoryId !== categoryId && matchRule(t.description, [rule]));
  affected.forEach(t => Object.assign(t, { categoryId, categorySource: 'rule', updatedAt: now }));

  await Promise.all([
    db.removeMany('rules', replaced.map(r => r.id)),
    db.put('rules', rule),
    db.putMany('transactions', affected),
  ]);
  await bury('rules', replaced.map(r => r.id));
  localChange();
  return affected.length;
}

export async function deleteRule(id) {
  state.rules = state.rules.filter(r => r.id !== id);
  await Promise.all([db.removeMany('rules', [id]), bury('rules', [id])]);
  localChange();
}

// ---------- Sinhronizacija ----------

export const snapshot = () => ({
  transactions: state.transactions,
  categories: state.categories,
  rules: state.rules,
  tombstones: state.tombstones,
});

/** Zamenja lokalne podatke z združenimi iz oblaka. */
export async function applySnapshot(data) {
  for (const s of SYNCED_STORES) {
    await db.clear(s);
    await db.putMany(s, data[s]);
  }
  await db.put('meta', { key: 'tombstones', value: data.tombstones });
  state.transactions = data.transactions;
  state.categories = [...data.categories].sort((a, b) => a.order - b.order);
  state.rules = data.rules;
  state.tombstones = data.tombstones;
  changed();
}

// ---------- Varnostna kopija in brisanje ----------

export function exportData() {
  const { transactions, categories, rules } = state;
  return { app: 'stroski', version: 1, exportedAt: new Date().toISOString(), transactions, categories, rules };
}

/** Obnovi kopijo: obnovljeni zapisi postanejo najnovejši, vse ostalo se izbriše (tudi na drugih napravah). */
export async function importData(data) {
  if (data?.app !== 'stroski' || !Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
    throw new Error('To ni varnostna kopija aplikacije Stroški.');
  }
  const now = Date.now();
  const restored = {
    transactions: data.transactions.map(t => ({ ...t, updatedAt: now })),
    categories: data.categories.map(c => ({ ...c, updatedAt: now })),
    rules: (data.rules ?? []).map(r => ({ ...r, updatedAt: now })),
  };
  for (const s of SYNCED_STORES) {
    const keep = new Set(restored[s].map(r => r.id));
    for (const r of state[s]) if (!keep.has(r.id)) state.tombstones[s][r.id] = now;
    for (const id of keep) delete state.tombstones[s][id];
  }
  await applySnapshot({ ...restored, tombstones: state.tombstones });
  document.dispatchEvent(new CustomEvent('local-change'));
}

/** Izbriše vse podatke (tudi v oblaku ob naslednji sinhronizaciji); kategorije se ponastavijo na privzete. */
export async function clearAll() {
  const now = Date.now();
  for (const t of state.transactions) state.tombstones.transactions[t.id] = now;
  for (const r of state.rules) state.tombstones.rules[r.id] = now;
  for (const c of state.categories) if (!DEFAULT_IDS.has(c.id)) state.tombstones.categories[c.id] = now;
  const categories = DEFAULT_CATEGORIES.map((c, order) => ({ ...c, order, updatedAt: now }));
  await applySnapshot({ transactions: [], categories, rules: [], tombstones: state.tombstones });
  document.dispatchEvent(new CustomEvent('local-change'));
}
