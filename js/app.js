import { load } from './store.js';
import { openTxDialog } from './dialog.js';
import { hideTip } from './ui.js';
import { initSync } from './sync.js';
import { renderOverview } from './views/overview.js';
import { renderTransactions } from './views/transactions.js';
import { renderImport } from './views/import.js';
import { renderSettings } from './views/settings.js';

const routes = {
  pregled: renderOverview,
  transakcije: renderTransactions,
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

document.getElementById('addBtn').addEventListener('click', () => openTxDialog());
window.addEventListener('hashchange', render);
document.addEventListener('data-changed', render);

await load();
render();
initSync();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
