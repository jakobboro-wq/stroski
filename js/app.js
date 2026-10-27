import { load, generateRecurring } from './store.js';
import { openTxDialog } from './dialog.js';
import { hideTip, todayISO } from './ui.js';
import { initSync } from './sync.js';
import { renderOverview } from './views/overview.js';
import { renderTransactions } from './views/transactions.js';
import { renderImport } from './views/import.js';
import { renderSettings } from './views/settings.js';
import { renderWork } from './views/work.js';
import { renderAssets } from './views/assets.js';

const routes = {
  pregled: renderOverview,
  transakcije: renderTransactions,
  ure: renderWork,
  premozenje: renderAssets,
  uvoz: renderImport,
  nastavitve: renderSettings,
};

const view = document.getElementById('view');
let lastRoute = null;

function render() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const name = routes[path] ? path : 'pregled';
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
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
  recurringTimer = setTimeout(() => generateRecurring(todayISO()), 800);
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
render();
initSync();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
