// Posamezne delnice: nakupi in prodaje po kosih, nabavna vrednost ter dobiček ali izguba.
// Vsi zneski so v evrih in s provizijo, kot jih pokaže Revolut.

const EPS = 1e-8; // Revolut prodaja tudi delne kose, zato pri seštevanju ostanejo drobni ostanki

const byDate = (a, b) => a.date.localeCompare(b.date)
  || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1)
  || (a.createdAt ?? 0) - (b.createdAt ?? 0);

/**
 * Stanje delnice po vseh nakupih in prodajah. Prodaja vzame najprej najstarejše kose (FIFO).
 * oversold: prodanih je več kosov, kot jih je bilo na voljo.
 */
export function position(trades) {
  const lots = [];
  let realized = 0;
  let oversold = false;
  for (const t of [...trades].sort(byDate)) {
    if (t.side === 'buy') {
      lots.push({ shares: t.shares, cost: t.amount });
      continue;
    }
    let left = t.shares;
    let cost = 0;
    while (left > EPS && lots.length) {
      const lot = lots[0];
      const take = Math.min(left, lot.shares);
      const part = lot.cost * (take / lot.shares);
      lot.shares -= take;
      lot.cost -= part;
      cost += part;
      left -= take;
      if (lot.shares <= EPS) lots.shift();
    }
    if (left > EPS) oversold = true;
    realized += t.amount - cost;
  }
  const shares = lots.reduce((s, l) => s + l.shares, 0);
  const cost = lots.reduce((s, l) => s + l.cost, 0);
  return { shares, cost, average: shares > EPS ? cost / shares : null, realized, oversold };
}

/** Vrednost kosov po zadnji vpisani ceni. Brez vpisane cene se šteje nabavna vrednost. */
export function stockValue(stock, pos) {
  if (pos.shares <= EPS) return 0;
  return stock.price == null ? pos.cost : pos.shares * stock.price;
}

/** Seštevek vseh delnic; odprt dobiček šteje samo pri delnicah z vpisano vrednostjo. */
export function portfolio(stocks, trades) {
  const total = { value: 0, cost: 0, unrealized: 0, realized: 0, priced: false };
  for (const s of stocks) {
    const pos = position(trades.filter(t => t.stockId === s.id));
    total.value += stockValue(s, pos);
    total.cost += pos.cost;
    total.realized += pos.realized;
    if (s.price != null && pos.shares > EPS) {
      total.unrealized += stockValue(s, pos) - pos.cost;
      total.priced = true;
    }
  }
  return total;
}
