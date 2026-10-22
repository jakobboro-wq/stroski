// Stanje aplikacije v pomnilniku + shranjevanje v IndexedDB.

import * as db from './db.js';
import { DEFAULT_CATEGORIES, RULES_VERSION, builtinRules, guessCategory, matchRule, normalize } from './categorize.js';

export const BASE_CURRENCY = 'EUR';
export const state = { transactions: [], categories: [], rules: [] };

const uid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/** Obvesti prikaz, da so se podatki spremenili. */
export const changed = () => document.dispatchEvent(new CustomEvent('data-changed'));

export async function load() {
  let [transactions, categories, rules] = await Promise.all(['transactions', 'categories', 'rules'].map(db.getAll));
  if (!categories.length) {
    categories = DEFAULT_CATEGORIES.map((c, order) => ({ ...c, order }));
    await db.putMany('categories', categories);
  }
  state.transactions = transactions;
  state.categories = categories.sort((a, b) => a.order - b.order);
  state.rules = rules;
  navigator.storage?.persist?.();

  const meta = await db.getAll('meta');
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
      t.categoryId = categoryId;
      t.categorySource = source;
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
  changed();
}

export async function deleteTransactions(ids) {
  const set = new Set(ids);
  state.transactions = state.transactions.filter(t => !set.has(t.id));
  await db.removeMany('transactions', ids);
  changed();
}

/** Shrani kategorijo brez ponovnega izrisa (urejanje imena ne sme izgubiti fokusa). */
export async function saveCategory(c) {
  c.id ??= uid();
  c.order ??= Math.max(-1, ...state.categories.map(x => x.order)) + 1;
  const i = state.categories.findIndex(x => x.id === c.id);
  if (i >= 0) state.categories[i] = c;
  else state.categories.push(c);
  await db.put('categories', c);
}

/** Izbriše kategorijo; njene transakcije gredo v »Ostalo« (oz. »Drugi prihodki«). */
export async function deleteCategory(id) {
  const c = state.categories.find(x => x.id === id);
  if (!c) return;
  const target = c.kind === 'income' ? 'income_other' : 'other';
  const moved = state.transactions.filter(t => t.categoryId === id);
  moved.forEach(t => { t.categoryId = target; });
  const rules = state.rules.filter(r => r.categoryId === id);
  state.categories = state.categories.filter(x => x.id !== id);
  state.rules = state.rules.filter(r => r.categoryId !== id);
  await Promise.all([
    db.removeMany('categories', [id]),
    db.removeMany('rules', rules.map(r => r.id)),
    db.putMany('transactions', moved),
  ]);
  changed();
}

/** Doda pravilo in ga uporabi na obstoječih transakcijah, ki jih nisi ročno razvrstil. Vrne število spremenjenih. */
export async function addRule(pattern, categoryId) {
  const rule = { id: uid(), pattern: normalize(pattern), categoryId, createdAt: Date.now() };
  if (!rule.pattern) return 0;
  const replaced = state.rules.filter(r => r.pattern === rule.pattern);
  state.rules = [...state.rules.filter(r => r.pattern !== rule.pattern), rule];

  const affected = state.transactions.filter(t =>
    t.categorySource !== 'manual' && t.categoryId !== categoryId && matchRule(t.description, [rule]));
  affected.forEach(t => { t.categoryId = categoryId; t.categorySource = 'rule'; });

  await Promise.all([
    db.removeMany('rules', replaced.map(r => r.id)),
    db.put('rules', rule),
    db.putMany('transactions', affected),
  ]);
  changed();
  return affected.length;
}

export async function deleteRule(id) {
  state.rules = state.rules.filter(r => r.id !== id);
  await db.removeMany('rules', [id]);
  changed();
}

export function exportData() {
  const { transactions, categories, rules } = state;
  return { app: 'stroski', version: 1, exportedAt: new Date().toISOString(), transactions, categories, rules };
}

export async function importData(data) {
  if (data?.app !== 'stroski' || !Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
    throw new Error('To ni varnostna kopija aplikacije Stroški.');
  }
  await clearAll(false);
  await Promise.all([
    db.putMany('transactions', data.transactions),
    db.putMany('categories', data.categories),
    db.putMany('rules', data.rules ?? []),
  ]);
  await load();
  changed();
}

export async function clearAll(notify = true) {
  await Promise.all(['transactions', 'categories', 'rules'].map(db.clear));
  if (notify) {
    await load();
    changed();
  }
}
