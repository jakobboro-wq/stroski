// Polje »Oznaka« (ticker) v oknih za delnico in sklad, z iskanjem po imenu.

import * as cloud from '../cloud.js';
import { esc } from '../ui.js';

export const normTicker = t => (t ?? '').trim().toUpperCase() || null;

export const tickerField = value => `
  <div class="field ticker-field">Oznaka za samodejno ceno (neobvezno)
    <div class="ticker-row">
      <input name="ticker" value="${esc(value ?? '')}" placeholder="npr. AAPL ali VWCE.DE" autocapitalize="characters" autocomplete="off" spellcheck="false">
      <button type="button" class="btn small" data-tsearch>Poišči</button>
    </div>
    <div class="ticker-results"></div>
  </div>`;

/** Gumb »Poišči«: išče po vpisani oznaki ali po nazivu (nameInput) in ponudi zadetke. */
export function bindTickerField(root, nameInput) {
  const input = root.querySelector('input[name=ticker]');
  const out = root.querySelector('.ticker-results');
  root.querySelector('[data-tsearch]').addEventListener('click', async () => {
    const q = (input.value.trim() || nameInput?.value.trim() || '').slice(0, 60);
    if (!q) { out.innerHTML = '<p class="muted small">Vpiši naziv ali del oznake.</p>'; return; }
    if (!cloud.currentUser()) { out.innerHTML = '<p class="muted small">Za iskanje in samodejne cene se prijavi (Nastavitve → Sinhronizacija).</p>'; return; }
    out.innerHTML = '<p class="muted small">Iščem …</p>';
    try {
      const list = await cloud.stockSearch(q);
      out.innerHTML = list.length
        ? list.map(r => `<button type="button" class="ticker-hit" data-sym="${esc(r.symbol)}"><b>${esc(r.symbol)}</b> <span>${esc(r.name ?? '')}</span> <small class="muted">${esc([r.exchange, r.type].filter(Boolean).join(' · '))}</small></button>`).join('')
        : '<p class="muted small">Ni zadetkov. Poskusi z angleškim imenom ali oznako.</p>';
    } catch (err) {
      out.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  });
  out.addEventListener('click', e => {
    const b = e.target.closest('[data-sym]');
    if (!b) return;
    input.value = b.dataset.sym;
    out.innerHTML = '';
  });
}
