// Branje PDF-jev na napravi (pdf.js): besedilo s položaji, vrstice računa in slike strani.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build';
const PDFJS_SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';
const MAX_PAGES = 10; // račun; varovalka pred napačno izbranim dolgim PDF-jem

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

/** Odpre PDF. isEvalSupported: false, da PDF ne more zagnati kode (CVE-2024-4367). */
export async function openPdf(file) {
  const pdfjs = await loadPdfJs();
  try {
    return await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('PDF je zaklenjen z geslom. Shrani ga brez gesla in poskusi znova.');
    throw new Error('PDF-ja ni bilo mogoče odpreti. Datoteka je morda poškodovana.');
  }
}

/** Besedilo strani s položaji: [{ s, x, y, w, h }]. */
export async function pageItems(page) {
  const tc = await page.getTextContent();
  return tc.items.map(t => ({ s: t.str, x: t.transform[4], y: t.transform[5], w: t.width, h: t.height }));
}

export const isPdf = file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');

/**
 * Besedilo s položaji → vrstice od zgoraj navzdol (kot jih vidiš na računu).
 * Deli na isti višini so ena vrstica; večji razmik postane več presledkov, da znesek ostane ločen od imena.
 */
export function pdfLines(items) {
  const rows = [];
  for (const it of items.filter(i => i.s?.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - it.y) <= Math.max(1.5, 0.4 * Math.min(row.h, it.h || row.h))) row.items.push(it);
    else rows.push({ y: it.y, h: it.h || 8, items: [it] });
  }
  return rows.map(row => {
    let out = '', end = null;
    for (const it of row.items.sort((a, b) => a.x - b.x)) {
      const gap = end == null ? 0 : it.x - end;
      if (end != null) out += gap > row.h * 1.2 ? '   ' : gap > row.h * 0.12 ? ' ' : '';
      out += it.s;
      end = it.x + (it.w ?? 0);
    }
    return out.trim();
  });
}

/** Ali je v PDF-ju pravo besedilo (sicer je skeniran in ga je treba prebrati kot sliko). */
export const hasText = text => (text.match(/\p{L}/gu) ?? []).length >= 20 && /\d[.,]\d{2}/.test(text);

/**
 * Prebere račun iz PDF-ja. Digitalni račun: besedilo naravnost (brez napak branja slik).
 * Skeniran: strani nariše in jih prebere z `ocr(canvas, onProgress)`.
 */
export async function readPdfReceipt(file, onProgress, ocr) {
  onProgress(0, 'Odpiram PDF …');
  const pdf = await openPdf(file);
  try {
    if (pdf.numPages > MAX_PAGES) throw new Error(`PDF ima ${pdf.numPages} strani, kar ni račun (največ ${MAX_PAGES}).`);
    const lines = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      lines.push(...pdfLines(await pageItems(await pdf.getPage(n))));
      onProgress(n / pdf.numPages, 'Berem PDF …');
    }
    const text = lines.join('\n');
    if (hasText(text)) return text;
    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1800 / base.width, 3200 / base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      out.push(await ocr(canvas, (p, label) => onProgress((n - 1 + p) / pdf.numPages, label), pdf.numPages === 1));
    }
    return out.join('\n');
  } finally {
    await pdf.destroy();
  }
}
