// Branje Hoferjevega letaka (PDF), ki ga preneseš sam. Vse se zgodi na napravi.
// parseLeaflet dela s položaji besedila na straneh, zato se da preizkusiti brez brskalnika.

const PRICE = /^\d{1,4},\d{2}$/;
const DATE = /^(\d{1,2})\.\s?(\d{1,2})\.$/;
const UNIT = /\d\s?(g|kg|ml|l|cl|kos|kosov|par|m|cm)\b|^za\s/i;
const NOISE = /^(za kos|za kg|za \d|stara cena:?|nova redna cena|prej|od|do|pon|tor|sre|čet|pet|sob|ned)$/i;
// Reklamni napisi ob ceni niso ime izdelka (»ZAGRAB PONUDBO«, »NIZKA CENA«, »samo«).
const PROMO = /zagrab|ponudb|^samo$|nizka cena|super cena|to ni akcija|stalna|vsak dan|^novo!?$|^za (kos|par)\/za (kos|par)$/i;

/**
 * Hofer nov tekst nariše čez starega na isto mesto (npr. nov datum na nalepki).
 * Na enem mestu obdrži samo zadnje narisano besedilo.
 */
export function topmost(items) {
  const byPos = new Map();
  items.forEach((it, order) => {
    if (!it.s?.trim()) return;
    byPos.set(`${Math.round(it.x / 3)},${Math.round(it.y / 3)},${Math.round(it.h / 3)}`, { ...it, s: it.s.trim(), order });
  });
  return [...byPos.values()];
}

const num = s => Number(s.replace(',', '.'));
const round2 = v => Math.round(v * 100) / 100;
const addDays = (isoDay, n) => { const d = new Date(`${isoDay}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Obdobje na strani: prvi dva datuma (od, do). Leto iz današnjega dne (letak čez novo leto). */
function pageDates(items, today) {
  // Na isti vrstici obdrži zadnje narisani datum (nalepka z novim datumom čez starega).
  const byLine = new Map();
  for (const d of items.filter(i => DATE.test(i.s))) {
    const k = Math.round(d.y / 6);
    if (!byLine.has(k) || (d.order ?? 0) > (byLine.get(k).order ?? 0)) byLine.set(k, d);
  }
  const dates = [...byLine.values()].sort((a, b) => b.y - a.y || a.x - b.x);
  if (!dates.length) return {};
  const [ty, tm] = today.split('-').map(Number);
  const toIso = s => {
    const [, d, m] = s.match(DATE).map(Number);
    const y = m < tm - 6 ? ty + 1 : m > tm + 6 ? ty - 1 : ty;
    return iso(y, m, d);
  };
  const f = toIso(dates[0].s);
  const to = dates[1] ? toIso(dates[1].s) : null;
  return { f, to: to && to >= f ? to : null };
}

/** Ime izdelka: najbližji blok vrstic nad ceno v istem stolpcu (znamka, ime, embalaža). */
function nameAbove(price, items) {
  const col = items
    .filter(i => i !== price && i.y > price.y && i.y < price.y + 320 && i.x >= price.x - 28 && i.x <= price.x + 6 && i.h <= 14 && !PRICE.test(i.s) && !NOISE.test(i.s) && !PROMO.test(i.s))
    .sort((a, b) => a.y - b.y);
  // Najbližji blok, v katerem je vsaj ena vrstica imena (velike črke, višina ≥ 10).
  let block = [];
  for (const line of col) {
    if (block.length && line.y - block.at(-1).y > 18) {
      if (block.some(l => l.h >= 10)) break;
      block = [];
    }
    block.push(line);
  }
  if (!block.some(l => l.h >= 10)) return null;
  const top = [...block].sort((a, b) => b.y - a.y);
  const brand = top.filter(l => l.h <= 7 && !l.s.startsWith('•')).map(l => l.s);
  const name = top.filter(l => l.h >= 10).map(l => l.s);
  const pack = top.find(l => l.h > 7 && l.h < 10 && !l.s.startsWith('•') && UNIT.test(l.s))?.s ?? null;
  const full = [...brand, ...name].join(' ').replace(/\s+/g, ' ').replace(/‘|’/g, "'").trim();
  return full ? { name: full, pack } : null;
}

/** Prejšnja cena (»STARA CENA: 1,99« ali prečrtana) in popust (»-12%«) nad ceno. */
function oldAndDiscount(price, items) {
  const near = items.filter(i => i.y > price.y && i.y < price.y + 85 && i.x >= price.x - 30 && i.x <= price.x + 90);
  const disc = near.map(i => i.s.match(/^-\s?(\d{1,2})\s?%$/)).find(Boolean);
  const old = near.filter(i => PRICE.test(i.s) && i.h < 20 && num(i.s) > num(price.s)).sort((a, b) => a.y - b.y)[0];
  return { o: old ? num(old.s) : null, d: disc ? Number(disc[1]) : null };
}

/**
 * Iz strani letaka (seznam besedil s položaji {s, x, y, h}; y raste navzgor) naredi akcije.
 * Vrne seznam v isti obliki kot ostale akcije.
 */
export function parseLeaflet(pages, today) {
  const out = [];
  const seen = new Set();
  const cleaned = pages.map(topmost);
  // Glavno obdobje letaka (najpogostejši par od–do); strani brez datuma ga podedujejo.
  const perPage = cleaned.map(items => pageDates(items, today));
  const pairs = perPage.filter(d => d.f && d.to).map(d => `${d.f}|${d.to}`);
  const common = pairs.sort((a, b) => pairs.filter(x => x === b).length - pairs.filter(x => x === a).length)[0];
  const [mainF, mainTo] = common ? common.split('|') : [perPage.find(d => d.f)?.f ?? null, null];
  cleaned.forEach((items, pageIndex) => {
    const page = perPage[pageIndex];
    const f = page.f ?? mainF;
    // Ponudba »od četrtka« velja do razprodaje: vsaj do konca letaka in vsaj teden dni.
    const to = page.to ?? (f && f === mainF && mainTo ? mainTo : f ? [mainTo, addDays(f, 6)].filter(Boolean).sort().at(-1) : null);
    for (const price of items.filter(i => PRICE.test(i.s) && i.h >= 25)) {
      const name = nameAbove(price, items);
      if (!name) continue;
      const p = num(price.s);
      const { o, d } = oldAndDiscount(price, items);
      const old = o ?? (d ? round2(p / (1 - d / 100)) : null);
      const unitPrice = items.find(i => i.y < price.y && i.y > price.y - 20 && i.x > price.x && i.x < price.x + 90 && /^\d+,\d{2}\/(kg|l|m|kos)$/.test(i.s))?.s ?? null;
      const key = `${name.name}|${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        s: 'hofer', n: name.name, p, o: old && old > p ? old : null, d: d ?? (old && old > p ? Math.round((1 - p / old) * 100) : null),
        q: name.pack, b: unitPrice ? unitPrice.replace(/^(.*)\/(.*)$/, '1 $2 = $1') : null,
        u: 'https://www.hofer.si/sl/ponudba.html', i: null, c: null, food: null, t: `Letak, str. ${pageIndex + 1}`, f, to,
      });
    }
  });
  return out;
}

// ---------- V brskalniku: branje PDF-ja s pdf.js ----------
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build';
const PDFJS_SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';

let loading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${PDFJS}/pdf.min.js`;
    s.integrity = PDFJS_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`; resolve(window.pdfjsLib); };
    s.onerror = () => { loading = null; reject(new Error('Bralnika PDF ni bilo mogoče naložiti. Si povezan na internet?')); };
    document.head.append(s);
  });
  return loading;
}

/** Prebere besedilo vseh strani PDF-ja. `onProgress(delež 0–1)`. */
export async function readLeafletPdf(file, onProgress = () => {}) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    pages.push(tc.items.map(t => ({ s: t.str, x: t.transform[4], y: t.transform[5], h: t.height })));
    onProgress(n / pdf.numPages);
  }
  await pdf.destroy();
  return pages;
}
