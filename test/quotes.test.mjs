// Testi cen delnic (js/quotes.js). Sintetični odgovori v obliki funkcije stock_chart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fxSymbol, parseQuote, priceOn, inEur, changeSince, fundMarketValue, portfolioVolatility } from '../js/quotes.js';

const sec = iso => Date.parse(`${iso}T14:30:00Z`) / 1000;

test('parseQuote: dnevi, manjkajoče cene, penny v funte, napaka', () => {
  const q = parseQuote({ symbol: 'ABC', currency: 'USD', price: 12, time: sec('2026-11-16'), t: [sec('2026-11-12'), sec('2026-11-13'), sec('2026-11-16')], c: [10, null, 12] });
  assert.deepEqual(q.history, [{ date: '2026-11-12', close: 10 }, { date: '2026-11-16', close: 12 }]);
  assert.equal(q.date, '2026-11-16');
  const p = parseQuote({ symbol: 'X.L', currency: 'GBp', price: 250, t: [sec('2026-11-16')], c: [250] });
  assert.equal(p.currency, 'GBP');
  assert.equal(p.price, 2.5);
  assert.equal(parseQuote({ symbol: 'Z', error: 404 }).error, 404);
  assert.equal(fxSymbol('USD'), 'EURUSD=X');
  assert.equal(fxSymbol('EUR'), null);
});

test('priceOn: zadnja cena na dan ali prej', () => {
  const h = [{ date: '2026-01-02', close: 1 }, { date: '2026-01-05', close: 2 }, { date: '2026-01-06', close: 3 }];
  assert.equal(priceOn(h, '2026-01-01'), null);
  assert.equal(priceOn(h, '2026-01-04'), 1);
  assert.equal(priceOn(h, '2026-01-06'), 3);
  assert.equal(priceOn(h, '2027-01-01'), 3);
});

test('inEur: pretvorba s tečajem tistega dne', () => {
  const q = { symbol: 'ABC', currency: 'USD', price: 22, history: [{ date: '2026-11-12', close: 11 }, { date: '2026-11-16', close: 22 }] };
  const fx = { symbol: 'EURUSD=X', currency: 'USD', price: 1.1, history: [{ date: '2026-11-12', close: 1.0 }, { date: '2026-11-16', close: 1.1 }] };
  const e = inEur(q, fx);
  assert.equal(e.currency, 'EUR');
  assert.equal(e.price, 20);
  assert.deepEqual(e.history.map(h => h.close), [11, 20]);
  assert.ok(inEur(q, null).error);
  const eur = { currency: 'EUR', price: 5, history: [] };
  assert.equal(inEur(eur, null), eur);
});

test('changeSince', () => {
  const h = [{ date: '2025-11-14', close: 100 }, { date: '2026-11-16', close: 112 }];
  assert.ok(Math.abs(changeSince(h, '2026-11-16', 365) - 0.12) < 1e-9);
  assert.equal(changeSince(h, '2026-11-16', 800), null);
});

test('fundMarketValue: vplačila po ceni tistega dne, vpisana vrednost kot sidro', () => {
  const h = [{ date: '2026-01-05', close: 100 }, { date: '2026-06-05', close: 80 }, { date: '2026-11-16', close: 120 }];
  const deposits = [{ fundId: 'f', date: '2026-01-05', amount: 100 }, { fundId: 'f', date: '2026-06-05', amount: 100 }, { fundId: 'g', date: '2026-06-05', amount: 999 }];
  // 1 enota po 100 + 1,25 enote po 80 = 2,25 enote × 120
  assert.equal(fundMarketValue({ id: 'f' }, deposits, h, 120, '2026-11-16'), 270);
  // vpisano 150 € 5. 6. (velja tudi vplačilo tistega dne), nato rast 80 → 120
  assert.equal(fundMarketValue({ id: 'f', value: 150, valueDate: '2026-06-05' }, deposits, h, 120, '2026-11-16'), 225);
  // vplačilo pred začetkom zgodovine → ni mogoče
  assert.equal(fundMarketValue({ id: 'f' }, [{ fundId: 'f', date: '2025-01-01', amount: 50 }], h, 120, '2026-11-16'), null);
});

test('portfolioVolatility: konstantna rast nima nihanja, izmenično nihanje ga ima; povezanost šteje', () => {
  const days = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  const smooth = days.map((date, i) => ({ date, close: 100 * 1.001 ** i }));
  assert.ok(portfolioVolatility([{ history: smooth, weight: 1 }]) < 1e-6);
  const up = days.map((date, i) => ({ date, close: i % 2 ? 101 : 100 }));
  const down = days.map((date, i) => ({ date, close: i % 2 ? 99 : 100 }));
  const one = portfolioVolatility([{ history: up, weight: 1 }]);
  assert.ok(Math.abs(one - Math.log(1.01) * Math.sqrt(252) * Math.sqrt(199 / 198)) < 0.01, `vol ${one}`);
  // nasprotno gibanje se izniči
  assert.ok(portfolioVolatility([{ history: up, weight: 1 }, { history: down, weight: 1 }]) < 0.001);
  assert.equal(portfolioVolatility([{ history: smooth.slice(0, 30), weight: 1 }]), null);
});

test('currentValue: tržna vrednost ima prednost pred starejšo vpisano', async () => {
  const { currentValue } = await import('../js/invest.js');
  const deposits = [{ fundId: 'f', date: '2026-01-05', amount: 100 }, { fundId: 'f', date: '2026-11-20', amount: 50 }];
  const fund = { id: 'f', value: 90, valueDate: '2026-03-01', marketValue: 130, marketDate: '2026-11-16' };
  assert.equal(currentValue(fund, deposits, '2026-11-30'), 180);
  assert.equal(currentValue(fund, deposits, '2026-10-01'), 90); // tržna je iz prihodnosti
  assert.equal(currentValue({ ...fund, valueDate: '2026-11-16', value: 120 }, deposits, '2026-11-30'), 170); // ročni vpis istega dne zmaga
});
