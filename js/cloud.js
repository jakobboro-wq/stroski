// Supabase: prijava (e-pošta + geslo) in branje/pisanje šifrirane shrambe. Brez zunanjih knjižnic.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import * as db from './db.js';

let session = null;

export const configured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);
export const currentUser = () => session?.user ?? null;

const fail = (message, extra = {}) => Object.assign(new Error(message), extra);

async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers };
  if (auth) h.Authorization = `Bearer ${await accessToken()}`;
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body && JSON.stringify(body) });
  } catch {
    throw fail('Ni povezave s strežnikom.', { name: 'Offline' });
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* odgovor ni JSON */ }
  if (!res.ok) {
    const message = json?.msg ?? json?.message ?? json?.error_description ?? `Napaka strežnika (${res.status})`;
    throw fail(message, { status: res.status, code: json?.error_code ?? json?.code });
  }
  return json;
}

// ---------- Prijava ----------

async function saveSession(s) {
  session = s && {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
    user: { id: s.user.id, email: s.user.email },
  };
  await (session ? db.put('meta', { key: 'session', value: session }) : db.removeMany('meta', ['session']));
}

export async function loadSession() {
  session = (await db.getAll('meta')).find(m => m.key === 'session')?.value ?? null;
  return session;
}

const AUTH_MESSAGES = {
  invalid_credentials: 'Napačen e-naslov ali geslo.',
  user_already_exists: 'Račun s tem e-naslovom že obstaja. Prijavi se.',
  signup_disabled: 'Ustvarjanje novih računov je izklopljeno.',
  weak_password: 'Geslo je prešibko (vsaj 8 znakov).',
  email_not_confirmed: 'E-naslov še ni potrjen.',
};
const authError = err => fail(AUTH_MESSAGES[err.code] ?? err.message, { code: err.code });

export async function signIn(email, password) {
  try {
    await saveSession(await request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } }));
  } catch (err) {
    throw authError(err);
  }
}

export async function signUp(email, password) {
  let res;
  try {
    res = await request('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password } });
  } catch (err) {
    throw authError(err);
  }
  if (!res?.access_token) throw fail('Račun je ustvarjen, a zahteva potrditev e-pošte. V Supabase izklopi »Confirm email« in se prijavi.');
  await saveSession(res);
}

export async function signOut() {
  try { await request('/auth/v1/logout', { method: 'POST' }); } catch { /* odjava lokalno vseeno uspe */ }
  await saveSession(null);
}

async function accessToken() {
  if (!session) throw fail('Nisi prijavljen.', { name: 'NotSignedIn' });
  if (session.expires_at * 1000 - 60_000 > Date.now()) return session.access_token;
  try {
    const refreshed = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } });
    await saveSession(refreshed);
    return session.access_token;
  } catch (err) {
    if (err.name === 'Offline') throw err;
    await saveSession(null);
    throw fail('Prijava je potekla. Prijavi se znova.', { name: 'NotSignedIn' });
  }
}

// ---------- Šifrirana shramba ----------

export async function getVault() {
  const rows = await request('/rest/v1/vault?select=version,payload,updated_at');
  return rows?.[0] ?? null;
}

/** Vrne true, če je zapis ustvarjen; false, če ga je medtem ustvarila druga naprava. */
export async function createVault(payload) {
  try {
    await request('/rest/v1/vault', { method: 'POST', body: { payload, version: 1 }, headers: { Prefer: 'return=minimal' } });
    return true;
  } catch (err) {
    if (err.status === 409) return false;
    throw err;
  }
}

/** Posodobi samo, če je verzija v oblaku še vedno `version`. Vrne false ob sočasni spremembi z druge naprave. */
export async function updateVault(version, payload) {
  const rows = await request(`/rest/v1/vault?user_id=eq.${session.user.id}&version=eq.${version}`, {
    method: 'PATCH',
    body: { payload, version: version + 1 },
    headers: { Prefer: 'return=representation' },
  });
  return rows.length > 0;
}
