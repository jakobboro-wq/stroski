// Branje Excel (.xlsx) datotek brez zunanjih knjižnic. Xlsx je zip arhiv z XML datotekami;
// preberemo prvi list in vrnemo vrstice kot tabelo besedil (enako kot parseCSV).

import { parseCSV } from './csv.js';

export const isXlsx = bytes => bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK" = zip

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Datoteka ni veljaven Excel (.xlsx).');

  const files = new Map();
  let p = view.getUint32(eocd + 16, true);
  const count = view.getUint16(eocd + 10, true);
  for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, { method, data: bytes.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return async name => {
    const f = files.get(name);
    if (!f) return null;
    if (f.method === 0) return new TextDecoder().decode(f.data);
    const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const unescapeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

const textOf = xml => unescapeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Vrstice lista kot tabela besedil; stolpec A je indeks 0. Formule vrnejo shranjeno (izračunano) vrednost. */
function parseSheet(sheet, shared) {
  const rows = [];
  for (const [, rowXml] of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, attrs, body = ''] of rowXml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (v != null) value = unescapeXml(v);
      row[ref ? columnIndex(ref) : row.length] = value;
    }
    rows.push(Array.from(row, c => c ?? ''));
  }
  return rows;
}

async function openWorkbook(buffer) {
  const read = await unzip(buffer);
  const shared = [...((await read('xl/sharedStrings.xml')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map([...rels.matchAll(/<Relationship\s[^>]*>/g)].map(([tag]) => [
    tag.match(/Id="([^"]+)"/)?.[1],
    tag.match(/Target="\/?(?:xl\/)?([^"]+)"/)?.[1],
  ]));
  const workbook = (await read('xl/workbook.xml')) ?? '';
  const sheets = [...workbook.matchAll(/<sheet\s[^>]*>/g)].map(([tag]) => ({
    name: unescapeXml(tag.match(/name="([^"]+)"/)?.[1] ?? ''),
    path: `xl/${targets.get(tag.match(/r:id="([^"]+)"/)?.[1]) ?? 'worksheets/sheet1.xml'}`,
  }));
  return { read, shared, sheets };
}

/** Vsi listi: [{ name, rows }] */
export async function readXlsxSheets(buffer) {
  const { read, shared, sheets } = await openWorkbook(buffer);
  return Promise.all(sheets.map(async s => ({ name: s.name, rows: parseSheet((await read(s.path)) ?? '', shared) })));
}

export async function readXlsx(buffer) {
  const { read, shared, sheets } = await openWorkbook(buffer);
  const sheet = await read(sheets[0]?.path ?? 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('V Excel datoteki ni lista s podatki.');
  const rows = parseSheet(sheet, shared);

  // Revolut zapiše vsako CSV vrstico v en sam stolpec — v tem primeru jo razčlenimo kot CSV.
  const head = rows[0] ?? [];
  if (head.filter(Boolean).length === 1 && /[,;\t]/.test(head[0])) {
    return parseCSV(rows.map(r => r[0] ?? '').join('\n'));
  }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
