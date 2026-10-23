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
    if (rnd() < 0.08) add(pick(["McDonald's", 'Gostilna pri Lojzetu']), -(8 + rnd() * 20), 'dining');
    if (rnd() < 0.08) add(pick(['Wolt', 'Glovo', 'Bolt Food']), -(10 + rnd() * 15), 'delivery');
    if (rnd() < 0.12) add(pick(['Kavarna Astoria', 'Admiral Kafe']), -(1.8 + rnd() * 5), 'cafes');
    if (rnd() < 0.07) add(pick(['Petrol', 'OMV', 'MOL']), -(35 + rnd() * 30), 'fuel');
    if (rnd() < 0.04) add('Bolt', -(4 + rnd() * 9), 'taxi');
    if (rnd() < 0.04) add('Marprom', -1.5, 'public_transport');
    if (rnd() < 0.04) add(pick(['Zalando', 'H&M']), -(15 + rnd() * 60), 'clothes');
    if (rnd() < 0.02) add(pick(['Amazon', 'Big Bang']), -(20 + rnd() * 80), 'electronics');
    if (rnd() < 0.03) add('Decathlon', -(10 + rnd() * 60), 'sport_gear');
    if (rnd() < 0.04) add(pick(['Kolosej', 'Eventim']), -(7 + rnd() * 28), 'events');
    if (rnd() < 0.03) add(pick(['Lekarna', 'dm drogerie markt']), -(4 + rnd() * 22), 'health');
    if (day === 1) add('Najemnina', -260, 'rent');
    if (day === 3) add('Netflix', -12.99, 'streaming');
    if (day === 7) add('Spotify', -10.99, 'streaming');
    if (day === 15) add('A1 Slovenija', -19.99, 'telecom');
    if (day === 10) add('Payment from e-Študentski servis', 620 + rnd() * 260, 'student_work');
    if (rnd() < 0.025) add('To Ana Novak', -(8 + rnd() * 30), 'people');
  }
  return out;
}

export const loadDemo = () => saveTransactions(demoTransactions());
