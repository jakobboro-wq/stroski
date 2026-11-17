// Nastavitve v aplikaciji Nakupi: prijava in sinhronizacija, shranjeni računi, varnostna kopija.

import { state, deleteTransactions, exportData } from '../store.js';
import { renderSyncCard } from './sync-card.js';
import { esc, money, ask, toast, download, todayISO, dayLabel, plural } from '../ui.js';

/** Računi iz slikanja, združeni po receiptId (en račun ima lahko več transakcij po kategorijah). */
function receipts() {
  const byId = new Map();
  for (const t of state.transactions) {
    if (t.source !== 'receipt' || !t.receiptId) continue;
    const r = byId.get(t.receiptId) ?? { id: t.receiptId, date: t.date, store: t.description, total: 0, items: 0, ids: [] };
    r.total += -t.amount;
    r.items += t.items?.length ?? 0;
    r.ids.push(t.id);
    byId.set(t.receiptId, r);
  }
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function renderShopSettings(view) {
  const list = receipts();
  const shown = list.slice(0, 30);
  view.innerHTML = `
    <header class="page-head"><h1>Nastavitve</h1></header>
    <section class="card" id="syncCard"></section>

    <section class="card">
      <h2>Shranjeni računi</h2>
      ${list.length ? `<div>${shown.map(r => `
        <div class="rc-row">
          <span>${esc(r.store)}<br><span class="muted small">${esc(dayLabel(r.date))} · ${esc(plural(r.items, ['izdelek', 'izdelka', 'izdelki', 'izdelkov']))}</span></span>
          <b>${esc(money(r.total))}</b>
          <button type="button" class="btn ghost small" data-del="${esc(r.id)}">Izbriši</button>
        </div>`).join('')}</div>
        ${list.length > shown.length ? `<p class="muted small">Prikazanih je zadnjih ${shown.length} od ${list.length}.</p>` : ''}`
      : '<p class="muted small">Še ni slikanih računov. Račun slikaš z gumbom »Slikaj račun« zgoraj v Nakupih.</p>'}
    </section>

    <section class="card">
      <h2>Podatki</h2>
      <p class="muted small">Računi, zaloga in seznam so shranjeni na tej napravi. Če se prijaviš, se zašifrirajo in sinhronizirajo med tvojimi napravami. Nihče drug jih ne vidi.</p>
      <div class="button-row"><button class="btn" id="exportBtn">Izvozi varnostno kopijo</button></div>
    </section>`;

  renderSyncCard(view.querySelector('#syncCard'));
  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const r = list.find(x => x.id === b.dataset.del);
    if (await ask(`Izbrišem račun ${r.store} z dne ${dayLabel(r.date)} (${money(r.total)})?`, { yes: 'Izbriši', danger: true })) {
      await deleteTransactions(r.ids);
      toast('Račun izbrisan');
    }
  }));
  view.querySelector('#exportBtn').addEventListener('click', () => {
    download(`nakupi-kopija-${todayISO()}.json`, JSON.stringify(exportData(), null, 1));
  });
}
