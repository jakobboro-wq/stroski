// Enkrat na dan pobere akcije z javnih strani trgovin in jih zapiše v data/deals.json.
// Bere samo javne strani z akcijami (tiste, ki jih vidiš v brskalniku), počasi in pod svojim imenom.
// Zaženi: node scraper/deals.mjs

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { enrichDeal } from '../js/products.js';

const UA = 'Mozilla/5.0 (compatible; stroski-app/1.0; osebni sledilnik cen; +https://github.com/jakobboro-wq/stroski)';
const PAUSE_MS = 1500; // premor med zahtevami, da trgovine ne obremenjujemo
const MAX_PAGES = 25;
// Če trgovina vrne manj kot ta delež včerajšnjih izdelkov, je stran verjetno spremenjena: velja kot napaka.
const MIN_RATIO = 0.3;
const PREV_FILE = 'data/prev.json'; // včerajšnji deals.json (workflow ga vzame z veje akcije)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const unescapeHtml = s => String(s ?? '')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const num = s => (s == null || s === '' ? null : Number(String(s).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')));
const round2 = v => Math.round(v * 100) / 100;
const pct = (p, o) => (o && p && o > p ? Math.round((1 - p / o) * 100) : null);
const isoDay = sec => new Date(sec * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' });
const humanize = slug => { const s = slug.replace(/-/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };

async function get(url, retry = true, headers = {}) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'sl-SI,sl;q=0.9', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { status: res.status });
    return await res.text();
  } catch (e) {
    // Enkrat ponovi ob prekinjeni povezavi ali napaki strežnika (5xx); 4xx ne.
    if (!retry || (e.status && e.status < 500)) throw e;
    await sleep(5000);
    return get(url, false, headers);
  }
}

// ---------- Tuš ----------
const TUS = 'https://www.tus.si/aktualno/akcijska-ponudba/';
const TUS_SECTIONS = [
  ['', 'Akcija'],
  ['aktualno-iz-kataloga/', 'Iz kataloga'],
  ['trajno-znizano/', 'Trajno znižano'],
  ['vec-je-ceneje/', 'Več je ceneje'],
  ['tus-klub-50/', 'Tuš klub'],
];

const TUS_NONFOOD = /kozmetik|vzdrzevanje-doma|pranje-perila|gospodinjstvo-nezivila|sola|papirni|hrana-za-zivali|aparati/;

/** Izdelki z ene strani Tuševe akcijske ponudbe. */
export function parseTus(html, tag) {
  const out = [];
  const chunks = html.split(/<li class="col js-match-height/).slice(1);
  for (const c of chunks) {
    const attr = name => { const m = c.match(new RegExp(`data-gtm4wp_${name}="([^"]*)"`)); return m ? unescapeHtml(m[1]) : null; };
    const name = attr('product_name');
    const price = num(attr('product_price'));
    if (!name || !price) continue;
    const old = num(c.match(/Redna cena:\s*([\d.,]+)/)?.[1]);
    const cat = c.match(/product_cat-([a-z0-9-]+)/)?.[1];
    out.push({
      s: 'tus', n: name, p: price, o: old && old > price ? old : null, d: pct(price, old),
      u: attr('product_url'), i: c.match(/data-src="([^"]+)"/)?.[1] ?? null,
      c: cat ? humanize(cat) : null, food: cat ? !TUS_NONFOOD.test(cat) : null, t: tag,
    });
  }
  return out;
}

async function scrapeTus() {
  const all = new Map();
  for (const [path, tag] of TUS_SECTIONS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await get(`${TUS}${path}${page > 1 ? `page/${page}/` : ''}`).catch(e => (page > 1 && /404/.test(e.message) ? '' : Promise.reject(e)));
      const items = parseTus(html, tag);
      for (const it of items) if (!all.has(it.u)) all.set(it.u, it);
      await sleep(PAUSE_MS);
      if (!items.length || !html.includes(`/page/${page + 1}/`)) break;
    }
  }
  return [...all.values()];
}

// ---------- Lidl ----------
const LIDL = 'https://www.lidl.si';

/** Povezave na strani z akcijami (/c/<ime>/a<številka>) z naslovne strani. */
export function lidlCampaigns(html) {
  return [...new Set([...html.matchAll(/href="(\/c\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\/a\d+)"/g)].map(m => m[1]))];
}

/** Izdelki z ene Lidlove strani z akcijami. Podatki so v atributu data-grid-data. */
export function parseLidl(html, nowSec = Date.now() / 1000) {
  const tag = unescapeHtml(html.match(/<title>([^<|]*)/)?.[1] ?? '').trim();
  const out = [];
  for (const m of html.matchAll(/data-grid-data="([^"]*)"/g)) {
    let d;
    try { d = JSON.parse(unescapeHtml(m[1])); } catch { continue; }
    const pr = d.price ?? {};
    const price = pr.price;
    if (!price || !d.fullTitle) continue;
    if (d.storeEndDate && d.storeEndDate < nowSec) continue; // poteklo
    const old = pr.oldPrice || pr.discount?.deletedPrice || null;
    const won = d.keyfacts?.wonCategoryPrimary ?? '';
    out.push({
      s: 'lidl', id: d.productId, n: d.fullTitle, p: round2(price), o: old && old > price ? round2(old) : null,
      d: pr.discount?.percentageDiscount || pct(price, old),
      q: pr.packaging?.text ?? null, b: pr.basePrice?.text ?? null,
      u: d.canonicalUrl ? new URL(d.canonicalUrl, LIDL).href : null, i: d.image ?? null,
      c: won.split('/').at(-1) || null, food: /Hrana/.test(won), t: tag || null,
      f: d.storeStartDate ? isoDay(d.storeStartDate) : null, to: d.storeEndDate ? isoDay(d.storeEndDate) : null,
      plus: (d.lidlPlus?.length ?? 0) > 0 || /lidl plus/i.test(tag),
    });
  }
  return out;
}

async function scrapeLidl() {
  const home = await get(`${LIDL}/`);
  const campaigns = lidlCampaigns(home);
  if (!campaigns.length) throw new Error('Na naslovni strani ni povezav na akcije');
  const all = new Map();
  let failed = 0;
  for (const path of campaigns) {
    await sleep(PAUSE_MS);
    const html = await get(`${LIDL}${path}`).catch(e => { failed++; console.warn('lidl', e.message); return ''; });
    for (const it of parseLidl(html)) if (!all.has(it.id)) all.set(it.id, it);
  }
  if (failed > campaigns.length / 2) throw new Error(`Ni uspelo ${failed} od ${campaigns.length} strani z akcijami`);
  return [...all.values()].map(({ id, ...it }) => it);
}

// ---------- Hofer ----------
// Nova stran (Nuxt) izriše ploščice izdelkov že na strežniku, 60 na stran (?page=N, dovoljeno v robots.txt).
// Stare cene in popusta na spletu ni; ta sta samo v letaku (ročni uvoz PDF v aplikaciji).
const HOFER = 'https://www.hofer.si';
const HOFER_SECTIONS = [
  ['/izdelki/pregled-posebne-ponudbe/k/1588161418378530', 'Posebna ponudba'],
  ['/izdelki/vse-spuscene-cene/k/1588161418378360', 'Trajno znižano'],
];

/** Izdelki z ene strani Hoferjeve kategorije. */
export function parseHofer(html, tag) {
  const out = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const t of clean.split(/<div class="product-tile"/).slice(1)) {
    const text = cls => { const m = t.match(new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>(?:\\s*<[a-z]+[^>]*>)*\\s*([^<]+)`)); return m ? unescapeHtml(m[1]).trim() : null; };
    const name = text('product-tile__name');
    const price = num(text('base-price__regular')?.replace(/[^\d,.]/g, ''));
    if (!name || !price) continue;
    const brand = text('product-tile__brandname');
    const from = t.match(/[Nn]a voljo od (\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
    const href = t.match(/href="(\/izdelek\/[^"]+)"/)?.[1];
    out.push({
      s: 'hofer', id: t.match(/(\d{12,})"/)?.[1] ?? href, n: [brand, name].filter(Boolean).join(' '), p: price, o: null, d: null,
      q: text('product-tile__unit-of-measurement'), b: text('product-tile__comparison-price')?.replace(/^\(|\)$/g, '') ?? null,
      u: href ? HOFER + href : null, i: t.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null,
      c: null, food: null, t: tag,
      f: from ? `${from[3]}-${from[2].padStart(2, '0')}-${from[1].padStart(2, '0')}` : null, to: null,
    });
  }
  return out;
}

async function scrapeHofer() {
  const all = new Map();
  for (const [path, tag] of HOFER_SECTIONS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = parseHofer(await get(`${HOFER}${path}${page > 1 ? `?page=${page}` : ''}`), tag);
      const before = all.size;
      for (const it of items) if (!all.has(it.id)) all.set(it.id, it);
      await sleep(PAUSE_MS);
      if (!items.length || all.size === before) break; // za zadnjo stranjo pride prazna stran
    }
  }
  return [...all.values()].map(({ id, ...it }) => it);
}

// ---------- Mercator ----------
// Spletna trgovina mercatoronline.si naloži izdelke iz JSON (getProducts), ki ga kliče tudi brskalnik; brez prijave.
// Cene so spletne trgovine in se lahko razlikujejo od cen v posamezni prodajalni.
const MERCATOR = 'https://mercatoronline.si';
// Oznake popustov, ki jih stran sama uporabi za »Akcije« (akcije, gratis, Pika).
const MERCATOR_DISCOUNTS = '1,2,3,4,5,6,10,11,15,16,18,100,103,109,113,114,115,126,101,108,110,111,104,105,106,112';
const MERCATOR_PAGE = 100;
const MERCATOR_NONFOOD = /KOZMETIK|NEGA|ČISTIL|GOSPODINJ|ŽIVAL|PAPIR|TEKSTIL|DOM\b|TEHNIK|PISARN|VRT|IGRA|ŠOL|AVTO|OBLAČIL|ZDRAVJE|HIGIEN|PRALN/;
const PRICE_MARKERS = ['discount', 'pika_discount'];

// »20261125004514« → »2026-11-25«; konec ob polnoči (do 6. ure) pomeni, da je zadnji dan dan prej.
const mercatorDay = (s, end = false) => {
  const m = String(s ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (end && +m[4] < 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const fmtEur = v => v.toFixed(2).replace('.', ',');
const titleCase = s => (s ? s[0] + s.slice(1).toLowerCase() : null);

/** Izdelki iz enega odgovora getProducts. */
export function parseMercator(json) {
  const out = [];
  for (const it of json?.products ?? []) {
    const x = it?.data;
    if (it?.type !== 'product' || !x?.name) continue;
    const cur = num(x.current_price);
    if (!cur) continue;
    const normal = num(x.normal_price);
    const disc = (x.discounts ?? []).find(d => PRICE_MARKERS.includes(d.group_type) || d.marker_code === '11') ?? x.discounts?.[0] ?? null;
    const text = disc?.hover_text?.trim() ?? '';
    const multi = text.match(/nakupu ([2-9]|\d{2,}) izdelkov ali več je vsak (\d+) ?%/);
    let p = cur, o = normal && normal > cur ? normal : null, d = null, t = 'Akcija';
    if (multi) {
      // Pogojni popust: cena na kos ob nakupu N ali več.
      o = cur; p = round2(cur * (1 - multi[2] / 100)); d = +multi[2]; t = `Ob nakupu ${multi[1]} ali več`;
    } else {
      d = Math.abs(parseInt(disc?.value, 10)) || pct(p, o);
      if (disc?.group_type === 'pika_discount') t = 'S Pika kartico';
      else if (disc?.marker_code === '11') t = 'Znižano';
      else if (text && !/^ugodno$/i.test(text)) t = text.length > 40 ? 'Akcija' : text;
    }
    const base = String(x.price_per_unit_base ?? '').replace(/^(\d+)\s*([a-z]+)$/i, '$1 $2');
    out.push({
      s: 'mercator', id: it.itemId ?? x.cinv, n: x.name.trim(), p, o, d,
      q: null, b: x.price_per_unit > 0 && base ? `${base} = ${fmtEur(x.price_per_unit * (multi ? 1 - multi[2] / 100 : 1))}` : null,
      u: it.url ? MERCATOR + it.url : null, i: it.mainImageSrc ?? null,
      c: titleCase(x.category1), food: x.category1 ? !MERCATOR_NONFOOD.test(x.category1) : null, t,
      f: mercatorDay(disc?.valid_from), to: mercatorDay(disc?.valid_to, true),
      plus: disc?.group_type === 'pika_discount',
    });
  }
  return out;
}

async function scrapeMercator() {
  const all = new Map();
  // »offset« je pri Mercatorju številka strani (0, 1, 2 …), ne zamik v izdelkih.
  for (let page = 0; page < 60; page++) {
    const qs = new URLSearchParams({ limit: MERCATOR_PAGE, offset: page, 'filterData[discounts]': MERCATOR_DISCOUNTS });
    const json = JSON.parse(await get(`${MERCATOR}/products/browseProducts/getProducts?${qs}`, true, { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' }));
    const items = parseMercator(json);
    for (const it of items) if (!all.has(it.id)) all.set(it.id, it);
    await sleep(PAUSE_MS);
    const total = json.products?.[0]?.total ?? 0;
    if (!json.products?.length || (page + 1) * MERCATOR_PAGE >= total) break;
  }
  return [...all.values()].map(({ id, ...it }) => it);
}

// ---------- Eurospin ----------
// Stran /akcije/ ima vse akcijske izdelke (tekoči in naslednji teden) v HTML-ju.
const EUROSPIN = 'https://www.eurospin.si/akcije/';

/** »12.11 - 18.11« → { f, to } z letom glede na današnji dan (akcija čez novo leto). */
function eurospinPeriod(s, today) {
  const m = String(s ?? '').match(/(\d{1,2})\.(\d{1,2})\.?\s*-\s*(\d{1,2})\.(\d{1,2})/);
  if (!m) return { f: null, to: null };
  const [ty, tm] = today.split('-').map(Number);
  const year = mo => (mo < tm - 6 ? ty + 1 : mo > tm + 6 ? ty - 1 : ty);
  const iso = (d, mo) => `${year(+mo)}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { f: iso(m[1], m[2]), to: iso(m[3], m[4]) };
}

/** Izdelki s strani z akcijami. */
export function parseEurospin(html, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' })) {
  const out = [];
  const txt = s => (s == null ? null : unescapeHtml(s).replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim() || null);
  for (const t of html.split(/class="sn_promo_grid_item"/).slice(1)) {
    const name = txt(t.match(/class="i_title"[^>]*>([^<]*)/)?.[1]);
    const priceBox = t.match(/class="i_price"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    const p = num(priceBox.match(/itemprop="price"[^>]*>\s*([\d.,]+)/)?.[1]);
    if (!name || !p) continue;
    const old = num(txt(priceBox.replace(/<meta[^>]*>/g, '').split('<span')[0])?.match(/[\d.,]+/)?.[0]);
    const brand = txt(t.match(/class="i_brand"[^>]*>([^<]*)/)?.[1]);
    const info = txt(t.match(/class="i_price_info"[^>]*>([^<]*)/)?.[1]) ?? '';
    const [pack, unit] = info.split(/\s+-\s+/);
    const um = unit?.match(/za (\w+) ([\d.,]+)/);
    const { f, to } = eurospinPeriod(t.match(/date_current_promo"[^>]*>([^<]*)/)?.[1], today);
    out.push({
      s: 'eurospin', n: [brand, name].filter(Boolean).join(' '), p, o: old && old > p ? old : null, d: pct(p, old),
      q: pack || null, b: um ? `1 ${um[1]} = ${um[2]}` : null,
      u: EUROSPIN, i: t.match(/class="i_image"[^>]*src="([^"]+)"/)?.[1] ?? t.match(/src="([^"]+)"[^>]*class="i_image"/)?.[1] ?? null,
      c: null, food: null, t: 'Akcija', f, to,
    });
  }
  return out;
}

async function scrapeEurospin() {
  const seen = new Set();
  return parseEurospin(await get(EUROSPIN)).filter(d => {
    const k = `${d.n}|${d.p}|${d.f}`;
    return !seen.has(k) && seen.add(k);
  });
}

// ---------- Zagon ----------
const STORES = { tus: scrapeTus, lidl: scrapeLidl, hofer: scrapeHofer, mercator: scrapeMercator, eurospin: scrapeEurospin };

/**
 * Sestavi deals.json iz današnjih rezultatov in včerajšnje datoteke.
 * results: { [trgovina]: { list } | { error } }.
 * Trgovina, ki ni uspela (ali vrne sumljivo malo izdelkov), obdrži včerajšnje akcije in
 * dobi ok: false, stale: true ter datum podatkov v `at`.
 */
export function combine(results, prev, now = new Date().toISOString()) {
  const stores = {};
  const deals = [];
  for (const [id, r] of Object.entries(results)) {
    const before = prev?.stores?.[id];
    const prevCount = before?.ok || before?.stale ? before.count : 0; // zadnji uspešni dan
    let error = r.error ?? null;
    if (!error && !r.list.length) error = '0 izdelkov (stran je morda spremenjena)';
    else if (!error && prevCount && r.list.length < prevCount * MIN_RATIO) error = `samo ${r.list.length} izdelkov, včeraj ${prevCount} (stran je morda spremenjena)`;
    if (!error) {
      stores[id] = { ok: true, count: r.list.length, at: now };
      deals.push(...r.list);
      continue;
    }
    const old = (prev?.deals ?? []).filter(d => d.s === id);
    stores[id] = { ok: false, count: old.length, error: String(error).slice(0, 200), ...(old.length && { stale: true, at: before?.at ?? prev?.updatedAt ?? null }) };
    deals.push(...old);
  }
  return { updatedAt: now, stores, deals };
}

/** Izdelek brez praznih polj (null, plus: false); aplikacija manjkajoče bere enako kot null. */
export const compact = d => Object.fromEntries(Object.entries(d).filter(([k, v]) => v !== null && !(k === 'plus' && v === false)));

async function readPrev() {
  try { return JSON.parse(await readFile(PREV_FILE, 'utf8')); } catch { return null; }
}

async function main() {
  const prev = await readPrev();
  if (!prev) console.warn(`Ni ${PREV_FILE}: ob napaki ne bo včerajšnjih podatkov.`);
  const results = {};
  for (const [id, fn] of Object.entries(STORES)) {
    try { results[id] = { list: (await fn()).map(enrichDeal) }; } catch (e) { results[id] = { error: e.message }; }
  }
  const out = combine(results, prev);
  for (const [id, st] of Object.entries(out.stores)) console.log(id, st);
  // Nič novega: datoteke ne zapišemo, workflow se ustavi in veja ostane, kakršna je.
  if (Object.values(out.stores).every(st => !st.ok)) {
    console.error('Nobena trgovina ni uspela.');
    process.exitCode = 1;
    return;
  }
  await mkdir('data', { recursive: true });
  // Prazna polja izpustimo, da je datoteka manjša. food: false mora ostati (filter »samo hrana«).
  const deals = out.deals.map(compact);
  await writeFile('data/deals.json', JSON.stringify({ ...out, deals }));
}

// Zaženi samo, če je to glavna skripta (testi jo samo uvozijo).
if (/(^|[\\/])deals\.mjs$/.test(process.argv[1] ?? '')) await main();
