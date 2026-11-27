// Testi statistike (js/statistics.js). Izmišljeni podatki.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../js/stats.js';
import { periodMonths, monthlySavings, savingsSummary, spendPace, weekdaySpend, categoryTrends, monthEndForecast, fixedVariable, topMerchants, purchaseSizes, largestExpenses, noSpendDays } from '../js/statistics.js';

const kinds = { salary: 'income', food: 'expense', cafe: 'expense', rent: 'expense', transfer: 'transfer' };
const kindOf = id => kinds[id] ?? 'expense';
const tx = (date, amount, categoryId, extra = {}) => ({ date, amount, categoryId, currency: 'EUR', ...extra });

const data = [
  tx('2026-08-05', 2000, 'salary'), tx('2026-08-01', -500, 'rent', { seriesId: 's' }), tx('2026-08-10', -300, 'food'),
  tx('2026-09-05', 2000, 'salary'), tx('2026-09-01', -500, 'rent', { seriesId: 's' }), tx('2026-09-12', -900, 'food'), tx('2026-09-13', -100, 'cafe'),
  tx('2026-10-05', 2000, 'salary'), tx('2026-10-01', -500, 'rent', { seriesId: 's' }), tx('2026-10-03', -2500, 'food'),
  tx('2026-10-20', -1000, 'transfer'), tx('2026-10-21', -40, 'food', { currency: 'USD' }),
];

test('periodMonths', () => {
  assert.deepEqual(periodMonths('2026-08', '2026-10', 12), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(periodMonths('2026-01', '2026-10', 2), ['2026-09', '2026-10']);
  assert.deepEqual(periodMonths('2026-08', '2026-10', null), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(periodMonths(null, '2026-10', 6), []);
});

test('monthlySavings in povzetek: prenosi in tuje valute ne štejejo, stopnja iz vsot', () => {
  const idx = buildIndex(data, kindOf, 'EUR');
  const rows = monthlySavings(idx, ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(rows.map(r => r.saved), [1200, 500, -1000]);
  assert.deepEqual(rows.map(r => r.cum), [1200, 1700, 700]);
  assert.equal(rows[0].rate, 0.6);
  const s = savingsSummary(rows);
  assert.equal(s.saved, 700);
  assert.ok(Math.abs(s.rate - 700 / 6000) < 1e-9);
  assert.equal(s.best.month, '2026-08');
  assert.equal(s.worst.month, '2026-10');
  assert.equal(savingsSummary([]), null);
});

test('spendPace: kumulativa tekočega meseca do danes in povprečje preteklih', () => {
  const tx2 = [
    tx('2026-09-01', -100, 'food'), tx('2026-09-30', -100, 'food'),
    tx('2026-10-01', -300, 'food'), tx('2026-10-31', -100, 'food'),
    tx('2026-11-02', -50, 'food'), tx('2026-11-10', -50, 'food'), tx('2026-11-03', 500, 'salary'),
  ];
  const p = spendPace(tx2, kindOf, '2026-11', '2026-11-05');
  assert.equal(p.days.length, 30);
  assert.deepEqual(p.current.slice(0, 6), [0, 50, 50, 50, 50, null]);
  assert.deepEqual(p.months, ['2026-10', '2026-09']);
  assert.equal(p.average[0], 200); // (300 + 100) / 2
  assert.equal(p.average[29], 250); // okt. 30. dan = 300, sep. 30. dan = 200
  assert.equal(spendPace([], kindOf, '2026-11', '2026-11-05').average, null);
});

test('weekdaySpend: brez ponavljajočih, deljeno s številom dni', () => {
  // 2026-11-02 je ponedeljek; dva tedna
  const w = weekdaySpend([
    tx('2026-11-02', -20, 'food'), tx('2026-11-09', -40, 'food'), tx('2026-11-07', -90, 'cafe'),
    tx('2026-11-02', -500, 'rent', { seriesId: 's' }), tx('2026-11-03', -10, 'transfer'),
  ], kindOf, '2026-11-02', '2026-11-15');
  assert.deepEqual(w, [30, 0, 0, 0, 0, 45, 0]);
});

test('categoryTrends: podkategorije k glavni, sprememba zadnja proti prvi tretjini', () => {
  const tops = { cafe: 'food' };
  const idx = buildIndex(data, kindOf, 'EUR');
  const r = categoryTrends(idx, ['2026-08', '2026-09', '2026-10'], id => tops[id] ?? id);
  assert.deepEqual(r.map(x => x.id), ['food', 'rent']);
  assert.deepEqual(r[0].values, [300, 1000, 2500]);
  assert.ok(Math.abs(r[0].change - (2500 - 300) / 300) < 1e-9);
  assert.equal(r[1].change, 0);
  assert.equal(r[0].avg, 1266.67);
});

test('monthEndForecast: do danes + običajni preostanek', () => {
  const pace = { days: [1, 2, 3, 4], current: [10, 30, null, null], average: [5, 20, 50, 100] };
  assert.equal(monthEndForecast(pace, 2), 110); // 30 + (100 − 20)
  assert.equal(monthEndForecast({ ...pace, average: null }, 2), null);
  assert.equal(monthEndForecast(pace, 4), null);
});

test('fixedVariable: povprečje samo iz zaključenih mesecev', () => {
  const idx = buildIndex(data, kindOf, 'EUR');
  const fv = fixedVariable(idx, ['2026-08', '2026-09', '2026-10'], '2026-10');
  assert.deepEqual(fv.rows.map(r => r.variable), [300, 1000, 2500]);
  assert.equal(fv.fixed, 500);
  assert.equal(fv.variable, 650);
  assert.ok(Math.abs(fv.share - 500 / 1150) < 1e-9);
});

test('topMerchants: sklici ne razbijejo prejemnika, vračilo zmanjša vsoto', () => {
  const list = topMerchants([
    tx('2026-11-01', -30, 'food', { description: 'TRGOVINA A 123456' }),
    tx('2026-11-08', -50, 'food', { description: 'TRGOVINA A 987654' }),
    tx('2026-11-09', 10, 'food', { description: 'TRGOVINA A 555555' }),
    tx('2026-11-10', -20, 'cafe', { description: 'Kavarna B' }),
    tx('2026-11-11', 2000, 'salary', { description: 'Plača' }),
    tx('2026-10-01', -999, 'food', { description: 'Staro' }),
  ], kindOf, '2026-11-01', '2026-11-30');
  assert.deepEqual(list.map(m => [m.sum, m.count]), [[70, 2], [20, 1]]);
  assert.equal(list[0].perVisit, 35);
  assert.equal(list[0].categoryId, 'food');
  assert.ok(Math.abs(list[0].share - 70 / 90) < 1e-9);
});

test('purchaseSizes, largestExpenses: brez ponavljajočih in vračil', () => {
  const t = [
    tx('2026-11-01', -5, 'food'), tx('2026-11-02', -9.99, 'food'), tx('2026-11-03', -10, 'food'),
    tx('2026-11-04', -450, 'food'), tx('2026-11-05', -500, 'rent', { seriesId: 's' }), tx('2026-11-06', 20, 'food'),
  ];
  const s = purchaseSizes(t, kindOf, '2026-11-01', '2026-11-30');
  assert.deepEqual(s.rows.map(r => r.count), [2, 1, 0, 0, 1]);
  assert.equal(s.rows[0].sum, 14.99);
  assert.equal(s.count, 4);
  assert.equal(s.median, 10); // (9,99 + 10) / 2, zaokroženo
  assert.deepEqual(largestExpenses(t, kindOf, '2026-11-01', '2026-11-30', { n: 2 }).map(x => x.amount), [-450, -10]);
});

test('noSpendDays: šteje do zadnjega dne z zapisi, najdaljši niz', () => {
  const r = noSpendDays([
    tx('2026-11-01', -5, 'food'), tx('2026-11-05', -500, 'rent', { seriesId: 's' }), tx('2026-11-06', -5, 'food'),
    tx('2026-11-08', 100, 'salary'),
  ], kindOf, '2026-11-01', '2026-11-30');
  assert.deepEqual(r, { days: 6, total: 8, longest: 4, until: '2026-11-08' }); // 2.–5. brez, 7.–8. brez
  assert.equal(noSpendDays([], kindOf, '2026-11-01', '2026-11-30'), null);
});
