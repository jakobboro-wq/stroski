// Testi zaloge, napovedi, prihrankov in priporočil (js/pantry.js) na sintetični zgodovini računov.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchases, pantry, savings, spendByGroup, recommendations, cheaperElsewhere, matchingDeals, matchStrength } from '../js/pantry.js';
import { parseReceipt, receiptTransactions, suggestItemCategory, qtyOf } from '../js/receipt.js';

const rc = (date, store, items) => ({ source: 'receipt', date, description: store, amount: -1, items });
const TODAY = '2026-11-16';

// Mleko vsak teden (1 l), kava vsakih 20 dni, enkratni nakup čistila.
const HISTORY = [
  rc('2026-10-12', 'Mercator', [{ name: 'MLEKO ALPSKO 1L', amount: 1.19 }, { name: 'KAVA BARCAFFE 400G', amount: 6.49 }]),
  rc('2026-10-19', 'Lidl', [{ name: 'MLEKO ALPSKO 1L', amount: 1.19 }]),
  rc('2026-10-26', 'Mercator', [{ name: 'MLEKO ALPSKO 1L', amount: 1.09, disc: 0.10 }]),
  rc('2026-11-01', 'Tuš', [{ name: 'KAVA BARCAFFE 400G', amount: 6.49 }]),
  rc('2026-11-02', 'Mercator', [{ name: 'MLEKO ALPSKO 1L', amount: 2.38, qty: 2 }, { name: 'CISTILO ZA KOPALNICO', amount: 3.5 }]),
  rc('2026-11-16', 'Mercator', [{ name: 'MLEKO ALPSKO 1L', amount: 0.99, disc: 0.2 }]),
];

test('purchases: postavke z računov s ceno na kos in skupino', () => {
  const p = purchases(HISTORY);
  assert.equal(p.length, 8);
  const two = p.find(x => x.qty === 2);
  assert.equal(two.unit, 1.19);
  assert.equal(p[0].g, 'mlecni');
  assert.equal(p.find(x => x.name.startsWith('CISTILO')).g, 'drogerija');
  assert.deepEqual(purchases([{ source: 'manual', items: [{ name: 'x', amount: 1 }] }]), []);
});

test('pantry: dni na pakiranje (mediana), konec zaloge, stanje', () => {
  const list = pantry(HISTORY.slice(0, 5), '2026-11-14');
  const milk = list.find(x => x.key === 'mleko alpsko');
  // razmiki 7, 7, 7 dni po 1 kos → 7 dni na liter; zadnji nakup 2 kosa → 14 dni
  assert.equal(milk.daysPerPack, 7);
  assert.equal(milk.runout, '2026-11-16');
  assert.equal(milk.left, 2);
  assert.equal(milk.status, 'soon');
  assert.equal(milk.confidence, 'high');
  assert.equal(milk.usual, 1.19);
  const coffee = list.find(x => x.key.startsWith('kava'));
  assert.equal(coffee.daysPerPack, 20);
  assert.equal(coffee.runout, '2026-11-21');
  assert.equal(coffee.confidence, 'low');
  const clean = list.find(x => x.g === 'drogerija');
  assert.equal(clean.status, 'unknown');
  assert.equal(list[0].key, 'mleko alpsko'); // najprej tisto, kar zmanjkuje
});

test('pantry: ročni oznaki »porabil« in »še imam«', () => {
  const base = HISTORY.slice(0, 5);
  const empty = pantry(base, '2026-11-10', { 'mleko alpsko': { empty: '2026-11-09' } }).find(x => x.key === 'mleko alpsko');
  assert.equal(empty.runout, '2026-11-09');
  assert.equal(empty.status, 'out');
  const have = pantry(base, '2026-11-17', { 'mleko alpsko': { have: '2026-11-17' } }).find(x => x.key === 'mleko alpsko');
  assert.ok(have.runout > '2026-11-17');
  assert.equal(have.status, 'soon');
});

test('savings: popust na računu in cena glede na običajno', () => {
  const s = savings(HISTORY, '2026-11-01', '2026-11-30');
  // popust 0,20 (16. 11.); običajno 1,19 (mediana 1,19 1,19 1,09 1,19) → 0,99 je 0,20 manj
  assert.equal(s.receipt, 0.2);
  assert.equal(s.vsUsual, 0.2);
  assert.equal(s.overUsual, 0);
  assert.equal(s.total, 0.4);
  assert.equal(s.best[0].name, 'MLEKO ALPSKO 1L');
});

test('spendByGroup', () => {
  const g = spendByGroup(HISTORY, '2026-11-01', '2026-11-30');
  assert.deepEqual(g.map(x => [x.id, x.amount]), [['zajtrk', 6.49], ['drogerija', 3.5], ['mlecni', 3.37]]);
});

const deal = over => ({ s: 'lidl', n: 'Alpsko mleko 3,5 %, 1 l', p: 0.89, d: 25, g: 'mlecni', up: 0.89, uu: 'l', to: '2026-11-20', ...over });

test('matchingDeals: ključna beseda in skupina', () => {
  const item = { name: 'MLEKO ALPSKO 1L', g: 'mlecni' };
  assert.equal(matchingDeals(item, [deal()], TODAY).length, 1);
  assert.equal(matchingDeals(item, [deal({ g: 'sladko', n: 'Mlečna čokolada' })], TODAY).length, 0);
  assert.equal(matchingDeals(item, [deal({ f: '2026-11-19' })], TODAY).length, 0);
  assert.equal(matchingDeals(item, [deal({ f: '2026-11-19' })], TODAY, { upcoming: true }).length, 1);
});

test('recommendations: zdaj, počakaj, na zalogo, kupi', () => {
  const items = pantry(HISTORY.slice(0, 5), '2026-11-14');
  const now = recommendations(items, [deal()], '2026-11-14');
  assert.equal(now[0].type, 'now');
  assert.equal(now[0].item.key, 'mleko alpsko');

  // Akcija za kavo se začne 18. 11., kava pa zdrži do 21. 11. → počakaj
  const coffeeDeal = { s: 'eurospin', n: 'Kava Barcaffe classic 400 g', p: 4.99, d: 23, g: 'zajtrk', f: '2026-11-18', to: '2026-11-24' };
  const wait = recommendations(items, [coffeeDeal], '2026-11-16');
  assert.deepEqual(wait.map(r => r.type), ['buy', 'wait']);
  assert.equal(wait[1].deal.s, 'eurospin');

  // Kava ima še 25 dni, a je −30 % zdaj → na zalogo (shramba/zajtrk zdrži)
  const stock = recommendations(pantry(HISTORY.slice(0, 4), '2026-11-02'), [{ ...coffeeDeal, f: null, d: 30 }], '2026-11-02');
  assert.ok(stock.some(r => r.type === 'stock' && r.item.key.startsWith('kava')));
});

test('cheaperElsewhere: cena na liter primerjana z akcijo drugje', () => {
  const list = cheaperElsewhere(HISTORY.slice(0, 5), [deal({ up: 0.79, p: 0.79 })], TODAY);
  assert.equal(list.length, 1);
  assert.equal(list[0].diff, 0.4); // 1,19 €/l proti 0,79 €/l
});

test('račun: količina, teža, popust, skupina in predlog kategorije', () => {
  assert.deepEqual(qtyOf('2,000 KOS x 1,09   2,18 C'), { qty: 2 });
  assert.deepEqual(qtyOf('0,532 kg x 1,49  0,79'), { kg: 0.532 });
  assert.deepEqual(qtyOf('1,000 KOS x 1,99 1,99'), {});
  const text = 'MERCATOR d.d.\nMLEKO ALPSKO 1L\n2,000 KOS x 1,09   2,18 C\nBANANE\n0,532 kg x 1,49   0,79 C\nPOPUST -0,20\nTOALETNI PAPIR 10/1  3,99 A\nSKUPAJ 6,76';
  const r = parseReceipt(text, { today: TODAY });
  assert.equal(r.matches, true);
  assert.deepEqual(r.items.map(i => [i.name, i.amount, i.qty ?? null, i.kg ?? null, i.disc ?? null, i.g]), [
    ['MLEKO ALPSKO', 2.18, 2, null, null, 'mlecni'],
    ['BANANE', 0.59, null, 0.532, 0.2, 'sadje'],
    ['TOALETNI PAPIR 10/1', 3.99, null, null, null, 'drogerija'],
  ]);
  assert.equal(suggestItemCategory(r.items[2]), 'household');
  assert.equal(suggestItemCategory({ name: 'Šampon', g: 'drogerija' }), 'care');
  assert.equal(suggestItemCategory({ name: 'Šampon', g: 'drogerija' }, () => false), null);
  assert.equal(suggestItemCategory(r.items[0]), null);
  const tx = receiptTransactions({ store: 'Mercator', date: TODAY, total: 6.76, account: 'Revolut', currency: 'EUR', storeCategoryId: 'groceries', items: r.items }, 'r1');
  const items = tx.flatMap(t => t.items);
  assert.deepEqual(items.find(i => i.name === 'BANANE'), { name: 'BANANE', amount: 0.59, g: 'sadje', kg: 0.532, disc: 0.2 });
});

test('matchStrength: isti izdelek (znamka) ali podoben', () => {
  const kava = { name: 'KAVA BARCAFFE 400G' };
  assert.equal(matchStrength(kava, { n: 'Kava Barcaffe classic, 400 g' }), 2);
  assert.equal(matchStrength(kava, { n: 'Mleta kava, Zlatna Džezva, 200 g' }), 1);
  assert.equal(matchStrength(kava, { n: 'Čaj Franck' }), 0);
  assert.equal(matchStrength({ name: 'BANANE' }, { n: 'Banane Chiquita' }), 2);
});

test('recommendations: na zalogo samo isti izdelek', () => {
  const items = pantry(HISTORY.slice(0, 4), '2026-11-02');
  const other = { s: 'mercator', n: 'Mleta kava, Zlatna Džezva, 400 g', p: 3.99, d: 40, g: 'zajtrk' };
  assert.ok(!recommendations(items, [other], '2026-11-02').some(r => r.type === 'stock'));
});
