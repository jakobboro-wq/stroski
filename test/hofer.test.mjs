// Testi branja Hoferjevega letaka iz položajev besedila (js/hofer.js). y raste navzgor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeaflet, topmost } from '../js/hofer.js';

const TODAY = '2026-11-14';
const t = (s, x, y, h) => ({ s, x, y, h });

// Ena stran: obdobje, en izdelek s staro ceno, popustom, embalažo in ceno na enoto.
const page = () => [
  t('12. 11.', 40, 800, 14),
  t('18. 11.', 40, 780, 14),
  t('ALPSKO', 95, 255, 6),
  t('MLEKO 3,5 %', 95, 240, 12),
  t('1 l', 95, 228, 8),
  t('-19%', 150, 260, 14),
  t('1,59', 150, 240, 12),
  t('1,29', 100, 200, 30),
  t('1,29/l', 140, 190, 7),
];

test('parseLeaflet: izdelek z imenom, ceno, staro ceno, popustom in obdobjem', () => {
  const [d, ...rest] = parseLeaflet([page()], TODAY);
  assert.equal(rest.length, 0);
  assert.equal(d.s, 'hofer');
  assert.equal(d.n, 'ALPSKO MLEKO 3,5 %');
  assert.equal(d.p, 1.29);
  assert.equal(d.o, 1.59);
  assert.equal(d.d, 19);
  assert.equal(d.q, '1 l');
  assert.equal(d.b, '1 l = 1,29');
  assert.equal(d.f, '2026-11-12');
  assert.equal(d.to, '2026-11-18');
  assert.equal(d.t, 'Letak, str. 1');
});

test('parseLeaflet: reklamni napis ni ime, cena brez imena se izpusti', () => {
  const items = [t('12. 11.', 40, 800, 14), t('18. 11.', 40, 780, 14), t('ZAGRABI PONUDBO', 95, 240, 12), t('2,99', 100, 200, 30)];
  assert.deepEqual(parseLeaflet([items], TODAY), []);
});

test('parseLeaflet: brez stare cene se iz popusta izračuna', () => {
  const items = page().filter(i => i.s !== '1,59');
  const [d] = parseLeaflet([items], TODAY);
  assert.equal(d.o, 1.59);
  assert.equal(d.d, 19);
});

test('parseLeaflet: stran brez datuma podeduje obdobje letaka; dvojniki se izpustijo', () => {
  const noDates = page().filter(i => !/\d\.\s?\d+\.$/.test(i.s));
  const out = parseLeaflet([page(), noDates], TODAY);
  assert.equal(out.length, 1);
  const other = noDates.map(i => (i.s === 'MLEKO 3,5 %' ? { ...i, s: 'JOGURT' } : i));
  const [, d2] = parseLeaflet([page(), other], TODAY);
  assert.equal(d2.n, 'ALPSKO JOGURT');
  assert.equal(d2.f, '2026-11-12');
  assert.equal(d2.to, '2026-11-18');
  assert.equal(d2.t, 'Letak, str. 2');
});

test('parseLeaflet: letak čez novo leto dobi pravo leto', () => {
  const items = page().map(i => (i.s === '12. 11.' ? { ...i, s: '29. 12.' } : i.s === '18. 11.' ? { ...i, s: '4. 1.' } : i));
  const [d] = parseLeaflet([items], '2026-12-28');
  assert.equal(d.f, '2026-12-29');
  assert.equal(d.to, '2027-01-04');
});

test('topmost: na istem mestu obvelja zadnje narisano besedilo (nalepka z novim datumom)', () => {
  const out = topmost([t('12. 11.', 39, 800, 14), t('  ', 0, 0, 0), t('13. 11.', 40, 800, 14)]);
  assert.deepEqual(out.map(i => i.s), ['13. 11.']);
});
