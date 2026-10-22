// Branje bančnih izpiskov v CSV obliki. Najprej prilagojeno Revolutu, deluje pa tudi z drugimi bankami.

import { normalize, guessCategory } from './categorize.js';

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [], field = '', quoted = false;
  const endRow = () => {
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  endRow();
  return rows;
}

// Windows-1250 znaki za bajte 0x80–0xFF (\0 = bajt nima znaka).
const CP1250 = '€\0‚\0„…†‡\0‰Š‹ŚŤŽŹ\0‘’“”•–—\0™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙';
const CP1250_BYTE = new Map([...CP1250].map((ch, i) => [ch, 0x80 + i]).filter(([ch]) => ch !== '\0'));
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Popravi besedilo, ki je bilo zapisano v UTF-8, prebrano pa kot Windows-1250 ("VarÄŤevanje" → "Varčevanje"). */
export function fixMojibake(s) {
  if (!/[ÂĂÄĹâ]/.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) bytes.push(code);
    else if (CP1250_BYTE.has(ch)) bytes.push(CP1250_BYTE.get(ch));
    else return s;
  }
  try {
    return utf8.decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

/** "1.234,56", "-12.50", "12,5 €" → število. */
export function parseNumber(value) {
  let s = String(value ?? '').replace(/[\s €$£]/g, '').replace(/^\+/, '').replace(/^−/, '-');
  if (!s) return NaN;
  if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return Number(s);
}

/** ISO, "D.M.YYYY" ali "D/M/YYYY" (dan najprej) → "YYYY-MM-DD". */
export function parseDate(value) {
  const s = String(value ?? '').trim();
  let y, m, d, match;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excelova serijska številka datuma (dni od 30. 12. 1899)
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  }
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [, y, m, d] = match;
  else if ((match = s.match(/^(\d{1,2})[./]\s?(\d{1,2})[./]\s?(\d{4})/))) [, d, m, y] = match;
  else return null;
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const COLUMN_FIELDS = {
  date: { label: 'Datum', required: true, names: ['started date', 'datum zacetka', 'zacetni datum', 'date', 'datum', 'datum transakcije', 'datum knjizenja', 'booking date'] },
  description: { label: 'Opis', required: true, names: ['description', 'opis', 'namen', 'merchant', 'prejemnik'] },
  amount: { label: 'Znesek', required: true, names: ['amount', 'znesek'] },
  fee: { label: 'Provizija', names: ['fee', 'provizija', 'pristojbina', 'nadomestilo'] },
  currency: { label: 'Valuta', names: ['currency', 'valuta'] },
  type: { label: 'Vrsta', names: ['type', 'vrsta', 'tip', 'vrsta transakcije'] },
  product: { label: 'Produkt', names: ['product', 'izdelek', 'produkt'] },
  state: { label: 'Status', names: ['state', 'status'] },
  completedDate: { label: 'Datum zaključka', names: ['completed date', 'datum zakljucka', 'datum dokoncanja', 'koncni datum'] },
};

/** Za vsako polje poišče indeks stolpca v glavi (-1, če ga ni). */
export function detectColumns(header) {
  const cols = header.map(normalize);
  const mapping = {};
  const used = new Set();
  for (const [key, { names }] of Object.entries(COLUMN_FIELDS)) {
    let i = cols.findIndex((c, idx) => !used.has(idx) && names.includes(c));
    if (i === -1 && COLUMN_FIELDS[key].required) i = cols.findIndex((c, idx) => !used.has(idx) && names.some(n => c.includes(n)));
    mapping[key] = i;
    if (i >= 0) used.add(i);
  }
  return mapping;
}

/** Pretvori vrstice v transakcije. Preskoči neuspele in še nedokončane (PENDING) transakcije. */
export function rowsToTransactions(rows, mapping, rules, baseCurrency = 'EUR') {
  const items = [];
  const skipped = { pending: 0, failed: 0, invalid: 0 };
  const seen = new Map();

  for (const r of rows.slice(1)) {
    const get = key => (mapping[key] >= 0 ? String(r[mapping[key]] ?? '').trim() : '');
    const state = get('state').toUpperCase();
    if (/REVERTED|DECLINED|FAILED|CANCEL/.test(state)) { skipped.failed++; continue; }
    if (state === 'PENDING') { skipped.pending++; continue; }

    const date = parseDate(get('date')) ?? parseDate(get('completedDate'));
    let amount = parseNumber(get('amount'));
    if (!date || !Number.isFinite(amount)) { skipped.invalid++; continue; }
    const fee = parseNumber(get('fee'));
    if (Number.isFinite(fee)) amount -= Math.abs(fee);
    amount = Math.round(amount * 100) / 100;
    if (amount === 0) { skipped.invalid++; continue; }

    const description = fixMojibake(get('description')).replace(/\s+/g, ' ');
    const currency = (get('currency') || baseCurrency).toUpperCase();
    const type = get('type').toUpperCase().replace(/[\s-]+/g, '_'); // "Card Payment" → CARD_PAYMENT
    const product = get('product');

    // Prstni odtis vrstice: isti izpisek ali prekrivajoči se izpiski ne podvojijo transakcij.
    const key = [get('date'), get('amount'), get('fee'), description, currency, product].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);

    const { categoryId, source } = guessCategory({ description, amount, type, product }, rules);
    items.push({ date, amount, currency, description, type, product, importHash: n > 1 ? `${key}#${n}` : key, categoryId, categorySource: source });
  }
  return { items, skipped };
}
