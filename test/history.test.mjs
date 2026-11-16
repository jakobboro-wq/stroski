// Testi zgodovine cen: posnetki, obdobja akcij, cikli in dopolnitev akcij (scraper/history.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { productId, snapshot, episodes, statsOf, annotate, buildStats, addDay } from '../scraper/history.mjs';

const kava = { s: 'mercator', n: 'Kava Barcaffe classic, 400 g', p: 4.99, o: 6.49, d: 23, g: 'zajtrk' };

test('productId: stabilen, neodvisen od velikih črk in šumnikov', () => {
  assert.equal(productId(kava), productId({ ...kava, n: 'KAVA BARCAFFE CLASSIC, 400 G' }));
  assert.notEqual(productId(kava), productId({ ...kava, s: 'tus' }));
  assert.match(productId(kava), /^m[0-9a-z]+$/);
});

test('snapshot: nižja cena pri dvojniku, brez neveljavnih', () => {
  const { items, products } = snapshot([kava, { ...kava, p: 4.49 }, { s: 'lidl', n: 'x', p: 0 }]);
  assert.deepEqual(Object.values(items), [[4.49, 6.49, 23, 0]]);
  assert.equal(Object.values(products)[0].g, 'zajtrk');
});

// Kava v akciji 3.–9. 11., 1.–7. 12. (manjka en dan), 29. 12.–4. 1. → cikel 28 dni.
function dayMapFor(ranges, price = 4.99) {
  const id = productId(kava);
  const map = {};
  for (const [from, to, skip] of ranges) {
    for (let t = Date.parse(from); t <= Date.parse(to); t += 86400e3) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (d === skip) continue;
      map[d] = { ...(map[d] ?? {}), [id]: [price, 6.49, 23, 0] };
    }
  }
  return map;
}

test('episodes: luknja do dveh dni je isto obdobje', () => {
  const eps = episodes(dayMapFor([['2026-11-03', '2026-11-09'], ['2026-12-01', '2026-12-07', '2026-12-04']])).get(productId(kava));
  assert.deepEqual(eps.map(e => [e.start, e.end]), [['2026-11-03', '2026-11-09'], ['2026-12-01', '2026-12-07']]);
  assert.equal(eps[0].regular, 6.49);
});

test('statsOf: cikel, napoved naslednje akcije, najnižja cena', () => {
  const map = dayMapFor([['2026-11-03', '2026-11-09'], ['2026-12-01', '2026-12-07'], ['2026-12-29', '2027-01-04']]);
  map['2026-12-02'][productId(kava)][0] = 4.49; // enkrat ceneje
  const eps = episodes(map).get(productId(kava));
  const off = statsOf(eps, '2027-01-10');
  assert.equal(off.ep, 3);
  assert.equal(off.cy, 28);
  assert.equal(off.next, '2027-01-26');
  assert.equal(off.on, false);
  assert.equal(off.lo, 4.49);
  assert.equal(off.lod, '2026-12-01');
  assert.equal(off.typ, 4.99);
  assert.equal(off.reg, 6.49);
  const on = statsOf(eps, '2027-01-04');
  assert.equal(on.on, true);
  assert.equal(on.next, '2027-01-26');
  // Zamuja: napoved je bila 26. 1., danes je 30. 1. in je ni → »vsak čas« (jutri)
  assert.equal(statsOf(eps, '2027-01-30').next, '2027-01-31');
  // Eno samo obdobje: brez cikla
  assert.equal(statsOf(eps.slice(0, 1), '2026-11-20').cy, null);
});

test('annotate in buildStats', () => {
  const map = dayMapFor([['2026-11-03', '2026-11-09'], ['2026-12-01', '2026-12-07']], 4.49);
  map['2026-12-07'][productId(kava)][0] = 4.99;
  const products = { [productId(kava)]: { s: 'mercator', n: kava.n, g: 'zajtrk' } };
  const { byId, json } = buildStats(map, products, '2026-12-07');
  assert.equal(json.rows.length, 1);
  assert.equal(json.days, 14);
  assert.equal(json.since, '2026-11-03');
  const row = Object.fromEntries(json.cols.map((c, i) => [c, json.rows[0][i]]));
  assert.equal(row.cy, 28);
  assert.equal(row.on, 1);
  const [d] = annotate([kava], byId);
  assert.equal(d.lo, 4.49);
  assert.equal(d.ep, 2);
  assert.equal(d.cy, 28);
  const [same] = annotate([{ ...kava, p: 4.49 }], byId);
  assert.equal(same.lo, undefined); // ni bilo ceneje
  assert.deepEqual(annotate([{ s: 'tus', n: 'drugo', p: 1 }], byId), [{ s: 'tus', n: 'drugo', p: 1 }]);
});

test('addDay: zapiše posnetek in izdelke v mapo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cene-'));
  await addDay(dir, '2026-11-16', [kava]);
  const { dayMap, products } = await addDay(dir, '2026-11-17', [{ ...kava, p: 4.79 }]);
  assert.deepEqual(Object.keys(dayMap).sort(), ['2026-11-16', '2026-11-17']);
  const pr = products[productId(kava)];
  assert.equal(pr.first, '2026-11-16');
  assert.equal(pr.last, '2026-11-17');
  const day = JSON.parse(await readFile(path.join(dir, 'days', '2026-11-17.json'), 'utf8'));
  assert.equal(Object.values(day.items)[0][0], 4.79);
});
