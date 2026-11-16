// Testi skupin živil, velikosti pakiranja in cene na enoto (js/products.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, packSize, unitPrice, enrichDeal, isFoodGroup } from '../js/products.js';

test('classify: kategorija trgovine', () => {
  assert.equal(classify('Mleko Alpsko 3,5 %', 'Mlecni izdelki'), 'mlecni');
  assert.equal(classify('Sok, multivitamin, Fructal, 1 l', 'Pijače'), 'pijace');
  assert.equal(classify('Gin, Beefeater, 40 % alkohola, 0,7 l', 'Pijače'), 'alkohol');
  assert.equal(classify('Brezalkoholno pivo Bevog, 0,33 l', 'Pijače'), 'pijace');
  assert.equal(classify('Šampon Garnier, 400 ml', 'Kozmetika', false), 'drogerija');
  assert.equal(classify('Belo vino Chardonnay', 'Belo vino', false), 'alkohol'); // Lidl vino ni »nehrana«
  assert.equal(classify('LIVARNO Komoda', 'Dnevna soba', false), 'drugo');
});

test('classify: samo ime (Hofer, Eurospin, račun)', () => {
  assert.equal(classify('OKUS PODEŽELJA Piščančje prsi'), 'meso');
  assert.equal(classify('LAND BAVARSKI EMENTALEC'), 'mlecni');
  assert.equal(classify('BARILLA Špageti'), 'shramba');
  assert.equal(classify('CUCINA Široki jajčni rezanci'), 'shramba');
  assert.equal(classify('RIQUET Temna čokolada'), 'sladko');
  assert.equal(classify('DOLCIANDO SLADOLEDNE LUČKE Z MANDLJI'), 'zamrznjeno');
  assert.equal(classify('FILEJI SLEDA V RASTLINSKEM OLJU'), 'meso');
  assert.equal(classify('HOME CREATION LED-lučka'), 'drugo');
  assert.equal(classify('MALVAZIJA'), 'alkohol');
  assert.equal(classify('Vinski kis 1 l'), 'shramba');
  assert.equal(classify('MLEKO 1L'), 'mlecni');
  assert.equal(classify('BANANE'), 'sadje');
  assert.equal(classify('Toaletni papir 10/1'), 'drogerija');
  assert.equal(classify('Kava v kapsulah Lavazza, 10 kapsul'), 'zajtrk');
  assert.equal(classify('Energijski napitek, mango, 0,25 l', 'Pijače'), 'pijace');
  assert.equal(classify('Šumeče tablete vitamin C', 'Diabetična prehrana'), 'drogerija');
  assert.equal(classify('Nekaj čisto neznanega'), null);
  assert.equal(classify('Nekaj neznanega', '', false), 'drugo');
});

test('isFoodGroup', () => {
  assert.equal(isFoodGroup('meso'), true);
  assert.equal(isFoodGroup('drogerija'), false);
  assert.equal(isFoodGroup(undefined), false);
});

test('packSize: različni zapisi', () => {
  assert.deepEqual(packSize('2 x 500 g'), { qty: 1, unit: 'kg' });
  assert.deepEqual(packSize('500 g x 2'), { qty: 1, unit: 'kg' });
  assert.deepEqual(packSize('Coca Cola, 1,5 l'), { qty: 1.5, unit: 'l' });
  assert.deepEqual(packSize('MLEKO 1L'), { qty: 1, unit: 'l' });
  assert.deepEqual(packSize('Jogurt 150 g'), { qty: 0.15, unit: 'kg' });
  assert.deepEqual(packSize('Vino 75 cl'), { qty: 0.75, unit: 'l' });
  assert.equal(packSize('Banane'), null);
});

test('unitPrice: zapis trgovine ali velikost v imenu', () => {
  assert.deepEqual(unitPrice({ p: 1, b: '1 kg = 6,98' }), { up: 6.98, uu: 'kg' });
  assert.deepEqual(unitPrice({ p: 1, b: '1 kg = 6.98' }), { up: 6.98, uu: 'kg' });
  assert.deepEqual(unitPrice({ p: 2, b: '4,88 €/1 kg' }), { up: 4.88, uu: 'kg' });
  assert.deepEqual(unitPrice({ p: 1.69, n: 'Coca Cola, 1,5 l' }), { up: 1.13, uu: 'l' });
  assert.deepEqual(unitPrice({ p: 2.49, q: '400 g', n: 'Sir' }), { up: 6.23, uu: 'kg' });
  assert.equal(unitPrice({ p: 1, n: 'Avokado, cena za kos' }), null);
});

test('enrichDeal: skupina, hrana in cena na enoto', () => {
  const d = enrichDeal({ s: 'lidl', n: 'Belo vino', c: 'Belo vino', food: false, p: 3, q: '0,75 l' });
  assert.equal(d.g, 'alkohol');
  assert.equal(d.food, true);
  assert.deepEqual([d.up, d.uu], [4, 'l']);
  const x = enrichDeal({ s: 'hofer', n: 'Nekaj', p: 1, food: null });
  assert.equal(x.g, null);
  assert.equal(x.food, null);
});
