// Testi iskanja, filtrov in ujemanja »Zate« (js/deals.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordOf, nameHas, isCurrent, dealsForYou, filterDeals, validity, mergeLeaflet, groupCounts, byGroup, unitLabel, isFoodDeal, historyNotes, notReal } from '../js/deals.js';

const TODAY = '2026-11-14';
const d = (n, over = {}) => ({ s: 'tus', n, p: 1, o: null, d: null, food: true, ...over });

test('keywordOf: prva smiselna beseda z računa', () => {
  assert.equal(keywordOf('MLEKO ALPSKO 1L'), 'mleko');
  assert.equal(keywordOf('BIO JOGURT 500G'), 'jogurt');
  assert.equal(keywordOf('Tuš kruh'), 'kruh');
  assert.equal(keywordOf('ČOKOLADA MLEČNA'), 'cokolada');
  assert.equal(keywordOf('1L 2X'), null);
});

test('nameHas: začetek besede, brez šumnikov in velikih črk', () => {
  assert.ok(nameHas(d('Mleko Alpsko 3,5 %'), 'mlek'));
  assert.ok(nameHas(d('Čokolada Milka'), 'cokol'));
  assert.ok(nameHas(d('Kava Barcaffe mleta'), 'kava mleta'));
  assert.ok(!nameHas(d('Mlečni namaz'), 'mleko'));
  assert.ok(!nameHas(d('Kokosovo mleko'), 'kos'));
  assert.ok(nameHas(d('karkoli'), '  '));
});

test('isCurrent in validity', () => {
  assert.ok(isCurrent(d('a'), TODAY));
  assert.ok(isCurrent(d('a', { to: TODAY }), TODAY));
  assert.ok(!isCurrent(d('a', { to: '2026-11-13' }), TODAY));
  assert.equal(validity(d('a', { f: '2026-11-17', to: '2026-11-23' }), TODAY), 'od 17. 11.');
  assert.equal(validity(d('a', { f: '2026-11-10', to: '2026-11-16' }), TODAY), 'do 16. 11.');
  assert.equal(validity(d('a'), TODAY), '');
});

test('dealsForYou: spremljano in kupljeno, brez dvojnikov in poteklih, po popustu', () => {
  const deals = [
    d('Mleko Alpsko', { d: 10 }),
    d('Mleko Alpsko', { d: 10 }),
    d('Kava mleta', { d: 30, s: 'lidl' }),
    d('Kava stara', { d: 50, to: '2026-11-01' }),
    d('Pivo Laško', { d: 5 }),
  ];
  const out = dealsForYou(deals, { watch: ['kava'], bought: ['MLEKO 1L', 'mleko polnomastno'] }, TODAY);
  assert.deepEqual(out.map(x => x.deal.n), ['Kava mleta', 'Mleko Alpsko']);
  assert.deepEqual(out.map(x => [x.why, x.watched]), [['kava', true], ['mleko', false]]);
});

test('filterDeals: trgovina, hrana, iskanje in razvrščanje', () => {
  const deals = [
    d('Banana', { p: 1.2, d: 20, g: 'sadje' }),
    d('Detergent', { p: 6, d: 40, food: false, g: 'drogerija' }),
    d('Avokado', { p: 0.8, s: 'lidl', g: 'sadje' }),
    d('Hofer sir', { p: 2, s: 'hofer', food: null, g: 'mlecni' }),
    d('Neznano', { p: 3, s: 'hofer', food: null }),
  ];
  assert.deepEqual(filterDeals(deals, {}, TODAY).map(x => x.n), ['Detergent', 'Banana', 'Avokado', 'Hofer sir', 'Neznano']);
  assert.deepEqual(filterDeals(deals, { mode: 'food', sort: 'price' }, TODAY).map(x => x.n), ['Avokado', 'Banana', 'Hofer sir']);
  assert.deepEqual(filterDeals(deals, { store: 'lidl' }, TODAY).map(x => x.n), ['Avokado']);
  assert.deepEqual(filterDeals(deals, { stores: ['lidl', 'hofer'], mode: 'food' }, TODAY).map(x => x.n), ['Avokado', 'Hofer sir']);
  assert.deepEqual(filterDeals(deals, { query: 'ban', sort: 'name' }, TODAY).map(x => x.n), ['Banana']);
  assert.deepEqual(filterDeals(deals, { group: 'sadje', sort: 'price' }, TODAY).map(x => x.n), ['Avokado', 'Banana']);
  assert.deepEqual(filterDeals(deals, { group: 'drugo' }, TODAY).map(x => x.n), ['Neznano']);
});

test('filterDeals: popust, kartica, prihodnje akcije, cena na enoto', () => {
  const deals = [
    d('Mleko A', { d: 10, up: 1.2, uu: 'l', g: 'mlecni' }),
    d('Mleko B', { d: 35, up: 0.9, uu: 'l', plus: true, g: 'mlecni' }),
    d('Mleko C', { d: 50, f: '2026-11-19', to: '2026-11-25', g: 'mlecni' }),
    d('Sir', { d: 25, up: 8, uu: 'kg', g: 'mlecni' }),
  ];
  assert.deepEqual(filterDeals(deals, { minDisc: 30 }, TODAY).map(x => x.n), ['Mleko C', 'Mleko B']);
  assert.deepEqual(filterDeals(deals, { minDisc: 30, upcoming: false }, TODAY).map(x => x.n), ['Mleko B']);
  assert.deepEqual(filterDeals(deals, { noCard: true, upcoming: false }, TODAY).map(x => x.n), ['Sir', 'Mleko A']);
  // Prevladujoča enota (l) najprej, nato kg, nato brez cene na enoto.
  assert.deepEqual(filterDeals(deals, { sort: 'unit' }, TODAY).map(x => x.n), ['Mleko B', 'Mleko A', 'Sir', 'Mleko C']);
});

test('groupCounts, byGroup, unitLabel, isFoodDeal', () => {
  const deals = [d('a', { g: 'meso', d: 10 }), d('b', { g: 'meso', d: 40 }), d('c', { g: 'sadje' }), d('x', { g: undefined, food: false })];
  assert.deepEqual(groupCounts(deals).map(g => [g.id, g.count]), [['sadje', 1], ['meso', 2], ['drugo', 1]]);
  const meso = byGroup(deals, 'discount', 1).find(g => g.id === 'meso');
  assert.deepEqual(meso.top.map(x => x.n), ['b']);
  assert.equal(unitLabel({ up: 6.98, uu: 'kg' }), '6,98 €/kg');
  assert.equal(unitLabel({}), '');
  assert.equal(isFoodDeal({ g: 'alkohol' }), true);
  assert.equal(isFoodDeal({ g: 'drogerija' }), false);
  assert.equal(isFoodDeal({ food: null }), false);
  assert.equal(isFoodDeal({ food: true }), true);
});

test('mergeLeaflet: izdelek iz letaka, ki je tudi na spletu, ne podvoji in prinese popust', () => {
  const web = [d('FINEST BAKERY Karamelni vaflji', { s: 'hofer', p: 1.95, u: 'https://hofer/x', f: '2026-11-02' }), d('Mleko', { p: 0.9 })];
  const leaflet = [
    d('FINEST BAKERY KARAMELNI VAFLJI', { s: 'hofer', p: 1.95, o: 2.49, d: 22, f: '2026-11-12', to: '2026-11-18' }),
    d('SAMO V LETAKU', { s: 'hofer', p: 3 }),
  ];
  const out = mergeLeaflet(web, leaflet);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { ...web[0], o: 2.49, d: 22, f: '2026-11-02', to: '2026-11-18' });
  assert.equal(out[2].n, 'SAMO V LETAKU');
  assert.deepEqual(mergeLeaflet(web, []), web);
});

test('zgodovina: lažna akcija, najceneje doslej, cikel', () => {
  assert.equal(notReal({ p: 1.69, l30: 1.69 }), true);
  assert.equal(notReal({ p: 1.69, l30: 1.99 }), false);
  assert.equal(notReal({ p: 1.69 }), false);
  assert.deepEqual(historyNotes({ p: 1.69, l30: 1.59 }), ['v 30 dneh je bilo že ceneje (1,59 €)']);
  assert.deepEqual(historyNotes({ p: 4.99, lo: 4.49, lod: '2026-12-01', cy: 28 }), ['najceneje doslej 4,49 € (1. 12.)', 'v akciji ~vsakih 28 dni']);
  assert.deepEqual(historyNotes({ p: 1 }), []);
  const deals = [d('A', { l30: 1 }), d('B', { l30: 2 })];
  assert.deepEqual(filterDeals(deals, { realOnly: true }, TODAY).map(x => x.n), ['B']);
});
