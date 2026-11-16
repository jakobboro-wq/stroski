// Testi parserjev scraperja na majhnih, ročno sestavljenih odlomkih strani (oblika kot na pravih straneh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTus, parseLidl, lidlCampaigns, parseHofer, parseMercator, parseEurospin, combine, compact } from '../scraper/deals.mjs';

const tusItem = ({ name, price, old, cat = 'mlecni-izdelki', url = 'https://www.tus.si/izdelki/x/' }) => `
<li class="col js-match-height product type-product product_cat-${cat}">
  <a data-gtm4wp_product_name="${name}" data-gtm4wp_product_price="${price}" data-gtm4wp_product_url="${url}">
    <img data-src="https://www.tus.si/slika.jpg">
  </a>
  ${old ? `<span>Redna cena: ${old} €</span>` : ''}
</li>`;

test('Tuš: ime, cena, redna cena, popust, kategorija', () => {
  const html = `<ul>${tusItem({ name: 'Mleko &quot;Alpsko&quot; 3,5 %', price: '0.99', old: '1,29' })}</ul>`;
  const [d] = parseTus(html, 'Akcija');
  assert.equal(d.s, 'tus');
  assert.equal(d.n, 'Mleko "Alpsko" 3,5 %');
  assert.equal(d.p, 0.99);
  assert.equal(d.o, 1.29);
  assert.equal(d.d, 23);
  assert.equal(d.c, 'Mlecni izdelki');
  assert.equal(d.food, true);
  assert.equal(d.t, 'Akcija');
  assert.equal(d.i, 'https://www.tus.si/slika.jpg');
});

test('Tuš: nehrana, brez redne cene, izdelek brez cene se izpusti', () => {
  const html = tusItem({ name: 'Detergent', price: '5,49', cat: 'pranje-perila', url: 'a' })
    + tusItem({ name: 'Brez cene', price: '', url: 'b' });
  const list = parseTus(html, 'Akcija');
  assert.equal(list.length, 1);
  assert.equal(list[0].food, false);
  assert.equal(list[0].o, null);
  assert.equal(list[0].d, null);
});

test('Tuš: redna cena, nižja od akcijske, se ne upošteva', () => {
  const [d] = parseTus(tusItem({ name: 'X', price: '2,00', old: '1,50' }), 'Akcija');
  assert.equal(d.o, null);
});

test('Tuš: spremenjena stran da prazen seznam', () => {
  assert.deepEqual(parseTus('<html><body>Nova stran</body></html>', 'Akcija'), []);
});

const esc = o => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const NOW = Date.UTC(2026, 10, 14, 12) / 1000;
const lidlItem = over => ({
  productId: 1, fullTitle: 'Kava mleta', canonicalUrl: '/p/kava/p1', image: 'https://img/1.jpg',
  price: { price: 3.49, oldPrice: 4.99, packaging: { text: '500 g' }, basePrice: { text: '1 kg = 6,98' } },
  keyfacts: { wonCategoryPrimary: 'Hrana in pijača/Kava' },
  storeStartDate: NOW - 86400, storeEndDate: NOW + 3 * 86400,
  ...over,
});

test('Lidl: podatki iz data-grid-data', () => {
  const html = `<title>Akcija tedna | Lidl</title><div data-grid-data="${esc(lidlItem())}"></div>`;
  const [d] = parseLidl(html, NOW);
  assert.equal(d.n, 'Kava mleta');
  assert.equal(d.p, 3.49);
  assert.equal(d.o, 4.99);
  assert.equal(d.d, 30);
  assert.equal(d.q, '500 g');
  assert.equal(d.u, 'https://www.lidl.si/p/kava/p1');
  assert.equal(d.c, 'Kava');
  assert.equal(d.food, true);
  assert.equal(d.t, 'Akcija tedna');
  assert.equal(d.f, '2026-11-13');
  assert.equal(d.to, '2026-11-17');
  assert.equal(d.plus, false);
});

test('Lidl: poteklo, brez cene in pokvarjen JSON se izpustijo; Lidl Plus se prepozna', () => {
  const html = [
    lidlItem({ productId: 2, storeEndDate: NOW - 60 }),
    lidlItem({ productId: 3, price: {} }),
    lidlItem({ productId: 4, lidlPlus: [{}] }),
  ].map(o => `<div data-grid-data="${esc(o)}"></div>`).join('') + '<div data-grid-data="{pokvarjeno"></div>';
  const list = parseLidl(html, NOW);
  assert.deepEqual(list.map(d => d.id), [4]);
  assert.equal(list[0].plus, true);
});

test('Lidl: povezave na akcije z naslovne strani, brez dvojnikov', () => {
  const html = '<a href="/c/akcija-tedna/a10071234">x</a><a href="/c/akcija-tedna/a10071234">x</a>'
    + '<a href="/c/lidl-plus/sub/a99">y</a><a href="/p/izdelek/p1">z</a>';
  assert.deepEqual(lidlCampaigns(html), ['/c/akcija-tedna/a10071234', '/c/lidl-plus/sub/a99']);
});

// Hoferjeva ploščica, kot jo izriše Nuxt (s komentarji <!----> vmes).
const hoferTile = ({ id = '000000000000107088', brand = 'FINEST BAKERY', name = 'Karamelni vaflji', price = '1,95 €', label = 'na voljo od 2. 11. 2026', size = '400 g' } = {}) => `
<div id="product-tile-${id}" class="product-teaser-item product-grid__item"><div class="product-tile" data-test="product-tile" title="${name}">
<a href="/izdelek/x-${id}" class="base-link product-tile__link"><div class="product-tile__image-container"><div class="product-tile__picture"><div class="base-image-wrapper">
<img class="base-image" srcset="https://img/a 116w" src="https://img/a" alt="${name}"></div></div>
<div class="product-tile__badges">${label ? `<div class="base-label base-label--info" data-test="product-tile__on-sale-label"><!----> ${label}</div>` : ''}</div></div>
<div class="product-tile__brandname" data-test="product-tile__brandname"><p aria-label="${brand},">${brand}</p></div>
<div class="product-tile__name" data-test="product-tile__name"><p aria-label="${name},">${name}</p></div>
<div class="product-tile__selling-size-and-comparison">${size ? `<div data-test="product-tile__unit-of-measurement" class="product-tile__unit-of-measurement"><p>${size}</p></div>
<div data-test="product-tile__comparison-price" class="product-tile__comparison-price"><p>(4,88 €/1 kg)</p></div>` : ''}</div>
<div class="base-price base-price--product-tile" data-test="product-tile__price"><div class="base-price__discount-tag__wrapper"><!----></div><span class="base-price__regular"><span>${price}</span><!----></span></div></a>
</div></div>`;

test('Hofer: znamka in ime, cena, embalaža, cena na enoto, datum začetka', () => {
  const [d] = parseHofer(`<div class="product-grid">${hoferTile()}</div>`, 'Posebna ponudba');
  assert.equal(d.s, 'hofer');
  assert.equal(d.id, '000000000000107088');
  assert.equal(d.n, 'FINEST BAKERY Karamelni vaflji');
  assert.equal(d.p, 1.95);
  assert.equal(d.q, '400 g');
  assert.equal(d.b, '4,88 €/1 kg');
  assert.equal(d.u, 'https://www.hofer.si/izdelek/x-000000000000107088');
  assert.equal(d.i, 'https://img/a');
  assert.equal(d.f, '2026-11-02');
  assert.equal(d.to, null);
  assert.equal(d.t, 'Posebna ponudba');
});

test('Hofer: brez datuma in embalaže, cena s tisočicami, brez cene se izpusti', () => {
  const html = hoferTile({ id: '000000000000000001', label: 'TO NI AKCIJA', size: '', price: '1.299,00 €' })
    + hoferTile({ id: '000000000000000002', price: '' });
  const list = parseHofer(html, 'Trajno znižano');
  assert.equal(list.length, 1);
  assert.equal(list[0].p, 1299);
  assert.equal(list[0].f, null);
  assert.equal(list[0].q, null);
});

test('Hofer: prazna stran (za zadnjo stranjo) da prazen seznam', () => {
  assert.deepEqual(parseHofer('<div class="product-grid"></div>', 'x'), []);
});

// Mercator: odgovor getProducts (skrajšan na polja, ki jih beremo).
const merc = (data, extra = {}) => ({
  type: 'product', itemId: data.cinv ?? '1', url: '/izdelek/1/x', mainImageSrc: 'https://img/m.jpg', total: 1, ...extra,
  data: { cinv: '1', name: 'Izdelek', normal_price: '1.99', current_price: '1.69', price_per_unit: 0, price_per_unit_base: '', category1: 'PIJAČE', discounts: [], ...data },
});
const mDisc = (over = {}) => ({ group_type: 'discount', marker_code: '3', value: '-15', hover_text: 'Ugodno', valid_from: '20261114004514', valid_to: '20261125004514', ...over });

test('Mercator: navadna akcija z datumi, ceno na enoto in kategorijo', () => {
  const [d] = parseMercator({ products: [merc({ price_per_unit: 1.1266, price_per_unit_base: '1l', discounts: [mDisc()] })] });
  assert.equal(d.s, 'mercator');
  assert.equal(d.p, 1.69);
  assert.equal(d.o, 1.99);
  assert.equal(d.d, 15);
  assert.equal(d.t, 'Akcija');
  assert.equal(d.b, '1 l = 1,13');
  assert.equal(d.c, 'Pijače');
  assert.equal(d.food, true);
  assert.equal(d.f, '2026-11-14');
  assert.equal(d.to, '2026-11-24'); // konec ob 0.45 → zadnji dan je dan prej
  assert.equal(d.u, 'https://mercatoronline.si/izdelek/1/x');
  assert.equal(d.plus, false);
});

test('Mercator: Pika kartica, Znižano, nehrana', () => {
  const [pika, zn] = parseMercator({ products: [
    merc({ cinv: '1', discounts: [mDisc({ group_type: 'pika_discount', marker_code: '104', hover_text: 'Za imetnike Pika kartice 15% ceneje.' })] }),
    merc({ cinv: '2', category1: 'ČISTILA', discounts: [mDisc({ group_type: 'other', marker_code: '11', value: '-20', hover_text: 'Znižano' })] }),
  ] });
  assert.equal(pika.t, 'S Pika kartico');
  assert.equal(pika.plus, true);
  assert.equal(zn.t, 'Znižano');
  assert.equal(zn.d, 20);
  assert.equal(zn.food, false);
});

test('Mercator: ob nakupu 2 ali več je cena na kos s popustom', () => {
  const [d] = parseMercator({ products: [merc({ normal_price: '0', current_price: '0.69', price_per_unit: 4.6, price_per_unit_base: '1kg',
    discounts: [mDisc({ marker_code: '100', value: '', hover_text: 'Ob nakupu 2 izdelkov ali več je vsak 20% ceneje.' })] })] });
  assert.equal(d.p, 0.55);
  assert.equal(d.o, 0.69);
  assert.equal(d.d, 20);
  assert.equal(d.t, 'Ob nakupu 2 ali več');
  assert.equal(d.b, '1 kg = 3,68');
});

test('Mercator: »ob nakupu 0 ali več« ni pogojni popust', () => {
  const [d] = parseMercator({ products: [merc({ discounts: [mDisc({ marker_code: '100', value: '-15', hover_text: 'Ob nakupu 0 izdelkov ali več je vsak 15% ceneje.' })] })] });
  assert.equal(d.p, 1.69);
  assert.equal(d.o, 1.99);
});

test('Mercator: brez cene ali prazen odgovor', () => {
  assert.deepEqual(parseMercator({ products: [merc({ current_price: '0' })] }), []);
  assert.deepEqual(parseMercator({}), []);
});

const euroTile = ({ date = '12.11 - 18.11', name = 'BAVARSKI \n EMENTALEC', brand = 'LAND', old = '3,49&nbsp;', price = '2,49 €', info = '400 g&nbsp;-&nbsp;za kg 6,23 €' } = {}) => `
<a href="javascript:;" class="sn_promo_grid_item" itemscope itemtype="http://schema.org/Product"><div class="sn_promo_grid_item_ct">
<div class="date_current_promo">${date}</div><h2 itemprop="name" class="i_title">${name}</h2><div itemprop="brand" class="i_brand">${brand}</div>
<img itemprop="image" data-double-img="false" class="i_image" src="https://img/e.jpg" />
<div itemprop="offers" itemscope itemtype="http://schema.org/Offer" class="i_price"> ${old} <meta itemprop="priceCurrency" content="EUR" /> <span><i itemprop="price">${price}</i><small> za kos</small></span> </div>
<div class="i_price_info">${info}</div></div></a>`;

test('Eurospin: ime z znamko, stara in nova cena, embalaža, obdobje', () => {
  const [d] = parseEurospin(euroTile(), '2026-11-16');
  assert.equal(d.s, 'eurospin');
  assert.equal(d.n, 'LAND BAVARSKI EMENTALEC');
  assert.equal(d.p, 2.49);
  assert.equal(d.o, 3.49);
  assert.equal(d.d, 29);
  assert.equal(d.q, '400 g');
  assert.equal(d.b, '1 kg = 6,23');
  assert.equal(d.i, 'https://img/e.jpg');
  assert.equal(d.f, '2026-11-12');
  assert.equal(d.to, '2026-11-18');
});

test('Eurospin: brez stare cene in cene na enoto, akcija čez novo leto', () => {
  const [d] = parseEurospin(euroTile({ old: '', info: '1 kg', date: '29.12 - 4.1' }), '2026-12-28');
  assert.equal(d.o, null);
  assert.equal(d.d, null);
  assert.equal(d.q, '1 kg');
  assert.equal(d.b, null);
  assert.equal(d.f, '2026-12-29');
  assert.equal(d.to, '2027-01-04');
});

test('Eurospin: izdelek brez cene se izpusti', () => {
  assert.deepEqual(parseEurospin(euroTile({ price: '' }), '2026-11-16'), []);
});

// ---------- combine: ohranjanje včerajšnjih podatkov ----------
const deal = (s, n) => ({ s, n, p: 1 });
const PREV = {
  updatedAt: '2026-11-13T12:00:00.000Z',
  stores: { tus: { ok: true, count: 3, at: '2026-11-13T12:00:00.000Z' }, lidl: { ok: true, count: 2, at: '2026-11-13T12:00:00.000Z' } },
  deals: [deal('tus', 'a'), deal('tus', 'b'), deal('tus', 'c'), deal('lidl', 'x'), deal('lidl', 'y')],
};
const NOW_ISO = '2026-11-14T12:00:00.000Z';

test('combine: vse uspe', () => {
  const out = combine({ tus: { list: [deal('tus', 'n1'), deal('tus', 'n2')] }, lidl: { list: [deal('lidl', 'n3')] } }, PREV, NOW_ISO);
  assert.deepEqual(out.stores.tus, { ok: true, count: 2, at: NOW_ISO });
  assert.equal(out.deals.length, 3);
  assert.equal(out.updatedAt, NOW_ISO);
});

test('combine: napaka obdrži včerajšnje akcije te trgovine', () => {
  const out = combine({ tus: { error: '503 https://www.tus.si/' }, lidl: { list: [deal('lidl', 'n')] } }, PREV, NOW_ISO);
  assert.equal(out.stores.tus.ok, false);
  assert.equal(out.stores.tus.stale, true);
  assert.equal(out.stores.tus.at, '2026-11-13T12:00:00.000Z');
  assert.equal(out.stores.tus.count, 3);
  assert.match(out.stores.tus.error, /503/);
  assert.deepEqual(out.deals.map(d => d.n), ['a', 'b', 'c', 'n']);
});

test('combine: 0 izdelkov je napaka', () => {
  const out = combine({ tus: { list: [] }, lidl: { list: [deal('lidl', 'n')] } }, PREV, NOW_ISO);
  assert.equal(out.stores.tus.ok, false);
  assert.match(out.stores.tus.error, /0 izdelkov/);
  assert.equal(out.deals.filter(d => d.s === 'tus').length, 3);
});

test('combine: nenaden padec števila izdelkov je napaka', () => {
  const prev = { ...PREV, stores: { ...PREV.stores, tus: { ok: true, count: 1000 } } };
  const out = combine({ tus: { list: [deal('tus', 'n')] }, lidl: { list: [deal('lidl', 'n')] } }, prev, NOW_ISO);
  assert.equal(out.stores.tus.ok, false);
  assert.match(out.stores.tus.error, /včeraj 1000/);
});

test('combine: brez včerajšnjih podatkov napaka ostane prazna, brez stale', () => {
  const out = combine({ tus: { error: 'timeout' }, lidl: { list: [deal('lidl', 'n')] } }, null, NOW_ISO);
  assert.deepEqual(out.stores.tus, { ok: false, count: 0, error: 'timeout' });
  assert.equal(out.deals.length, 1);
});

test('combine: dva dni zapored napaka ohrani prvotni datum podatkov', () => {
  const day1 = combine({ tus: { error: 'x' }, lidl: { list: [deal('lidl', 'n')] } }, PREV, NOW_ISO);
  const day2 = combine({ tus: { error: 'x' }, lidl: { list: [deal('lidl', 'n')] } }, day1, '2026-11-15T12:00:00.000Z');
  assert.equal(day2.stores.tus.at, '2026-11-13T12:00:00.000Z');
  assert.equal(day2.stores.tus.count, 3);
});

test('combine: padec se meri glede na zadnji uspešni dan, tudi po dnevu z napako', () => {
  const prev = { ...PREV, stores: { ...PREV.stores, tus: { ok: true, count: 1000 } }, deals: [...Array(1000)].map((_, i) => deal('tus', `t${i}`)) };
  const day1 = combine({ tus: { error: 'x' }, lidl: { list: [deal('lidl', 'n')] } }, prev, NOW_ISO);
  const bad = combine({ tus: { list: [deal('tus', 'z')] }, lidl: { list: [deal('lidl', 'n')] } }, day1, '2026-11-15T12:00:00.000Z');
  assert.equal(bad.stores.tus.ok, false);
  const good = combine({ tus: { list: [...Array(900)].map((_, i) => deal('tus', `z${i}`)) }, lidl: { list: [deal('lidl', 'n')] } }, day1, '2026-11-15T12:00:00.000Z');
  assert.equal(good.stores.tus.ok, true);
});

test('compact: izpusti null in plus: false, food: false ostane', () => {
  assert.deepEqual(compact({ s: 'x', o: null, food: false, plus: false, d: 0 }), { s: 'x', food: false, d: 0 });
  assert.deepEqual(compact({ s: 'x', plus: true, food: null }), { s: 'x', plus: true });
});
