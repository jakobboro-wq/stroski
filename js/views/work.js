// Zavihek »Ure«: evidenca prihodov/odhodov, zaslužek, uvoz iz Excela in samodejno beleženje s telefonom.

import { state, saveWork, deleteWork, getSetting, saveSetting } from '../store.js';
import { DEFAULT_PAY, hoursOf, payOf, grossRate, monthTotals, roundTime, toMin, parseWorkbook, monthCSV } from '../work.js';
import { readXlsxSheets, isXlsx } from '../xlsx.js';
import { addMonths } from '../stats.js';
import * as cloud from '../cloud.js';
import { esc, money, monthLabel, currentMonth, todayISO, ask, toast, download, icons } from '../ui.js';

const num = (v, d = 2) => v.toLocaleString('sl-SI', { maximumFractionDigits: d });
const hoursLabel = h => `${num(h)} h`;
const dayName = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(y, m - 1, d).toLocaleDateString('sl-SI', { weekday: 'short' }).replace('.', '');
  return `${wd.charAt(0).toUpperCase() + wd.slice(1)} ${d}. ${m}.`;
};
const sortSessions = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || (toMin(b.start) ?? 0) - (toMin(a.start) ?? 0));

export function renderWork(view, params) {
  const pay = getSetting('pay', DEFAULT_PAY);
  const now = currentMonth();
  const month = /^\d{4}-\d{2}$/.test(params.get('m') ?? '') ? params.get('m') : now;
  const sessions = sortSessions(state.work.filter(s => s.date.startsWith(month)));
  const totals = monthTotals(state.work, month, pay);
  const today = todayISO();
  const todays = state.work.filter(s => s.date === today);
  const open = todays.find(s => s.start && !s.end);

  let status = '';
  if (month === now) {
    if (open) {
      const mins = Math.max(0, new Date().getHours() * 60 + new Date().getMinutes() - toMin(open.start));
      status = `<div class="punch on"><div><b>V službi od ${esc(open.start)}</b><span>${Math.floor(mins / 60)} h ${mins % 60} min</span></div><button class="btn primary" id="punch" data-kind="out">Odhod zdaj</button></div>`;
    } else {
      const done = todays.filter(s => hoursOf(s) != null);
      const info = done.length ? `Danes ${done.map(s => `${s.start}–${s.end}`).join(', ')} · ${hoursLabel(done.reduce((a, s) => a + hoursOf(s), 0))}` : 'Danes še ni prihoda.';
      status = `<div class="punch"><div><b>${esc(info)}</b></div><button class="btn primary" id="punch" data-kind="in">Prihod zdaj</button></div>`;
    }
  }

  const token = getSetting('workToken').token;
  const signedIn = Boolean(cloud.currentUser());

  view.innerHTML = `
    <header class="page-head month-head">
      <a class="icon-btn" href="#/ure?m=${addMonths(month, -1)}" aria-label="Prejšnji mesec">${icons.chevronLeft}</a>
      <h1>Ure · ${esc(monthLabel(month))}</h1>
      ${month < now ? `<a class="icon-btn" href="#/ure?m=${addMonths(month, 1)}" aria-label="Naslednji mesec">${icons.chevronRight}</a>` : '<span class="icon-btn disabled"></span>'}
    </header>

    ${status ? `<section class="card">${status}</section>` : ''}

    <div class="tiles">
      <div class="tile"><div class="tile-label">Ure v mesecu</div><div class="tile-value">${hoursLabel(totals.hours)}</div></div>
      <div class="tile"><div class="tile-label">Neto izplačilo</div><div class="tile-value">${money(totals.net)}</div></div>
      <div class="tile"><div class="tile-label">Bruto</div><div class="tile-value">${money(totals.gross)}</div></div>
    </div>
    ${totals.open ? `<p class="hint-line">⚠ ${totals.open} ${totals.open === 1 ? 'vnos nima' : 'vnosi nimajo'} prihoda ali odhoda – dopolni ${totals.open === 1 ? 'ga' : 'jih'}, da se štejejo.</p>` : ''}

    <section class="card">
      <div class="card-head"><h2>Dnevi${totals.days ? ` (${totals.days})` : ''}</h2><button class="btn" id="addDay">+ Dodaj</button></div>
      ${sessions.length ? `<div class="work-list">${sessions.map(s => {
        const h = hoursOf(s);
        return `
          <button class="work-row${h == null ? ' open' : ''}" data-id="${esc(s.id)}">
            <span class="work-day">${esc(dayName(s.date))}</span>
            <span class="work-time">${esc(s.start || '—')} – ${esc(s.end || (s.start ? 'še traja' : '—'))}${s.source === 'auto' ? ' <span title="Zabeleženo samodejno">📍</span>' : ''}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span>
            <span class="work-hours">${h == null ? '' : hoursLabel(h)}</span>
            <span class="work-pay">${h == null ? '' : money(payOf(h, pay).net)}</span>
          </button>`;
      }).join('')}</div>` : '<p class="muted">V tem mesecu še ni vnosov.</p>'}
    </section>

    <div class="two-col">
      <section class="card">
        <h2>📍 Samodejno beleženje</h2>
        ${!signedIn ? '<p class="muted small">Za samodejno beleženje se najprej prijavi v <a href="#/nastavitve">Nastavitvah → Sinhronizacija</a>.</p>'
          : !token ? `<p class="muted small">Telefon lahko sam zabeleži prihod in odhod, ko vstopiš v območje službe ali ga zapustiš. Potrebuješ brezplačno aplikacijo <b>MacroDroid</b> (Android) in skrivni ključ.</p>
              <button class="btn primary" id="makeToken">Ustvari ključ</button>`
          : autoSetup(token)}
      </section>

      <section class="card">
        <h2>Obračun</h2>
        <form class="pay-form" id="payForm">
          <label class="field">Neto urna postavka (€)<input name="netRate" inputmode="decimal" value="${num(pay.netRate, 4)}"></label>
          <label class="field">PIZ (%)<input name="piz" inputmode="decimal" value="${num(pay.piz * 100, 3)}"></label>
          <label class="field">Akontacija dohodnine (%)<input name="tax" inputmode="decimal" value="${num(pay.tax * 100, 3)}"></label>
          <label class="field">Zaokroževanje časa
            <select name="rounding">${[1, 5, 10, 15].map(m => `<option value="${m}"${pay.rounding === m ? ' selected' : ''}>${m} min</option>`).join('')}</select>
          </label>
        </form>
        <p class="muted small">Bruto urna postavka: <b>${money(grossRate(pay))}</b>. Odmor je plačan in šteje v delovni čas.</p>
        <div class="button-row">
          <label class="btn">Uvozi iz Excela<input type="file" id="importXlsx" accept=".xlsx" hidden></label>
          <button class="btn" id="exportCsv"${sessions.length ? '' : ' disabled'}>Izvozi mesec (CSV)</button>
        </div>
      </section>
    </div>`;

  view.querySelector('#punch')?.addEventListener('click', e => punch(e.target.dataset.kind, pay));
  view.querySelector('#addDay').addEventListener('click', () => openWorkDialog(null, month === now ? today : `${month}-01`));
  view.querySelectorAll('.work-row').forEach(row => row.addEventListener('click', () => openWorkDialog(state.work.find(s => s.id === row.dataset.id))));

  view.querySelector('#payForm').addEventListener('change', e => {
    const f = e.currentTarget.elements;
    const parse = v => Number(String(v).replace(',', '.'));
    const next = { ...pay, netRate: parse(f.netRate.value), piz: parse(f.piz.value) / 100, tax: parse(f.tax.value) / 100, rounding: Number(f.rounding.value) };
    if (![next.netRate, next.piz, next.tax].every(Number.isFinite) || next.netRate <= 0 || next.piz + next.tax >= 1) return toast('Preveri vpisane vrednosti.');
    saveSetting(next);
  });

  view.querySelector('#importXlsx').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importWorkbook(file, pay);
  });
  view.querySelector('#exportCsv').addEventListener('click', () => download(`ure-${month}.csv`, monthCSV(state.work, month, pay), 'text/csv'));

  view.querySelector('#makeToken')?.addEventListener('click', makeToken);
  view.querySelector('#newToken')?.addEventListener('click', async () => {
    if (await ask('Ustvarim nov ključ? Stari bo prenehal delovati, zato ga bo treba zamenjati tudi v MacroDroidu.', { yes: 'Nov ključ' })) makeToken();
  });
  view.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast('Kopirano');
    } catch {
      toast('Kopiranje ni uspelo – označi besedilo in ga kopiraj ročno.');
    }
  }));
}

function autoSetup(token) {
  const url = cloud.workEventUrl();
  const key = cloud.publishableKey();
  const body = kind => JSON.stringify({ p_token: token, p_kind: kind });
  const copy = (label, value) => `
    <div class="copy-row"><span>${label}</span><code>${esc(value)}</code><button class="btn" data-copy="${esc(value)}">Kopiraj</button></div>`;
  return `
    <p class="muted small">Ključ je pripravljen. V aplikaciji <b>MacroDroid</b> na telefonu naredi dva makra, enega za prihod in enega za odhod. Ta zaslon odpri na telefonu, da lahko vrednosti kopiraš.</p>
    <ol class="steps">
      <li>Namesti <b>MacroDroid</b> iz Trgovine Play.</li>
      <li><b>Dodaj makro</b> → sprožilec <b>Location → Geofence</b> → na zemljevidu označi službo (polmer ~150 m) → <b>Area entered</b> (vstop).</li>
      <li>Dejanje <b>Connectivity → HTTP Request</b>: metoda <b>POST</b>, vrsta vsebine <b>application/json</b>, nato vpiši spodnje vrednosti.</li>
      <li>Makro shrani kot »Prihod v službo«. Drugi makro naredi enako, le s sprožilcem <b>Area exited</b> (izhod) in telesom za odhod.</li>
      <li>V nastavitvah Androida za MacroDroid dovoli lokacijo <b>Vedno</b> in baterijo <b>Brez omejitev</b>, sicer se lahko ne sproži.</li>
      <li>Preizkus: v makru tapni <b>Test actions</b>. Ko naslednjič odpreš aplikacijo, se prihod pokaže tukaj.</li>
    </ol>
    <div class="copy-list">
      ${copy('URL', url)}
      ${copy('Glava: apikey', key)}
      ${copy('Telo – prihod', body('in'))}
      ${copy('Telo – odhod', body('out'))}
    </div>
    <p class="muted small">Ključ je skrivnost – ne deli ga. Telefon pošlje samo »prihod/odhod«; lokacija ostane na telefonu.
      <button class="link-btn" id="newToken">Ustvari nov ključ</button></p>`;
}

async function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  try {
    await cloud.setWorkToken(hash);
  } catch (err) {
    toast(/work_tokens/.test(err.message) || err.status === 404
      ? 'V Supabase še ni tabele za ure – zaženi SQL iz navodil.'
      : `Ključa ni bilo mogoče shraniti: ${err.message}`);
    return;
  }
  await saveSetting({ id: 'workToken', token });
  toast('Ključ ustvarjen');
}

async function punch(kind, pay) {
  const today = todayISO();
  const time = roundTime(new Date(), pay.rounding);
  if (kind === 'in') {
    await saveWork([{ date: today, start: time, end: null, note: '', source: 'manual' }]);
    toast(`Prihod ob ${time}`);
  } else {
    const open = state.work.find(s => s.date === today && s.start && !s.end);
    if (!open) return;
    await saveWork([{ ...open, end: toMin(time) > toMin(open.start) ? time : open.start }]);
    toast(`Odhod ob ${time}`);
  }
}

async function importWorkbook(file, pay) {
  const buffer = await file.arrayBuffer();
  if (!isXlsx(new Uint8Array(buffer, 0, 2))) return toast('To ni Excel datoteka (.xlsx).');
  let parsed;
  try {
    parsed = parseWorkbook(await readXlsxSheets(buffer));
  } catch {
    return toast('Datoteke ni bilo mogoče prebrati.');
  }
  const key = s => `${s.date}|${s.start}`;
  const existing = new Set(state.work.map(key));
  const fresh = parsed.sessions.filter(s => !existing.has(key(s)));
  const months = [...new Set(fresh.map(s => monthLabel(s.date.slice(0, 7))))].join(', ');
  const payChanged = parsed.pay && (parsed.pay.netRate !== pay.netRate || parsed.pay.piz !== pay.piz || parsed.pay.tax !== pay.tax);
  if (!fresh.length && !payChanged) return toast('Vsi dnevi iz te datoteke so že vneseni.');
  const msg = `Uvozim ${fresh.length} ${fresh.length === 1 ? 'dan' : fresh.length === 2 ? 'dneva' : fresh.length < 5 ? 'dneve' : 'dni'}${months ? ` (${months})` : ''}`
    + (payChanged ? ` in nastavim obračun ${String(parsed.pay.netRate).replace('.', ',')} €/uro neto` : '') + '?';
  if (!(await ask(msg, { yes: 'Uvozi' }))) return;
  if (payChanged) await saveSetting({ ...pay, ...parsed.pay });
  if (fresh.length) await saveWork(fresh);
  toast('Uvoženo');
}

// ---------- Okno za urejanje dneva ----------

const dlg = document.getElementById('workDialog');
const form = document.getElementById('workForm');
let editing = null;

export function openWorkDialog(session, date = todayISO()) {
  editing = session;
  form.reset();
  document.getElementById('workTitle').textContent = session ? 'Uredi dan' : 'Dodaj dan';
  form.elements.date.value = session?.date ?? date;
  form.elements.start.value = session?.start ?? '';
  form.elements.end.value = session?.end ?? '';
  form.elements.note.value = session?.note === 'Manjka prihod' ? '' : session?.note ?? '';
  document.getElementById('workDelete').hidden = !session;
  dlg.showModal();
}

document.getElementById('workClose').addEventListener('click', () => dlg.close());
form.addEventListener('submit', async e => {
  e.preventDefault();
  const f = form.elements;
  if (!f.start.value && !f.end.value) {
    f.start.setCustomValidity('Vpiši vsaj prihod');
    f.start.reportValidity();
    return;
  }
  dlg.close();
  await saveWork([{ ...(editing ?? { source: 'manual' }), date: f.date.value || todayISO(), start: f.start.value, end: f.end.value || null, note: f.note.value.trim() }]);
  toast('Shranjeno');
});
form.elements.start.addEventListener('input', () => form.elements.start.setCustomValidity(''));
document.getElementById('workDelete').addEventListener('click', async () => {
  const s = editing;
  dlg.close();
  if (s && await ask(`Izbrišem vnos za ${dayName(s.date)}?`, { yes: 'Izbriši', danger: true })) {
    await deleteWork([s.id]);
    toast('Izbrisano');
  }
});

/** Neto zaslužek iz ur v mesecu (za pregled). */
export const workMonthNet = month => monthTotals(state.work, month, getSetting('pay', DEFAULT_PAY)).net;
