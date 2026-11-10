// Enkrat na dan pobere akcije z javnih strani trgovin in jih zapiše v data/deals.json.
// Bere samo javne strani z akcijami (tiste, ki jih vidiš v brskalniku), počasi in pod svojim imenom.
// Zaženi: node scraper/deals.mjs

import { writeFile, mkdir } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (compatible; stroski-app/1.0; osebni sledilnik cen; +https://github.com/jakobboro-wq/stroski)';
const PAUSE_MS = 1500; // premor med zahtevami, da trgovine ne obremenjujemo
const MAX_PAGES = 25;

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

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'sl-SI,sl;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
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
  const all = new Map();
  for (const path of lidlCampaigns(home)) {
    await sleep(PAUSE_MS);
    const html = await get(`${LIDL}${path}`).catch(() => '');
    for (const it of parseLidl(html)) if (!all.has(it.id)) all.set(it.id, it);
  }
  return [...all.values()].map(({ id, ...it }) => it);
}

// ---------- Zagon ----------
const STORES = { tus: scrapeTus, lidl: scrapeLidl };

async function main() {
  const stores = {};
  const deals = [];
  for (const [id, fn] of Object.entries(STORES)) {
    try {
      const list = await fn();
      deals.push(...list);
      stores[id] = { ok: true, count: list.length };
    } catch (e) {
      stores[id] = { ok: false, count: 0, error: String(e.message).slice(0, 200) };
    }
    console.log(id, stores[id]);
  }
  await mkdir('data', { recursive: true });
  await writeFile('data/deals.json', JSON.stringify({ updatedAt: new Date().toISOString(), stores, deals }));
  if (!deals.length) process.exitCode = 1;
}

// Zaženi samo, če je to glavna skripta (testi jo samo uvozijo).
if (/(^|[\\/])deals\.mjs$/.test(process.argv[1] ?? '')) await main();
