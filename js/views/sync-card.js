// Kartica »Sinhronizacija« v nastavitvah: prijava, geslo za šifriranje, stanje.

import { sync, syncNow, login, unlock, logout, hasRemoteVault } from '../sync.js';
import { esc, ask, toast } from '../ui.js';

const when = ts => new Date(ts).toLocaleString('sl-SI', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

let listening = false;

export function renderSyncCard(el) {
  if (!listening) {
    listening = true;
    document.addEventListener('sync-status', () => {
      const card = document.getElementById('syncCard');
      if (card) renderSyncCard(card);
    });
  }
  const error = sync.error ? `<p class="form-error">${esc(sync.error)}</p>` : '';

  if (sync.status === 'off') {
    el.innerHTML = '<h2>Sinhronizacija</h2><p class="muted small">Povezava s strežnikom še ni nastavljena.</p>';
    return;
  }

  if (sync.status === 'login') {
    el.innerHTML = `
      <h2>Sinhronizacija</h2>
      <p class="muted small">Prijavi se, da so podatki na voljo na vseh napravah. Podatki se pred nalaganjem zašifrirajo.</p>
      ${error}
      <form class="sync-form" id="loginForm">
        <label class="field">E-naslov<input type="email" name="email" autocomplete="username" required></label>
        <label class="field">Geslo za prijavo<input type="password" name="password" autocomplete="current-password" minlength="8" required></label>
        <div class="button-row">
          <button class="btn primary" value="login">Prijava</button>
          <button class="btn" value="create">Ustvari račun</button>
        </div>
      </form>`;
    const form = el.querySelector('#loginForm');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const create = e.submitter?.value === 'create';
      const { email, password } = form.elements;
      busy(form, true);
      try {
        await login(email.value.trim(), password.value, create);
        toast(create ? 'Račun ustvarjen' : 'Prijava uspela');
      } catch (err) {
        showError(form, err.message);
        busy(form, false);
      }
    });
    return;
  }

  if (sync.status === 'password') {
    el.innerHTML = '<h2>Sinhronizacija</h2><p class="muted small">Preverjam …</p>';
    hasRemoteVault().then(exists => {
      el.innerHTML = `
        <h2>${exists ? 'Vpiši geslo za šifriranje' : 'Izberi geslo za šifriranje'}</h2>
        <p class="muted small">${exists
          ? 'Isto geslo, kot ga uporabljaš na drugih napravah.'
          : 'S tem geslom se podatki zašifrirajo na tvoji napravi, preden gredo v oblak. Ni isto kot geslo za prijavo. <b>Shrani ga v upravitelja gesel – če ga pozabiš, podatkov v oblaku ni mogoče odšifrirati.</b>'}</p>
        ${error}
        <form class="sync-form" id="keyForm">
          <label class="field">Geslo za šifriranje<input type="password" name="pass" autocomplete="new-password" minlength="${exists ? 1 : 10}" required></label>
          ${exists ? '' : '<label class="field">Ponovi geslo<input type="password" name="pass2" autocomplete="new-password" required></label>'}
          ${exists ? '' : '<p class="muted small">Vsaj 10 znakov. Dober primer: štiri naključne besede.</p>'}
          <div class="button-row"><button class="btn primary">${exists ? 'Odkleni' : 'Shrani geslo'}</button><button type="button" class="btn ghost" id="logoutBtn">Odjava</button></div>
        </form>`;
      const form = el.querySelector('#keyForm');
      el.querySelector('#logoutBtn').addEventListener('click', () => logout());
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const { pass, pass2 } = form.elements;
        if (pass2 && pass.value !== pass2.value) return showError(form, 'Gesli se ne ujemata.');
        busy(form, true);
        try {
          await unlock(pass.value);
          toast('Sinhronizacija vklopljena');
        } catch (err) {
          showError(form, err.message);
          busy(form, false);
        }
      });
    }).catch(err => {
      el.innerHTML = `<h2>Sinhronizacija</h2><p class="form-error">${esc(err.message)}</p>`;
    });
    return;
  }

  const line = {
    idle: `✓ Sinhronizirano${sync.lastSync ? ` · ${esc(when(sync.lastSync))}` : ''}`,
    syncing: 'Sinhroniziram …',
    error: '⚠ Sinhronizacija ni uspela',
  }[sync.status];
  el.innerHTML = `
    <h2>Sinhronizacija</h2>
    <p class="sync-line ${sync.status}">${line}</p>
    ${error}
    <p class="muted small">Račun: ${esc(sync.email)} · podatki so šifrirani z geslom, ki ga poznaš samo ti.</p>
    <div class="button-row">
      <button class="btn" id="syncBtn"${sync.status === 'syncing' ? ' disabled' : ''}>Sinhroniziraj zdaj</button>
      <button class="btn ghost" id="logoutBtn">Odjava</button>
    </div>`;
  el.querySelector('#syncBtn').addEventListener('click', () => syncNow());
  el.querySelector('#logoutBtn').addEventListener('click', async () => {
    if (await ask('Se odjavim? Podatki na tej napravi ostanejo, sinhronizacija se ustavi.', { yes: 'Odjava' })) await logout();
  });
}

function busy(form, on) {
  form.querySelectorAll('button').forEach(b => { b.disabled = on; });
}

function showError(form, message) {
  let p = form.parentElement.querySelector('.form-error');
  if (!p) {
    p = document.createElement('p');
    p.className = 'form-error';
    form.before(p);
  }
  p.textContent = message;
}
