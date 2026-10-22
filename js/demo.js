// Izmišljeni podatki za preizkus aplikacije (zadnjih 6 mesecev).

import { saveTransactions } from './store.js';
import { addMonths } from './stats.js';
import { currentMonth, todayISO } from './ui.js';

export function demoTransactions() {
  let seed = 20261022;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = list => list[Math.floor(rnd() * list.length)];
  const out = [];
  const end = todayISO();
  const d = new Date(`${addMonths(currentMonth(), -5)}-01T12:00:00`);

  for (; ; d.setDate(d.getDate() + 1)) {
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (date > end) break;
    const day = d.getDate();
    const add = (description, amount, categoryId) => out.push({
      date, description, amount: Math.round(amount * 100) / 100, categoryId,
      currency: 'EUR', account: 'Revolut', source: 'demo', categorySource: 'rule',
    });
    if (rnd() < 0.42) add(pick(['Mercator', 'Spar', 'Hofer', 'Lidl', 'Tuš']), -(6 + rnd() * 48), 'groceries');
    if (rnd() < 0.2) add(pick(['Wolt', 'Glovo', "McDonald's", 'Kavarna Astoria', 'Gostilna pri Lojzetu', 'Bolt Food']), -(4 + rnd() * 20), 'dining');
    if (rnd() < 0.07) add(pick(['Petrol', 'OMV', 'MOL']), -(35 + rnd() * 30), 'transport');
    if (rnd() < 0.06) add(pick(['Bolt', 'Marprom']), -(1.5 + rnd() * 9), 'transport');
    if (rnd() < 0.05) add(pick(['Zalando', 'Decathlon', 'H&M', 'Amazon', 'Big Bang']), -(15 + rnd() * 80), 'shopping');
    if (rnd() < 0.04) add(pick(['Kolosej', 'Steam', 'Eventim']), -(7 + rnd() * 28), 'fun');
    if (rnd() < 0.03) add(pick(['Lekarna', 'dm drogerie markt']), -(4 + rnd() * 22), 'health');
    if (rnd() < 0.02) add('Admiral Kafe', -(2 + rnd() * 4), 'other');
    if (day === 1) add('Najemnina', -260, 'housing');
    if (day === 3) add('Netflix', -12.99, 'subscriptions');
    if (day === 7) add('Spotify', -10.99, 'subscriptions');
    if (day === 15) add('A1 Slovenija', -19.99, 'housing');
    if (day === 10) add('Payment from e-Študentski servis', 620 + rnd() * 260, 'salary');
    if (rnd() < 0.025) add('To Ana Novak', -(8 + rnd() * 30), 'people');
  }
  return out;
}

export const loadDemo = () => saveTransactions(demoTransactions());
