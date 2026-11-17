// Samostojna aplikacija »Nakupi« (nakupi/index.html): samo Shramba, Akcije, Seznam in slikanje računov.
// Ista koda in ista oblika podatkov kot Stroški, a brez pregleda stroškov, ur in premoženja.
// Vsak uporabnik ima svoj račun in svoje šifrirane podatke (sinhronizacija v nastavitvah).

import { load } from './store.js';
import { hideTip } from './ui.js';
import { initSync } from './sync.js';
import { renderDeals } from './views/deals.js';
import { renderPantry } from './views/pantry.js';
import { renderShoplist } from './views/shoplist.js';
import { renderShopSettings } from './views/shop-settings.js';
import { lastShopTab } from './views/shop-nav.js';

const routes = { zaloga: renderPantry, akcije: renderDeals, seznam: renderShoplist, nastavitve: renderShopSettings };

const view = document.getElementById('view');
let lastRoute = null;

function render() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (!routes[path]) { location.replace(`#/${lastShopTab()}`); return; }
  document.getElementById('gearBtn')?.classList.toggle('active', path === 'nastavitve');
  hideTip();
  routes[path](view);
  if (path !== lastRoute) {
    window.scrollTo(0, 0);
    lastRoute = path;
  }
}

window.addEventListener('hashchange', render);
document.addEventListener('data-changed', render);

await load();
render();
initSync();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js');
