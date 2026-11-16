// Enkrat na dan pobere akcije z javnih strani trgovin in jih zapiše v data/deals.json.
// Bere samo javne strani z akcijami (tiste, ki jih vidiš v brskalniku), počasi in pod svojim imenom.
// Zaženi: node scraper/deals.mjs

import { writeFile, readFile, mkdir } from 'node:fs/promises';

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

async function get(url, retry = true) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'sl-SI,sl;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { status: res.status });
    return await res.text();
  } catch (e) {
    // Enkrat ponovi ob prekinjeni povezavi ali napaki strežnika (5xx); 4xx ne.
    if (!retry || (e.status && e.status < 500)) throw e;
    await sleep(5000);
    return get(url, false);
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

// ---------- Zagon ----------
const STORES = { tus: scrapeTus, lidl: scrapeLidl, hofer: scrapeHofer };

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

async function readPrev() {
  try { return JSON.parse(await readFile(PREV_FILE, 'utf8')); } catch { return null; }
}

async function main() {
  const prev = await readPrev();
  if (!prev) console.warn(`Ni ${PREV_FILE}: ob napaki ne bo včerajšnjih podatkov.`);
  const results = {};
  for (const [id, fn] of Object.entries(STORES)) {
    try { results[id] = { list: await fn() }; } catch (e) { results[id] = { error: e.message }; }
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
  await writeFile('data/deals.json', JSON.stringify(out));
}

// Zaženi samo, če je to glavna skripta (testi jo samo uvozijo).
if (/(^|[\\/])deals\.mjs$/.test(process.argv[1] ?? '')) await main();
