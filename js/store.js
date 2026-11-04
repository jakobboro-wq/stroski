// Stanje aplikacije v pomnilniku + shranjevanje v IndexedDB.
// Vsak zapis ima updatedAt, izbrisi se beležijo v tombstones — oboje potrebuje sinhronizacija.

import * as db from './db.js';
import { DEFAULT_CATEGORIES, CATEGORIES_VERSION, OLD_DEFAULT_NAMES, RULES_VERSION, builtinRules, guessCategory, matchRule, normalize } from './categorize.js';
import { SYNCED_STORES } from './merge.js';
import { dueTransactions } from './recurring.js';
import { matchSeries } from './subscriptions.js';

export const BASE_CURRENCY = 'EUR';
// recurring: ponavljajoči stroški/prihodki (predloge, iz katerih nastajajo transakcije)
// work: delovni dnevi (prihod/odhod), settings: nastavitve, ki se sinhronizirajo (npr. obračun ur)
// assets: premoženje (kind 'asset') in dolgovi (kind 'debt')
// investments: naložbe (kind 'fund') in vplačila vanje (kind 'deposit'), delnice (kind 'stock') ter njihovi nakupi in prodaje (kind 'trade')
export const state = { transactions: [], categories: [], rules: [], recurring: [], work: [], settings: [], assets: [], investments: [], tombstones: emptyTombstones() };

const uid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
function emptyTombstones() { return { transactions: {}, categories: {}, rules: {}, recurring: {}, work: {}, settings: {}, assets: {}, investments: {} }; }
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
  let [transactions, categories, rules, recurring, work, settings, assets, investments, meta] = await Promise.all(['transactions', 'categories', 'rules', 'recurring', 'work', 'settings', 'assets', 'investments', 'meta'].map(db.getAll));
  Object.assign(state, { recurring, work, settings, assets, investments });
  if (!categories.length) {
    // Nova naprava: privzete kategorije z updatedAt 0, da ob sinhronizaciji zmagajo tiste iz oblaka.
    categories = DEFAULT_CATEGORIES.map((c, order) => ({ ...c, order }));
    await db.putMany('categories', categories);
    await db.put('meta', { key: 'categoriesVersion', value: CATEGORIES_VERSION });
    meta.push({ key: 'categoriesVersion', value: CATEGORIES_VERSION });
  }
  state.transactions = transactions;
  state.categories = categories.sort((a, b) => a.order - b.order);
  state.rules = rules;
  state.tombstones = { ...emptyTombstones(), ...meta.find(m => m.key === 'tombstones')?.value };
  navigator.storage?.persist?.();

  if (meta.find(m => m.key === 'categoriesVersion')?.value !== CATEGORIES_VERSION) {
    await migrateCategories();
    await db.put('meta', { key: 'categoriesVersion', value: CATEGORIES_VERSION });
  }
  if (meta.find(m => m.key === 'rulesVersion')?.value !== RULES_VERSION) {
    await reapplyRules();
    await db.put('meta', { key: 'rulesVersion', value: RULES_VERSION });
  }
}

/**
 * Doda nove privzete (pod)kategorije in obstoječe privzete uvrsti pod nove glavne kategorije. Tvojih ne spreminja.
 * Samodejne nadgradnje (tu in v reapplyRules) ne spreminjajo updatedAt: vsaka naprava jih izvede sama,
 * sicer bi pri sinhronizaciji »premagale« izbris z druge naprave in izbrisani zapisi bi se vrnili.
 */
async function migrateCategories() {
  const byId = new Map(state.categories.map(c => [c.id, c]));
  const changedCats = [];
  DEFAULT_CATEGORIES.forEach((d, order) => {
    const c = byId.get(d.id);
    if (!c) {
      if (state.tombstones.categories[d.id]) return; // izbrisal si jo
      const added = { ...d, order, updatedAt: 0 };
      state.categories.push(added);
      changedCats.push(added);
      return;
    }
    const patch = { parentId: d.parentId, kind: d.kind, order };
    if (OLD_DEFAULT_NAMES[d.id] === c.name) Object.assign(patch, { name: d.name, emoji: d.emoji });
    if (Object.entries(patch).some(([k, v]) => c[k] !== v)) {
      Object.assign(c, patch);
      changedCats.push(c);
    }
  });
  for (const c of state.categories) {
    if (byId.has(c.id) && !DEFAULT_CATEGORIES.some(d => d.id === c.id) && c.order < DEFAULT_CATEGORIES.length) {
      Object.assign(c, { order: c.order + DEFAULT_CATEGORIES.length, parentId: c.parentId ?? null });
      changedCats.push(c);
    }
  }
  state.categories.sort((a, b) => a.order - b.order);
  await db.putMany('categories', changedCats);
}

/** Ponovno razvrsti uvožene transakcije, ki jih nisi ročno razvrstil (npr. po izboljšavi vgrajenih pravil). */
async function reapplyRules() {
  const rules = allRules();
  const changedTx = [];
  for (const t of state.transactions) {
    if (t.source !== 'csv' || t.categorySource === 'manual') continue;
    const { categoryId, source } = guessCategory(t, rules);
    if (categoryId !== t.categoryId) {
      Object.assign(t, { categoryId, categorySource: source });
      changedTx.push(t);
    }
  }
  if (changedTx.length) await db.putMany('transactions', changedTx);
}

export const category = id => state.categories.find(c => c.id === id) ?? state.categories.find(c => c.id === 'other');
export const kindOf = id => category(id)?.kind ?? 'expense';

// ---------- Drevo kategorij (glavna → podkategorija) ----------
export const parentOf = id => category(id)?.parentId ?? null;
/** Glavna kategorija, ki ji pripada (za glavno kategorijo kar ona sama). */
export const topOf = id => parentOf(id) ?? category(id)?.id;
export const childrenOf = id => state.categories.filter(c => c.parentId === id);
export const topCategories = kind => state.categories.filter(c => !c.parentId && (!kind || c.kind === kind));
/** Ali transakcija s kategorijo catId spada pod filter (glavna kategorija vključuje svoje podkategorije). */
export const inCategory = (catId, filterId) => catId === filterId || parentOf(catId) === filterId;
export function categoryLabel(id) {
  const c = category(id);
  const p = c.parentId && state.categories.find(x => x.id === c.parentId);
  return p ? `${p.name} › ${c.name}` : c.name;
}

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

/** Shrani kategorijo brez ponovnega izrisa (urejanje imena ne sme izgubiti fokusa). Vrne shranjeno kategorijo. */
export async function saveCategory(c) {
  c.id ??= uid();
  c.parentId ??= null;
  if (c.parentId) c.kind = kindOf(c.parentId);
  c.order ??= Math.max(-1, ...state.categories.map(x => x.order)) + 1;
  c.updatedAt = Date.now();
  const i = state.categories.findIndex(x => x.id === c.id);
  if (i >= 0) state.categories[i] = c;
  else state.categories.push(c);
  await db.put('categories', c);
  document.dispatchEvent(new CustomEvent('local-change'));
  return c;
}

/**
 * Izbriše kategorijo. Transakcije podkategorije gredo v njeno glavno kategorijo;
 * pri glavni kategoriji se izbrišejo tudi podkategorije, transakcije pa gredo v »Ostalo« (oz. »Drugi prihodki«).
 */
export async function deleteCategory(id) {
  const c = state.categories.find(x => x.id === id);
  if (!c) return;
  const removed = new Set([id, ...childrenOf(id).map(x => x.id)]);
  const target = c.parentId ?? (c.kind === 'income' ? 'income_other' : 'other');
  const now = Date.now();
  const moved = state.transactions.filter(t => removed.has(t.categoryId));
  moved.forEach(t => Object.assign(t, { categoryId: target, updatedAt: now }));
  const rules = state.rules.filter(r => removed.has(r.categoryId));
  state.categories = state.categories.filter(x => !removed.has(x.id));
  state.rules = state.rules.filter(r => !removed.has(r.categoryId));
  await Promise.all([
    db.removeMany('categories', [...removed]),
    db.removeMany('rules', rules.map(r => r.id)),
    db.putMany('transactions', moved),
  ]);
  await bury('categories', [...removed]);
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

// ---------- Ponavljajoči stroški ----------

export const seriesById = id => state.recurring.find(s => s.id === id) ?? null;

export async function saveSeries(s) {
  s.id ??= uid();
  s.createdAt ??= Date.now();
  s.updatedAt = Date.now();
  state.recurring = [...state.recurring.filter(x => x.id !== s.id), s];
  await db.put('recurring', s);
  localChange();
  return s;
}

/** Ustavi ponavljanje. Že nastale transakcije ostanejo. */
export async function deleteSeries(id) {
  state.recurring = state.recurring.filter(s => s.id !== id);
  await Promise.all([db.removeMany('recurring', [id]), bury('recurring', [id])]);
  localChange();
}

/**
 * Najdeno naročnino doda med ponavljajoče stroške in ji pripiše dosedanja plačila.
 * imported: nova plačila pridejo z uvozom izpiska, zato jih aplikacija ne ustvarja sama.
 */
export async function confirmSubscription(c) {
  const { description, amount, categoryId, account, currency, every, lastDate, key, txIds } = c;
  const s = await saveSeries({ description, amount, categoryId, account, currency, every, anchor: lastDate, imported: true, matchKey: key });
  const ids = new Set(txIds);
  await saveTransactions(state.transactions.filter(t => ids.has(t.id)).map(t => ({ ...t, seriesId: s.id })));
}

/** Novo uvožena plačila pripiše potrjenim naročninam. Zadnje plačilo določa znesek za naprej. */
export async function linkToSubscriptions(list) {
  const latest = new Map();
  for (const t of list) {
    const s = matchSeries(t, state.recurring);
    if (!s) continue;
    t.seriesId = s.id;
    if (t.date >= (latest.get(s.id)?.date ?? s.anchor)) latest.set(s.id, t);
  }
  for (const [id, t] of latest) await saveSeries({ ...seriesById(id), amount: t.amount, anchor: t.date });
}

// ---------- Ure in nastavitve ----------

export async function saveWork(list) {
  const now = Date.now();
  const byId = new Map(state.work.map(s => [s.id, s]));
  for (const s of list) {
    s.id ??= uid();
    s.updatedAt = now;
    byId.set(s.id, s);
  }
  state.work = [...byId.values()];
  await db.putMany('work', list);
  localChange();
}

export async function deleteWork(ids) {
  const set = new Set(ids);
  state.work = state.work.filter(s => !set.has(s.id));
  await Promise.all([db.removeMany('work', ids), bury('work', ids)]);
  localChange();
}

// ---------- Premoženje in dolgovi ----------

export async function saveAsset(a) {
  a.id ??= uid();
  a.createdAt ??= Date.now();
  a.updatedAt = Date.now();
  state.assets = [...state.assets.filter(x => x.id !== a.id), a];
  await db.put('assets', a);
  localChange();
  return a;
}

export async function deleteAsset(id) {
  state.assets = state.assets.filter(a => a.id !== id);
  await Promise.all([db.removeMany('assets', [id]), bury('assets', [id])]);
  localChange();
}

// ---------- Naložbe in vplačila ----------

export async function saveInvestment(x) {
  x.id ??= uid();
  x.createdAt ??= Date.now();
  x.updatedAt = Date.now();
  state.investments = [...state.investments.filter(i => i.id !== x.id), x];
  await db.put('investments', x);
  localChange();
  return x;
}

export async function deleteInvestments(ids) {
  const set = new Set(ids);
  state.investments = state.investments.filter(i => !set.has(i.id));
  await Promise.all([db.removeMany('investments', ids), bury('investments', ids)]);
  localChange();
}

export const getSetting = (id, fallback = {}) => ({ ...fallback, ...state.settings.find(s => s.id === id) });

export async function saveSetting(value) {
  value.updatedAt = Date.now();
  state.settings = [...state.settings.filter(s => s.id !== value.id), value];
  await db.put('settings', value);
  localChange();
}

/** Doda transakcije ponavljajočih stroškov, ki so do danes zapadle. Izbrisanih ne ustvari znova. Vrne število dodanih. */
export async function generateRecurring(today) {
  const existing = new Set(state.transactions.map(t => t.id));
  const fresh = state.recurring
    .flatMap(s => dueTransactions(s, today))
    .filter(t => !existing.has(t.id) && !state.tombstones.transactions[t.id]);
  if (fresh.length) await saveTransactions(fresh);
  return fresh.length;
}

// ---------- Sinhronizacija ----------

export const snapshot = () => ({
  transactions: state.transactions,
  categories: state.categories,
  rules: state.rules,
  recurring: state.recurring,
  work: state.work,
  settings: state.settings,
  assets: state.assets,
  investments: state.investments,
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
  state.recurring = data.recurring;
  state.work = data.work;
  state.settings = data.settings;
  state.assets = data.assets;
  state.investments = data.investments;
  state.tombstones = data.tombstones;
  changed();
}

// ---------- Varnostna kopija in brisanje ----------

export function exportData() {
  const { transactions, categories, rules, recurring, work, settings, assets, investments } = state;
  return { app: 'stroski', version: 1, exportedAt: new Date().toISOString(), transactions, categories, rules, recurring, work, settings, assets, investments };
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
    recurring: (data.recurring ?? []).map(r => ({ ...r, updatedAt: now })),
    work: (data.work ?? []).map(r => ({ ...r, updatedAt: now })),
    settings: (data.settings ?? []).map(r => ({ ...r, updatedAt: now })),
    assets: (data.assets ?? []).map(r => ({ ...r, updatedAt: now })),
    investments: (data.investments ?? []).map(r => ({ ...r, updatedAt: now })),
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
  for (const s of state.recurring) state.tombstones.recurring[s.id] = now;
  for (const w of state.work) state.tombstones.work[w.id] = now;
  for (const a of state.assets) state.tombstones.assets[a.id] = now;
  for (const i of state.investments) state.tombstones.investments[i.id] = now;
  for (const c of state.categories) if (!DEFAULT_IDS.has(c.id)) state.tombstones.categories[c.id] = now;
  const categories = DEFAULT_CATEGORIES.map((c, order) => ({ ...c, order, updatedAt: now }));
  await applySnapshot({ transactions: [], categories, rules: [], recurring: [], work: [], settings: state.settings, assets: [], investments: [], tombstones: state.tombstones });
  document.dispatchEvent(new CustomEvent('local-change'));
}
