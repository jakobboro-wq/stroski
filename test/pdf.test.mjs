// Testi branja računa iz PDF-ja (js/pdf.js). Izmišljen račun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfLines, hasText, isPdf } from '../js/pdf.js';
import { parseReceipt } from '../js/receipt.js';

const it = (s, x, y, w = s.length * 5) => ({ s, x, y, w, h: 10 });

test('pdfLines: vrstice po višini, stolpci ločeni, razbite besede združene', () => {
  const lines = pdfLines([it('1,29', 300, 700.4), it('MLE', 20, 700, 15), it('KO', 35.2, 700, 10), it('KRUH', 20, 685), it('1,89', 300, 685), it(' ', 90, 685)]);
  assert.deepEqual(lines, ['MLEKO   1,29', 'KRUH   1,89']);
});

test('račun iz PDF-ja: postavke, datum in vsota se ujemajo', () => {
  const rows = [['TESTNA TRGOVINA d.o.o.'], ['Datum: 20.11.2026'], ['MLEKO', '1,29'], ['JABOLKA', '2,10'], ['SKUPAJ EUR', '3,39']];
  const text = pdfLines(rows.flatMap(([a, b], i) => [it(a, 20, 700 - i * 15), ...(b ? [it(b, 300, 700 - i * 15)] : [])])).join('\n');
  assert.ok(hasText(text));
  const r = parseReceipt(text, { today: '2026-11-23' });
  assert.deepEqual([r.date, r.total, r.matches, r.items.map(i => i.amount)], ['2026-11-20', 3.39, true, [1.29, 2.1]]);
});

test('hasText in isPdf', () => {
  assert.ok(!hasText(''));
  assert.ok(isPdf({ type: '', name: 'Racun.PDF' }) && !isPdf({ type: 'image/jpeg', name: 'a.jpg' }));
});
