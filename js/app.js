import { load, generateRecurring, ensureTradeTransactions } from './store.js';
import { openTxDialog } from './dialog.js';
import { hideTip, todayISO } from './ui.js';
import { initSync } from './sync.js';
import { renderOverview } from './views/overview.js';
import { renderTransactions } from './views/transactions.js';
import { renderImport } from './views/import.js';
import { renderSettings } from './views/settings.js';
import { renderWork } from './views/work.js';
import { renderAssets } from './views/assets.js';
import { renderDeals } from './views/deals.js';
import { renderPantry } from './views/pantry.js';
import { renderShoplist } from './views/shoplist.js';
import { renderStatistics } from './views/statistics.js';
import { lastShopTab } from './views/shop-nav.js';

const routes = {
  pregled: renderOverview,
  statistika: renderStatistics,
  transakcije: renderTransactions,
  ure: renderWork,
  premozenje: renderAssets,
  zaloga: renderPantry,
  seznam: renderShoplist,
  akcije: renderDeals,
  uvoz: renderImport,
  nastavitve: renderSettings,
};

const view = document.getElementById('view');
let lastRoute = null;

function render() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  // »Nakupi« v meniju odpre zadnji podzavihek (Shramba ali Akcije).
  if (path === 'nakupi') { location.replace(`#/${lastShopTab()}`); return; }
  const name = routes[path] ? path : 'pregled';
  const navName = { zaloga: 'nakupi', akcije: 'nakupi', seznam: 'nakupi', statistika: 'pregled' }[name] ?? name;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === navName));
  document.getElementById('gearBtn')?.classList.toggle('active', name === 'nastavitve');
  hideTip();
  routes[name](view, new URLSearchParams(query));
  if (name !== lastRoute) {
    window.scrollTo(0, 0);
    lastRoute = name;
  }
}

// Ponavljajoči stroški: ob zagonu, ob vrnitvi v aplikacijo in po sinhronizaciji dodaj zapadle.
let recurringTimer;
const checkRecurring = () => {
  clearTimeout(recurringTimer);
  recurringTimer = setTimeout(async () => {
    await generateRecurring(todayISO());
    await ensureTradeTransactions();
  }, 800);
};

document.getElementById('addBtn').addEventListener('click', () => openTxDialog());
window.addEventListener('hashchange', render);
document.addEventListener('data-changed', () => { render(); checkRecurring(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkRecurring();
  if (location.hash.startsWith('#/ure')) render(); // osveži »v službi že X h«
});

await load();
await generateRecurring(todayISO());
await ensureTradeTransactions();
render();
initSync();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
