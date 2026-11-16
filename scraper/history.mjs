// Zgodovina cen akcij: dnevni posnetki na veji »cene« in iz njih statistika (cikli akcij, najnižje cene).
// Zaženi: node scraper/history.mjs <mapa-veje-cene> <deals.json>
//   - doda posnetek današnjih akcij (days/YYYY-MM-DD.json) in posodobi products.json,
//   - izračuna stats.json (izdelki z vsaj dvema obdobjema akcij: cikel, naslednja akcija),
//   - deals.json dopolni z zgodovino (lo, lod, ep, cy), da jo aplikacija vidi brez dodatnega nalaganja.
//
// Opomba: trgovine objavljajo samo akcije, zato je to zgodovina akcij, ne vseh rednih cen.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { norm } from '../js/products.js';

const DAY = 86400e3;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const round2 = v => Math.round(v * 100) / 100;
// Akcija, ki manjka največ toliko dni (npr. dan brez osvežitve), je še isto obdobje.
const GAP_DAYS = 2;
const WINDOW_DAYS = 400;

/** Kratek stabilen id izdelka: trgovina + ime (FNV-1a, base36). */
export function productId(d) {
  const s = `${d.s}:${norm(d.n)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${d.s[0]}${h.toString(36)}`;
}

/** Posnetek dneva: { id: [cena, redna|0, popust|0, najnižja30|0] } in podatki o izdelkih. */
export function snapshot(deals) {
  const items = {}, products = {};
  for (const d of deals) {
    if (!(d.p > 0) || !d.n) continue;
    const id = productId(d);
    // Isti izdelek dvakrat (npr. dva razdelka): obdrži nižjo ceno.
    if (items[id] && items[id][0] <= d.p) continue;
    items[id] = [d.p, d.o ?? 0, d.d ?? 0, d.l30 ?? 0];
    products[id] = { s: d.s, n: d.n, g: d.g ?? null, uu: d.uu ?? null };
  }
  return { items, products };
}

/**
 * Obdobja akcij za vsak izdelek iz dnevnih posnetkov ({ date: items }).
 * Vrne Map id → [{ start, end, min, regular }].
 */
export function episodes(dayMap) {
  const out = new Map();
  for (const date of Object.keys(dayMap).sort()) {
    for (const [id, [p, o]] of Object.entries(dayMap[date])) {
      const list = out.get(id) ?? [];
      const last = list.at(-1);
      if (last && days(last.end, date) <= GAP_DAYS) {
        last.end = date;
        last.min = Math.min(last.min, p);
        if (o) last.regular = o;
      } else list.push({ start: date, end: date, min: p, regular: o || null });
      out.set(id, list);
    }
  }
  return out;
}

/**
 * Statistika izdelka iz obdobij akcij na dan `today`:
 * ep (št. obdobij), cy (dni med začetki, mediana), next (napoved naslednjega začetka), on (zdaj v akciji),
 * lo / lod (najnižja cena in kdaj), typ (običajna akcijska cena), reg (redna cena).
 */
export function statsOf(list, today) {
  const starts = list.map(e => e.start);
  const gaps = starts.slice(1).map((s, i) => days(starts[i], s)).filter(g => g > 0);
  const cy = gaps.length ? Math.round(median(gaps)) : null;
  const last = list.at(-1);
  // Današnji posnetek je vedno zraven, zato je izdelek v akciji, če se zadnje obdobje konča danes.
  const on = last.end >= today;
  let next = cy ? addDays(last.start, cy) : null;
  // Napoved v preteklosti: če ni v akciji, je pričakovana »vsak čas« (jutri); če je, je naslednja neznana.
  if (next && next <= today) next = on ? null : addDays(today, 1);
  const best = list.reduce((a, b) => (b.min < a.min ? b : a));
  const regs = list.map(e => e.regular).filter(Boolean);
  return {
    ep: list.length, cy, next, on,
    lo: best.min, lod: best.start, typ: round2(median(list.map(e => e.min))), reg: regs.length ? round2(median(regs)) : null,
    last: last.start,
  };
}

/** Dopolni akcije z zgodovino: lo/lod samo, če je bilo že ceneje; ep in cy pri vsaj dveh obdobjih. */
export function annotate(deals, statsById) {
  return deals.map(d => {
    const st = statsById.get(productId(d));
    if (!st) return d;
    const extra = {};
    if (st.lo < d.p - 0.005) { extra.lo = st.lo; extra.lod = st.lod; }
    if (st.ep >= 2) { extra.ep = st.ep; if (st.cy) extra.cy = st.cy; }
    return { ...d, ...extra };
  });
}

/** stats.json: izdelki z vsaj dvema obdobjema (samo ti imajo cikel). */
export function buildStats(dayMap, products, today) {
  const eps = episodes(dayMap);
  const byId = new Map();
  const rows = [];
  for (const [id, list] of eps) {
    const st = statsOf(list, today);
    byId.set(id, st);
    const pr = products[id];
    if (st.ep >= 2 && pr) rows.push([id, pr.s, pr.n, pr.g, st.ep, st.cy, st.next, st.on ? 1 : 0, st.lo, st.typ, st.reg, st.last]);
  }
  const dates = Object.keys(dayMap).sort();
  return {
    byId,
    json: {
      updatedAt: new Date().toISOString(), since: dates[0] ?? null, days: dates.length,
      cols: ['id', 's', 'n', 'g', 'ep', 'cy', 'next', 'on', 'lo', 'typ', 'reg', 'last'], rows,
    },
  };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

/** Doda posnetek dneva v mapo veje in vrne vse posnetke v oknu. */
export async function addDay(dir, date, deals) {
  const { items, products } = snapshot(deals);
  await mkdir(path.join(dir, 'days'), { recursive: true });
  await writeFile(path.join(dir, 'days', `${date}.json`), JSON.stringify({ date, items }));
  const all = await readJson(path.join(dir, 'products.json'), {});
  for (const [id, p] of Object.entries(products)) all[id] = { ...all[id], ...p, first: all[id]?.first ?? date, last: date };
  await writeFile(path.join(dir, 'products.json'), JSON.stringify(all));
  const from = addDays(date, -WINDOW_DAYS);
  const dayMap = {};
  for (const f of (await readdir(path.join(dir, 'days'))).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
    const d = f.slice(0, 10);
    if (d < from || d > date) continue;
    dayMap[d] = (await readJson(path.join(dir, 'days', f), { items: {} })).items;
  }
  return { dayMap, products: all };
}

async function main() {
  const [dir, dealsFile, dateArg] = process.argv.slice(2);
  if (!dir || !dealsFile) { console.error('Uporaba: node scraper/history.mjs <mapa> <deals.json> [YYYY-MM-DD]'); process.exit(2); }
  const data = JSON.parse(await readFile(dealsFile, 'utf8'));
  const date = dateArg ?? new Date(data.updatedAt ?? Date.now()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' });
  const { dayMap, products } = await addDay(dir, date, data.deals);
  const { byId, json } = buildStats(dayMap, products, date);
  await writeFile(path.join(dir, 'stats.json'), JSON.stringify(json));
  // Samo današnji zagon dopolni deals.json (zgodovinski uvoz ga pusti pri miru).
  if (!dateArg) await writeFile(dealsFile, JSON.stringify({ ...data, history: { since: json.since, days: json.days }, deals: annotate(data.deals, byId) }));
  console.log(`cene ${date}: ${Object.keys(dayMap[date] ?? {}).length} izdelkov, ${json.days} dni, ${json.rows.length} s ciklom`);
}

if (/(^|[\\/])history\.mjs$/.test(process.argv[1] ?? '')) await main();
