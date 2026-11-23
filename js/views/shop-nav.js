// Skupna glava zavihka Nakupi: podzavihki Shramba, Akcije, Seznam in Izdelki ter gumb za slikanje računa.

import { scanReceipt } from './receipt.js';

const LAST_KEY = 'shop-tab';
export const SHOP_TABS = [
  { route: 'zaloga', label: 'Shramba', icon: '🧺' },
  { route: 'akcije', label: 'Akcije', icon: '🏷️' },
  { route: 'seznam', label: 'Seznam', icon: '📝' },
  { route: 'izdelki', label: 'Izdelki', icon: '📚' },
];

/** Zadnji odprti podzavihek (za gumb Nakupi v meniju). */
export function lastShopTab() {
  try { return SHOP_TABS.some(t => t.route === localStorage.getItem(LAST_KEY)) ? localStorage.getItem(LAST_KEY) : 'zaloga'; } catch { return 'zaloga'; }
}

export function shopHeader(active) {
  try { localStorage.setItem(LAST_KEY, active); } catch { /* ni nujno */ }
  return `
    <header class="page-head spread"><h1>Nakupi</h1>
      <span class="scan-btns"><label class="btn primary">📷 Slikaj račun<input type="file" accept="image/*" capture="environment" class="shop-scan" hidden></label>
      <label class="btn">📄 PDF<input type="file" accept="application/pdf,.pdf" class="shop-scan" aria-label="Uvozi račun v PDF" hidden></label></span>
    </header>
    <nav class="subtabs" aria-label="Nakupi">
      ${SHOP_TABS.map(t => `<a href="#/${t.route}"${t.route === active ? ' class="on" aria-current="page"' : ''}>${t.icon} ${t.label}</a>`).join('')}
    </nav>`;
}

export function bindShopHeader(view) {
  view.querySelectorAll('.shop-scan').forEach(input => input.addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) scanReceipt(file);
  }));
}
