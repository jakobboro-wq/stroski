// Web Push brez knjižnic (Node): podpis VAPID (RFC 8292) in šifriranje vsebine aes128gcm (RFC 8291).

import crypto from 'node:crypto';

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url');

/** Zasebni ključ VAPID iz d (base64url) in javnega ključa (65 bajtov, base64url). */
export function vapidKey(d, publicRaw) {
  const pub = unb64u(publicRaw);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}

/** Glava Authorization za strežnik obvestil (aud = izvor naslova naročnine). */
export function vapidAuth(endpoint, privateKey, publicRaw, subject, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicRaw}`;
}

const newEcdh = () => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return e; };
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/**
 * Šifrira vsebino za naročnino ({ p256dh, auth } v base64url). Vrne telo zahteve (en zapis aes128gcm).
 * salt in server (ECDH z ustvarjenimi ključi) sta lahko podana za teste.
 */
export function encrypt(payload, { p256dh, auth }, { salt = crypto.randomBytes(16), server = newEcdh() } = {}) {
  const uaPublic = unb64u(p256dh);
  const asPublic = server.getPublicKey();
  const secret = server.computeSecret(uaPublic);
  const ikm = hkdf(secret, unb64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head.writeUInt8(asPublic.length, 20);
  return Buffer.concat([head, asPublic, body]);
}

/** Pošlje obvestilo. Vrne status (201 = sprejeto, 404/410 = naročnina ne velja več). */
export async function sendPush(sub, payload, { privateKey, publicRaw, subject, ttl = 86400 }) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuth(sub.endpoint, privateKey, publicRaw, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal',
    },
    body: encrypt(JSON.stringify(payload), sub.keys),
  });
  return res.status;
}
