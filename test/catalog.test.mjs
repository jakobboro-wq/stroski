// Testi knjižnice izdelkov (js/catalog.js). Izmišljene akcije in računi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameMatches, newProduct, offerKey, productOffers, productSummary, referenceSize, perRef, searchCatalog, parseList, indexRows, variantOf, variantKey, sizeFits, searchGroups, pieceSize, withPieceSize, verdict, isSeasonal } from '../js/catalog.js';
import { buildIndex } from '../scraper/history.mjs';

const storeOf = n => (/lidl/i.test(n) ? 'lidl' : /tus/i.test(n) ? 'tus' : null);
const today = '2026-11-17';
const bueno = { id: 'p1', name: 'Kinder Bueno', size: '43 g', terms: ['kinder bueno', 'kind bueno'], not: ['bel', 'white'], links: {} };

test('nameMatches: vsa imena, začetki besed, izključene besede', () => {
  assert.ok(nameMatches(bueno, 'Vafelj Kinder Bueno, 3 x 43 g'));
  assert.ok(nameMatches(bueno, 'KIND.BUENO 43G'));
  assert.ok(!nameMatches(bueno, 'Vafelj Kinder Bueno, bel, 117 g'));
  assert.ok(!nameMatches(bueno, 'KINDER BUENO WHITE'));
  assert.ok(!nameMatches(bueno, 'Kinder Country'));
});

test('newProduct: ime in velikost iz iskanja', () => {
  const p = newProduct('kinder bueno 43 g', 'x');
  assert.deepEqual([p.name, p.size, p.terms], ['Kinder bueno', '43 g', ['kinder bueno']]);
  assert.equal(newProduct('milka lešnik', 'y').size, '');
});

test('productOffers + productSummary: primerjava na 43 g, zgodovina, računi, zavrnitve', () => {
  const deals = [
    { s: 'tus', n: 'Vafelj Kinder Bueno, 3 x 43 g', p: 2.89, up: 22.4, uu: 'kg', o: 3.49, to: '2026-11-23' },
    { s: 'lidl', n: 'Kinder Bueno 43 g', p: 0.99, to: '2026-11-20' },
    { s: 'mercator', n: 'Kinder Bueno 43 g', p: 0.69, f: '2026-11-20' }, // šele prihodnji teden
    { s: 'lidl', n: 'Kinder Bueno white 39 g', p: 0.5 },
    { s: 'lidl', n: 'Staro', p: 0.1, to: '2026-11-01' },
  ];
  const index = indexRows({ cols: ['s', 'n', 'k', 'uu', 'lo', 'lod', 'typ', 'reg', 'last', 'end', 'lp', 'ep', 'cy', 'next'], rows: [
    ['tus', 'Vafelj Kinder Bueno, 3 x 43 g', 0.129, 'kg', 2.49, '2026-09-01', 2.69, 3.49, '2026-11-16', '2026-11-17', 2.89, 3, 30, null],
    ['hofer', 'Kinder Bueno 2 x 43 g', 0.086, 'kg', 1.49, '2026-10-01', 1.49, 1.99, '2026-10-01', '2026-10-07', 1.49, 2, 40, '2026-11-25'],
  ] });
  const purchases = [
    { name: 'KIND.BUENO 43G', store: 'TUS d.o.o.', date: '2026-10-10', unit: 1.29, qty: 1 },
    { name: 'KIND.BUENO 43G', store: 'TUS d.o.o.', date: '2026-11-10', unit: 1.19, qty: 1 },
  ];
  const offers = productOffers(bueno, { deals, index, purchases, storeOf }, today);
  assert.deepEqual(offers.map(o => `${o.source}:${o.s}`).sort(), ['deal:lidl', 'deal:mercator', 'deal:tus', 'hist:hofer', 'mine:tus']);
  const s = productSummary(bueno, offers, today);
  assert.deepEqual(s.ref, { qty: 0.043, unit: 'kg' });
  // Tuš 2,89 € za 3 × 43 g = 0,96 € za en Bueno, Lidl 0,99 €; Mercator se šele začne.
  assert.equal(s.now.s, 'tus');
  assert.equal(s.now.eq, 0.96);
  // Najceneje doslej: Hofer 1,49 € za 2 × 43 g = 0,75 €
  assert.equal(s.ever.row.s, 'hofer');
  assert.equal(s.ever.eq, 0.75);
  assert.equal(s.next.next, '2026-11-25');
  const mine = s.rows.find(r => r.source === 'mine');
  assert.equal(mine.price, 1.19);
  assert.equal(mine.lo, 1.19);
  assert.deepEqual(s.stores.map(r => r.s), ['tus', 'lidl']);

  // Zavrnjen Tuš: najceneje zdaj je Lidl, zavrnjen se vrne samo na zahtevo.
  const rejected = { ...bueno, links: { [offerKey('tus', 'Vafelj Kinder Bueno, 3 x 43 g')]: false } };
  const s2 = productSummary(rejected, productOffers(rejected, { deals, index, purchases, storeOf }, today), today);
  assert.equal(s2.now.s, 'lidl');
  assert.ok(productOffers(rejected, { deals, index, purchases, storeOf }, today, { withRejected: true }).some(o => o.s === 'tus' && o.status === 'no'));
});

test('referenceSize in perRef', () => {
  const offers = [{ qty: 0.1, uu: 'kg' }, { qty: 0.1, uu: 'kg' }, { qty: 0.3, uu: 'kg' }];
  assert.deepEqual(referenceSize({ size: '' }, offers), { qty: 1, unit: 'kg' });
  assert.deepEqual(referenceSize({ size: '0,5 l' }, offers), { qty: 0.5, unit: 'l' });
  assert.equal(perRef(3, { qty: 0.3, uu: 'kg' }, { qty: 0.1, unit: 'kg' }), 1);
  assert.equal(perRef(3, { qty: 0.3, uu: 'l' }, { qty: 0.1, unit: 'kg' }), null);
  assert.equal(perRef(2, { qty: null }, { qty: 0.1, unit: 'kg' }), 2);
});

test('searchCatalog in parseList', () => {
  const list = [bueno, { id: 'p2', name: 'Milka lešnik', terms: ['milka lesnik', 'milka hazelnut'] }];
  assert.deepEqual(searchCatalog(list, 'bue').map(p => p.id), ['p1']);
  assert.deepEqual(searchCatalog(list, 'hazel').map(p => p.id), ['p2']);
  assert.deepEqual(parseList('Bel, white ,, bel'), ['bel', 'white']);
});

test('buildIndex: vsi izdelki, tudi z enim obdobjem, z zadnjo ceno in velikostjo', () => {
  const dayMap = { '2026-11-16': { a: [2.89, 3.49, 17, 0] }, '2026-11-17': { a: [2.79, 3.49, 20, 0] } };
  const j = buildIndex(dayMap, { a: { s: 'tus', n: 'Bueno 3 x 43 g', k: 0.129, uu: 'kg' } }, '2026-11-17');
  const [r] = indexRows(j);
  assert.equal(r.n, 'Bueno 3 x 43 g');
  assert.equal(r.k, 0.129);
  assert.equal(r.lo, 2.79);
  assert.equal(r.lp, 2.79);
  assert.equal(r.ep, 1);
  assert.equal(r.end, '2026-11-17');
});

test('variantOf: trgovine različno poimenujejo isti izdelek', () => {
  const t = ['kinder bueno'];
  assert.deepEqual(variantOf(t, 'Vafelj Kinder Bueno, 3 x 43 g'), []);
  assert.deepEqual(variantOf(t, 'Čokolada Kinder Bueno, Kinder, 3/1'), []);
  assert.deepEqual(variantOf(t, 'KIND.BUENO 43G'), []);
  assert.deepEqual(variantOf(t, 'Vafelj Kinder Bueno, bel, 117 g'), ['bel']);
  assert.deepEqual(variantOf(t, 'Čokolada Kinder Bueno White, Kinder, 3 x 39 g'), ['bel']);
  assert.deepEqual(variantOf(['red bull'], 'Energijski napitek, brez sladkorja, Red Bull, 355 ml'), ['zero']);
  assert.deepEqual(variantOf(['red bull'], 'Red Bull Energijska pijača (zero)'), ['zero']);
  assert.equal(variantKey(['White']), 'bel');
});

test('sizeFits: cela števila kosov', () => {
  const s = { qty: 0.043, unit: 'kg' };
  assert.ok(sizeFits(s, 0.043, 'kg'));
  assert.ok(sizeFits(s, 0.129, 'kg'));
  assert.ok(!sizeFits(s, 0.117, 'kg'));
  assert.ok(!sizeFits(s, 0.043, 'l'));
  assert.ok(sizeFits(s, null, null));
  assert.ok(sizeFits(null, 0.5, 'kg'));
});

test('samodejno: shranjen izdelek vzame samo isto različico in velikost; ročna odločitev ima prednost', () => {
  const deals = [
    { s: 'tus', n: 'Vafelj Kinder Bueno, 3 x 43 g', p: 2.89, up: 22.4, uu: 'kg' },
    { s: 'mercator', n: 'Čokolada Kinder Bueno, Kinder, 3/1', p: 2.79, up: 21.63, uu: 'kg' },
    { s: 'tus', n: 'Vafelj Kinder Bueno, bel, 117 g', p: 2.89 },
    { s: 'tus', n: 'Koledar adventni Kinder Bueno, Xmas, 181 g', p: 7.64 },
  ];
  const p = { ...newProduct('kinder bueno 43 g', 'x') };
  const got = productOffers(p, { deals }, today);
  assert.deepEqual(got.map(o => o.s).sort(), ['mercator', 'tus']);
  assert.ok(got.every(o => o.status === 'auto'));
  const all = productOffers(p, { deals }, today, { withRejected: true });
  assert.equal(all.filter(o => o.status === 'off').length, 2);
  const forced = { ...p, links: { [offerKey('tus', 'Vafelj Kinder Bueno, bel, 117 g')]: true, [offerKey('mercator', 'Čokolada Kinder Bueno, Kinder, 3/1')]: false } };
  assert.deepEqual(productOffers(forced, { deals }, today).map(o => `${o.s}:${o.status}`).sort(), ['tus:auto', 'tus:yes']);
  const white = { ...p, size: '', variant: ['white'] };
  assert.deepEqual(productOffers(white, { deals }, today).map(o => o.n), ['Vafelj Kinder Bueno, bel, 117 g']);
});

test('searchGroups: iskanje razvrsti ponudbe v izdelke', () => {
  const deals = [
    { s: 'tus', n: 'Vafelj Kinder Bueno, 3 x 43 g', p: 2.89, up: 22.4, uu: 'kg', to: '2026-11-23' },
    { s: 'mercator', n: 'Čokolada Kinder Bueno, Kinder, 3/1', p: 2.79, up: 21.63, uu: 'kg', to: '2026-11-22' },
    { s: 'tus', n: 'Vafelj Kinder Bueno, bel, 117 g', p: 2.89, up: 24.7, uu: 'kg' },
    { s: 'mercator', n: 'Čokolada Kinder Bueno White, Kinder, 3 x 39 g', p: 2.79, up: 23.85, uu: 'kg' },
  ];
  const g = searchGroups('kinder bueno', { deals }, today);
  assert.deepEqual(g.map(x => [x.title, x.count]), [['Kinder bueno', 2], ['Kinder bueno bel', 2]]);
  assert.equal(g[0].summary.now.s, 'mercator');
  assert.equal(g[0].product.size, '43 g'); // iz »3 x 43 g«, cene na kos
  assert.equal(g[0].summary.now.eq, 0.93);
  assert.equal(g[1].product.size, '39 g');
  assert.deepEqual(g[1].product.variant, ['bel']);
});

test('pieceSize', () => {
  assert.equal(pieceSize(['Vafelj, 3 x 43 g', 'Bueno 2x43g', 'Bueno 43 g']), '43 g');
  assert.equal(pieceSize(['Bueno 117 g']), null);
});

test('white = bel tudi v iskanju, cena na kos', () => {
  const deals = [
    { s: 'tus', n: 'Vafelj Kinder Bueno, bel, 117 g', p: 2.89, up: 24.7, uu: 'kg' },
    { s: 'mercator', n: 'Čokolada Bueno White, Kinder, 39 g', p: 1.19, up: 30.51, uu: 'kg' },
  ];
  for (const q of ['kinder bueno white', 'kinder bueno bel']) {
    const [g] = searchGroups(q, { deals }, today);
    assert.equal(g.count, 2);
    assert.equal(g.product.size, '39 g');
    assert.deepEqual([g.summary.now.s, g.summary.now.eq], ['tus', 0.96]);
  }
});

test('verdict: kupi, počakaj, predrago, ni akcije', () => {
  const now = eq => ({ eq }), s = (o = {}) => ({ now: null, soon: null, ever: { eq: 0.93 }, rows: [1], ...o });
  assert.equal(verdict({}, s({ now: now(0.96) })), 'buy');
  assert.equal(verdict({}, s({ now: now(1.19) })), 'high');
  assert.equal(verdict({}, s({ now: now(0.96), soon: now(0.75) })), 'wait');
  assert.equal(verdict({ target: 1.2 }, s({ now: now(1.19) })), 'buy');
  assert.equal(verdict({ target: 0.9 }, s({ now: now(0.96), soon: now(0.95) })), 'high');
  assert.equal(verdict({}, s()), 'none');
  assert.equal(verdict({}, s({ rows: [], ever: null })), 'empty');
});

test('withPieceSize, isSeasonal', () => {
  assert.equal(withPieceSize({ size: '' }, [{ n: 'Pingui 30 g', qty: 0.03, uu: 'kg' }]).size, '30 g');
  assert.equal(withPieceSize({ size: '' }, [{ n: 'A', qty: 0.1, uu: 'kg' }, { n: 'B', qty: 0.25, uu: 'kg' }]).size, '');
  assert.ok(isSeasonal('adve kole') && !isSeasonal('bel'));
});
