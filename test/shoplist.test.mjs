// Testi optimizacije nakupovalnega seznama (js/shoplist.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeOf, offersFor, costsFor, optimize } from '../js/shoplist.js';
import { purchases } from '../js/pantry.js';

const TODAY = '2026-11-16';
const deal = (s, n, p, over = {}) => ({ s, n, p, to: '2026-11-22', ...over });
const rc = (date, store, items) => ({ source: 'receipt', date, description: store, items });

test('storeOf: imena trgovin z računov', () => {
  assert.equal(storeOf('MERCATOR d.d.'), 'mercator');
  assert.equal(storeOf('Lidl Slovenija d.o.o. k.d.'), 'lidl');
  assert.equal(storeOf('Tuš'), 'tus');
  assert.equal(storeOf('HOFER trgovina d.o.o.'), 'hofer');
  assert.equal(storeOf('Interspar'), 'spar');
  assert.equal(storeOf('Kavarna Moka'), null);
});

test('offersFor in costsFor: primerjava na liter z običajno količino', () => {
  const deals = [
    deal('mercator', 'Trajno mleko 3,5 %, 6 x 1 l', 5.99, { up: 1, uu: 'l' }),
    deal('tus', 'Alpsko mleko 1 l', 1.09, { up: 1.09, uu: 'l' }),
    deal('lidl', 'Mlečna čokolada', 0.99),
    deal('lidl', 'Mleko prihodnji teden 1 l', 0.5, { up: 0.5, uu: 'l', f: '2026-11-19' }),
  ];
  const history = purchases([rc('2026-11-10', 'Lidl', [{ name: 'MLEKO 1L', amount: 0.99 }])]);
  const offers = offersFor('mleko', deals, history, TODAY);
  assert.deepEqual(offers.map(o => [o.store, o.source]).sort(), [['lidl', 'mine'], ['mercator', 'deal'], ['tus', 'deal']]);
  const { costs, unit, ref } = costsFor(offers, history, 'mleko');
  assert.equal(unit, 'l');
  assert.equal(ref, 1); // običajno kupiš 1 l
  assert.equal(costs.get('mercator').cost, 1);
  assert.equal(costs.get('lidl').cost, 0.99);
  assert.equal(costs.get('tus').cost, 1.09);
});

test('optimize: ena ali dve trgovini glede na prag', () => {
  const deals = [
    deal('lidl', 'Banane', 1.0), deal('mercator', 'Banane', 1.5),
    deal('mercator', 'Kava Barcaffe 400 g', 4.0), deal('lidl', 'Kava Barcaffe 400 g', 7.0),
    deal('tus', 'Testenine špageti 500 g', 0.8),
  ];
  const items = [{ text: 'banane' }, { text: 'kava barcaffe' }, { text: 'spageti' }, { text: 'neznano xyz' }];
  // Kava in špageti imata velikost → primerjava na 1 kg: kava 10 €/kg (Mercator), 17,5 (Lidl); špageti 1,6.
  // Brez praga: Lidl + Mercator = 1,0 + 10 + 1,6 (najdražje znano, ker špagetov ni v izbranih) = 12,6
  const two = optimize(items, deals, [], TODAY, { maxStores: 2, extraStoreCost: 0 });
  assert.deepEqual(two.best.stores.sort(), ['lidl', 'mercator']);
  assert.equal(two.best.total, 12.6);
  assert.deepEqual(two.unknown, ['neznano xyz']);
  const spag = two.best.plan.find(p => p.text === 'spageti');
  assert.equal(spag.estimated, true); // ni akcije v izbranih trgovinah
  // S pragom 5 €: druga trgovina prihrani le 0,5 € (Mercator sam: 1,5 + 10 + 1,6 = 13,1) → ena trgovina
  const one = optimize(items, deals, [], TODAY, { maxStores: 2, extraStoreCost: 5 });
  assert.deepEqual(one.best.stores, ['mercator']);
  assert.equal(one.best.total, 13.1);
  assert.equal(one.single[0].store, 'mercator');
  // Samo izbrane trgovine
  const only = optimize(items, deals, [], TODAY, { stores: ['tus', 'lidl'], maxStores: 1, extraStoreCost: 0 });
  assert.ok(['tus', 'lidl'].includes(only.best.stores[0]));
});

test('optimize: prazen seznam', () => {
  const r = optimize([], [], [], TODAY);
  assert.equal(r.best, null);
  assert.equal(r.count, 0);
});

test('offersFor: skupina postavke loči »sir« od »širokih rezancev«', () => {
  const deals = [deal('mercator', 'Široki jajčni rezanci, 400 g', 0.9, { g: 'shramba' }), deal('lidl', 'Sir gavda, 150 g', 1.5, { g: 'mlecni' })];
  assert.deepEqual(offersFor('sir', deals, [], TODAY).map(o => o.store), ['lidl']);
});
