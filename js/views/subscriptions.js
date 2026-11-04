// Kartica »Lov na naročnine« na Pregledu.

import { state, category, kindOf, getSetting, saveSetting, confirmSubscription, BASE_CURRENCY } from '../store.js';
import { EVERY } from '../recurring.js';
import { detectSubscriptions } from '../subscriptions.js';
import { esc, money, money0, plural, todayISO, toast } from '../ui.js';

const SETTING = 'subscriptions';
const FOUND_FORMS = ['možno naročnino', 'možni naročnini', 'možne naročnine', 'možnih naročnin'];
const dayShort = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };

function candidates() {
  const dismissed = new Set(getSetting(SETTING, { dismissed: [] }).dismissed);
  const all = detectSubscriptions(state.transactions, { kindOf, series: state.recurring, currency: BASE_CURRENCY, today: todayISO() });
  return { shown: all.filter(c => !dismissed.has(c.id)), hidden: all.filter(c => dismissed.has(c.id)).length };
}

function rowHtml(c) {
  const meta = [`${EVERY[c.every].short}`, `${c.count}×`, `zadnjič ${dayShort(c.lastDate)}`, !c.sure && 'še ni zanesljivo'].filter(Boolean).join(' · ');
  return `
    <div class="sub-row">
      <span class="emoji-badge">${esc(category(c.categoryId).emoji)}</span>
      <a class="tx-main" href="#/transakcije?q=${encodeURIComponent(c.key)}">
        <span class="tx-desc">${esc(c.description)}</span>
        <span class="tx-meta">${esc(meta)}</span>
        ${c.priceUp ? `<span class="tx-meta"><span class="delta bad">▲ podražitev: ${money(c.priceUp.from)} → ${money(c.priceUp.to)}</span></span>` : ''}
      </a>
      <span class="fund-amt"><b>${money0(c.perYear)} na leto</b><small>${money(Math.abs(c.amount))} ${esc(EVERY[c.every].short)}</small></span>
      <span class="sub-actions">
        <button class="btn" data-sub-skip="${esc(c.id)}">Ni naročnina</button>
        <button class="btn primary" data-sub-ok="${esc(c.id)}">Potrdi</button>
      </span>
    </div>`;
}

export function subscriptionsCard() {
  const { shown, hidden } = candidates();
  const months = new Set(state.transactions.filter(t => t.source === 'csv').map(t => t.date.slice(0, 7))).size;
  const total = shown.reduce((sum, c) => sum + c.perYear, 0);
  const restore = hidden ? `<button class="link-btn" id="subRestore">Skrite: ${hidden} · pokaži</button>` : '';

  if (!shown.length) {
    return `
      <section class="card">
        <h2>Lov na naročnine</h2>
        <p class="muted small">${months < 3
          ? 'Za iskanje potrebujem vsaj 3 mesece plačil. <a href="#/uvoz">Uvozi Revolut izpisek</a> in sam poiščem ponavljajoča se plačila.'
          : 'Novih ponavljajočih se plačil nisem našel.'} ${restore}</p>
      </section>`;
  }
  return `
    <section class="card">
      <div class="card-head">
        <h2>Lov na naročnine</h2>
        ${restore}
      </div>
      <p class="sub-summary">Našel sem ${plural(shown.length, FOUND_FORMS)}: skupaj približno <b>${money0(total)} na leto</b>.</p>
      <div class="sub-list">${shown.map(rowHtml).join('')}</div>
      <p class="muted small">Potrjeno plačilo se šteje v napoved, nova plačila pa še vedno pridejo z uvozom izpiska. Prekličeš ga pri ponudniku, ne tukaj.</p>
    </section>`;
}

export function bindSubscriptions(view) {
  const byId = id => candidates().shown.find(c => c.id === id);
  view.querySelectorAll('[data-sub-ok]').forEach(btn => btn.addEventListener('click', async () => {
    const c = byId(btn.dataset.subOk);
    if (!c) return;
    await confirmSubscription(c);
    toast('Dodano med ponavljajoče stroške');
  }));
  view.querySelectorAll('[data-sub-skip]').forEach(btn => btn.addEventListener('click', async () => {
    const { dismissed } = getSetting(SETTING, { dismissed: [] });
    await saveSetting({ id: SETTING, dismissed: [...new Set([...dismissed, btn.dataset.subSkip])] });
    toast('Skrito');
  }));
  view.querySelector('#subRestore')?.addEventListener('click', () => saveSetting({ id: SETTING, dismissed: [] }));
}
