// Testi iskanja, filtrov in ujemanja »Zate« (js/deals.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordOf, nameHas, isCurrent, dealsForYou, filterDeals, validity, mergeLeaflet } from '../js/deals.js';

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
    d('Banana', { p: 1.2, d: 20 }),
    d('Detergent', { p: 6, d: 40, food: false }),
    d('Avokado', { p: 0.8, s: 'lidl' }),
    d('Hofer sir', { p: 2, s: 'hofer', food: null }),
  ];
  assert.deepEqual(filterDeals(deals, {}, TODAY).map(x => x.n), ['Detergent', 'Banana', 'Avokado', 'Hofer sir']);
  assert.deepEqual(filterDeals(deals, { food: true, sort: 'price' }, TODAY).map(x => x.n), ['Avokado', 'Banana', 'Hofer sir']);
  assert.deepEqual(filterDeals(deals, { store: 'lidl' }, TODAY).map(x => x.n), ['Avokado']);
  assert.deepEqual(filterDeals(deals, { query: 'ban', sort: 'name' }, TODAY).map(x => x.n), ['Banana']);
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
