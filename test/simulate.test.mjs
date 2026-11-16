// Testi simulacije proračuna (js/simulate.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng, monthlyHistory, simulate, averageMonth, buildInputs } from '../js/simulate.js';

const kinds = { salary: 'income', groceries: 'expense', rent: 'expense', transfer: 'transfer' };
const kindOf = id => kinds[id] ?? 'expense';

test('rng: ponovljiv in v [0, 1)', () => {
  const a = rng(42), b = rng(42);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every(x => x >= 0 && x < 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05);
});

test('monthlyHistory: stalno/spremenljivo, brez prenosov, tekočega meseca in tujih valut', () => {
  const tx = [
    { date: '2026-09-05', amount: 1500, categoryId: 'salary', seriesId: 's1', currency: 'EUR' },
    { date: '2026-09-10', amount: 200, categoryId: 'salary', currency: 'EUR' },
    { date: '2026-09-01', amount: -400, categoryId: 'rent', seriesId: 's2', currency: 'EUR' },
    { date: '2026-09-12', amount: -310.5, categoryId: 'groceries', currency: 'EUR' },
    { date: '2026-09-20', amount: -1000, categoryId: 'transfer', currency: 'EUR' },
    { date: '2026-09-21', amount: -50, categoryId: 'groceries', currency: 'USD' },
    { date: '2026-11-02', amount: -99, categoryId: 'groceries', currency: 'EUR' },
  ];
  assert.deepEqual(monthlyHistory(tx, kindOf, '2026-11'), [{ month: '2026-09', incFix: 1500, incVar: 200, outFix: 400, outVar: 310.5 }]);
});

const months = ['2026-12', '2027-01', '2027-02', '2027-03'];

test('simulate: brez naključja je rezultat točen', () => {
  const r = simulate({ months, history: [{ incVar: 100, outVar: 300 }], fixed: months.map(() => ({ inc: 1500, out: 400 })), cash0: 1000, runs: 50, vol: 0, rate: 0, other: [500, 500, 500, 500], debts: [100, 90, 80, 70] });
  // vsak mesec +900
  assert.deepEqual(r.cash.map(b => b.p50), [1900, 2800, 3700, 4600]);
  assert.equal(r.cash[3].p10, r.cash[3].p90);
  assert.deepEqual(r.net.map(b => b.p50), [2300, 3210, 4120, 5030]);
  assert.equal(r.pBelow, 0);
});

test('simulate: razpon iz zgodovine in verjetnost pod mejo', () => {
  const history = [{ incVar: 0, outVar: 200 }, { incVar: 0, outVar: 1400 }];
  const r = simulate({ months, history, fixed: months.map(() => ({ inc: 1000, out: 0 })), cash0: 300, runs: 4000, vol: 0, seed: 7 });
  // mesec je +800 ali −400 z verjetnostjo 1/2; prvi mesec pod 0 v polovici poti
  assert.ok(r.cash[0].p10 === -100 && r.cash[0].p90 === 1100);
  assert.ok(r.pBelow > 0.45 && r.pBelow < 0.75, `pBelow ${r.pBelow}`);
  assert.ok(r.minCash.p10 < 0);
  // mediana po 4 mesecih ≈ 300 + 4·200
  assert.ok(Math.abs(r.cash[3].p50 - 1100) <= 1200);
});

test('simulate: naložbe z donosom in mesečnim vplačilom', () => {
  const r = simulate({ months: Array.from({ length: 12 }, (_, i) => `m${i}`), history: [], fixed: [], cash0: 0, invest0: 1000, investMonthly: 100, rate: 0.07, vol: 0.15, runs: 4000, seed: 3 });
  const end = r.invest[11];
  // pričakovano ≈ 1000·1,07 + 100·12 (+ malo donosa) ≈ 2310; razpon zaradi volatilnosti
  assert.ok(end.p50 > 2150 && end.p50 < 2450, `p50 ${end.p50}`);
  assert.ok(end.p10 < end.p50 && end.p50 < end.p90);
  assert.equal(r.cash[11].p50, -1200); // vplačila gredo z računa
});

test('averageMonth', () => {
  assert.deepEqual(averageMonth([{ incVar: 100, outVar: 300 }, { incVar: 300, outVar: 500 }], [{ inc: 1500, out: 400 }]), { inc: 1700, out: 800, net: 900 });
});

test('simulate: preostanek tekočega meseca (varScale)', () => {
  const r = simulate({ months: ['zdaj', 'naslednji'], history: [{ incVar: 0, outVar: 1000 }], fixed: [{ inc: 0, out: 0 }, { inc: 0, out: 0 }], varScale: [0.25, 1], cash0: 2000, runs: 10, vol: 0, rate: 0 });
  assert.deepEqual(r.cash.map(b => b.p50), [1750, 750]);
});

test('buildInputs: meseci, stalni del iz predlog, denar, stvari in dolgovi', () => {
  const recurring = [
    { id: 's1', anchor: '2026-01-05', every: 'month', amount: 1500, categoryId: 'salary', currency: 'EUR' },
    { id: 's2', anchor: '2026-01-20', every: 'month', amount: -400, categoryId: 'rent', currency: 'EUR' },
    { id: 's3', anchor: '2026-01-01', every: 'month', amount: -100, categoryId: 'transfer', currency: 'EUR' },
  ];
  const assets = [
    { kind: 'asset', type: 'cash', method: 'manual', value: 2500, valueDate: '2026-11-01' },
    { kind: 'asset', type: 'property', method: 'none', price: 1000, purchaseDate: '2020-01-01' },
    { kind: 'debt', type: 'person', method: 'manual', balance: 300 },
  ];
  const tx = [{ date: '2026-10-03', amount: -250, categoryId: 'groceries', currency: 'EUR' }];
  const inp = buildInputs({ transactions: tx, recurring, assets, kindOf, today: '2026-11-16', horizon: 2 });
  assert.deepEqual(inp.months, ['2026-11', '2026-12', '2027-01']);
  assert.ok(Math.abs(inp.varScale[0] - 14 / 30) < 1e-9);
  // november: plača 5. 11. je že mimo, najemnina 20. 11. še pride
  assert.deepEqual(inp.fixed, [{ inc: 0, out: 400 }, { inc: 1500, out: 400 }, { inc: 1500, out: 400 }]);
  assert.deepEqual(inp.history, [{ month: '2026-10', incFix: 0, incVar: 0, outFix: 0, outVar: 250 }]);
  assert.equal(inp.cash0, 2500);
  assert.equal(inp.cashFromAssets, true);
  assert.deepEqual(inp.other, [1000, 1000, 1000]);
  assert.deepEqual(inp.debts, [300, 300, 300]);
  assert.equal(buildInputs({ transactions: [], kindOf, today: '2026-11-16', cashStart: 800 }).cash0, 800);
});
