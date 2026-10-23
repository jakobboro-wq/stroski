// Sinhronizacija: prenesi šifrirano shrambo, odšifriraj, združi z lokalnimi podatki, zašifriraj in naloži.

import * as db from './db.js';
import * as cloud from './cloud.js';
import { deriveKey, newSalt, saltOf, encryptJSON, decryptJSON } from './crypto.js';
import { mergeData, signature } from './merge.js';
import { state, snapshot, applySnapshot, saveWork, getSetting } from './store.js';
import { applyEvents, DEFAULT_PAY } from './work.js';

// status: off | login | password | idle | syncing | error
export const sync = { status: 'off', lastSync: null, error: null, email: null };
let key = null;
let salt = null;
let running = false;
let again = false;
let timer = null;
let listening = false;

const emit = () => document.dispatchEvent(new CustomEvent('sync-status'));
function setStatus(status, error = null) {
  Object.assign(sync, { status, error, email: cloud.currentUser()?.email ?? null });
  emit();
}

const meta = async k => (await db.getAll('meta')).find(m => m.key === k)?.value ?? null;

export async function initSync() {
  if (!cloud.configured()) return setStatus('off');
  await cloud.loadSession();
  const stored = await meta('vaultKey');
  key = stored?.key ?? null;
  salt = stored?.salt ?? null;
  sync.lastSync = await meta('lastSync');
  if (!cloud.currentUser()) return setStatus('login');
  if (!key) return setStatus('password');
  setStatus('idle');

  if (!listening) {
    listening = true;
    document.addEventListener('local-change', () => schedule(2500));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
    window.addEventListener('online', () => schedule(0));
    setInterval(() => schedule(0), 5 * 60_000);
  }
  schedule(0);
}

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function syncNow() {
  if (!key || !cloud.currentUser()) return;
  if (running) { again = true; return; }
  running = true;
  setStatus('syncing');
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await cloud.getVault();
      const local = snapshot();
      const remoteData = remote ? await decryptJSON(remote.payload, key) : null;
      const merged = remoteData ? mergeData(local, remoteData) : local;
      if (signature(merged) !== signature(local)) await applySnapshot(merged);
      if (remoteData && signature(merged) === signature(remoteData)) break;

      const payload = await encryptJSON(merged, key, salt);
      const saved = remote ? await cloud.updateVault(remote.version, payload) : await cloud.createVault(payload);
      if (saved) break; // sicer je druga naprava ravno shranila — ponovi z novo verzijo
    }
    // Po prenosu (da so znani vsi dnevi z drugih naprav) prevzemi prihode/odhode s telefona;
    // sprememba sproži novo sinhronizacijo, ki jih naloži.
    await takeWorkEvents();
    sync.lastSync = Date.now();
    await db.put('meta', { key: 'lastSync', value: sync.lastSync });
    setStatus('idle');
  } catch (err) {
    if (err.name === 'NotSignedIn') setStatus('login', err.message);
    else if (err.name === 'WrongPassword') { await forgetKey(); setStatus('password', 'Geslo za šifriranje se ne ujema s podatki v oblaku. Vpiši ga znova.'); }
    else setStatus('error', err.name === 'Offline' ? 'Ni povezave – sinhroniziram, ko bo spet na voljo.' : err.message);
  } finally {
    running = false;
    if (again) { again = false; schedule(500); }
  }
}

/** Prihode/odhode, ki jih je zapisal telefon, pretvori v delovne dni in jih izbriše iz baze. */
async function takeWorkEvents() {
  const events = await cloud.getWorkEvents();
  if (!events.length) return;
  const pay = getSetting('pay', DEFAULT_PAY);
  const changedDays = applyEvents(state.work, events, pay.rounding);
  if (changedDays.length) await saveWork(changedDays);
  await cloud.deleteWorkEvents(events.map(e => e.id));
}

// ---------- Dejanja iz nastavitev ----------

export async function login(email, password, create = false) {
  await (create ? cloud.signUp(email, password) : cloud.signIn(email, password));
  await initSync();
}

/** Ali v oblaku že obstajajo podatki (potem geslo samo vpišeš, sicer ga izbereš). */
export async function hasRemoteVault() {
  return Boolean(await cloud.getVault());
}

export async function unlock(password) {
  const remote = await cloud.getVault();
  const s = remote ? saltOf(remote.payload) : newSalt();
  const k = await deriveKey(password, s);
  if (remote) await decryptJSON(remote.payload, k); // vrže WrongPassword
  key = k;
  salt = s;
  await db.put('meta', { key: 'vaultKey', value: { key, salt } });
  await initSync();
}

async function forgetKey() {
  key = null;
  salt = null;
  await db.removeMany('meta', ['vaultKey']);
}

export async function logout() {
  await forgetKey();
  await cloud.signOut();
  await db.removeMany('meta', ['lastSync']);
  sync.lastSync = null;
  setStatus('login');
}
