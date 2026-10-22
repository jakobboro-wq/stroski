// Šifriranje z geslom na napravi: PBKDF2 (600.000 ponovitev) → AES-256-GCM.
// V oblak gre samo šifrirano besedilo; brez gesla ga ne more prebrati nihče.

const ITERATIONS = 600_000;
const enc = new TextEncoder();

const toB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

/** Ključ iz gesla. Ključ ni izvozljiv, zato ga je varno hraniti v IndexedDB na tej napravi. */
export async function deriveKey(password, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function gzip(bytes, mode) {
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Objekt → besedilo za oblak: {"v":1,"salt":…,"iv":…,"data":…} */
export async function encryptJSON(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await gzip(enc.encode(JSON.stringify(obj)), 'c');
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed));
  return JSON.stringify({ v: 1, salt, iv: toB64(iv), data: toB64(data) });
}

/** Vrne sol iz šifriranega besedila (potrebna za izpeljavo ključa na novi napravi). */
export const saltOf = payload => JSON.parse(payload).salt;

/** Vrže napako WrongPassword, če ključ ne ustreza. */
export async function decryptJSON(payload, key) {
  const { iv, data } = JSON.parse(payload);
  let packed;
  try {
    packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(data)));
  } catch {
    throw Object.assign(new Error('Napačno geslo za šifriranje.'), { name: 'WrongPassword' });
  }
  return JSON.parse(new TextDecoder().decode(await gzip(packed, 'd')));
}
