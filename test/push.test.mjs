// Testi obvestil: šifriranje Web Push (preverjeno z dešifriranjem kot brskalnik), podpis VAPID in izbor novih akcij.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encrypt, vapidAuth, vapidKey } from '../scraper/webpush.mjs';
import { newDeals, buildMessages } from '../scraper/alerts.mjs';
import { newProduct, offerKey } from '../js/catalog.js';

const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/** Dešifriranje na strani brskalnika (RFC 8291), samo za test. */
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const secret = ua.computeSecret(asPublic);
  const ikm = hkdf(secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const data = body.subarray(21 + idlen);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
  assert.equal(plain.at(-1), 2);
  return plain.subarray(0, -1).toString();
}

test('encrypt: brskalnik dešifrira vsebino', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const body = encrypt('{"title":"Akcija: čokolada"}', { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, ua, auth), '{"title":"Akcija: čokolada"}');
});

test('vapidAuth: veljaven podpis ES256 za izvor naslova', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  const key = vapidKey(privateKey.export({ format: 'jwk' }).d, raw);
  const h = vapidAuth('https://push.example.test/send/abc', key, raw, 'https://example.test/', 0);
  const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, raw);
  const [head, claims, sig] = t.split('.');
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).aud, 'https://push.example.test');
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

const today = '2026-11-18';
const deals = [
  { s: 'mercator', n: 'Čokolada Kinder Bueno, Kinder, 3/1', p: 2.79, up: 21.63, uu: 'kg', d: 20, to: '2026-11-22' },
  { s: 'tus', n: 'Vafelj Kinder Bueno, 3 x 43 g', p: 2.89, up: 22.4, uu: 'kg' },
  { s: 'tus', n: 'Vafelj Kinder Bueno, bel, 117 g', p: 2.89, up: 24.7, uu: 'kg' },
];

test('newDeals: samo nove ali cenejše akcije; ciljna cena', () => {
  const p = newProduct('kinder bueno 43 g', 'p1');
  const first = newDeals(p, {}, deals, today);
  assert.deepEqual(first.fresh.map(r => r.s), ['mercator', 'tus']);
  assert.equal(Object.keys(first.sent).length, 2);
  const again = newDeals(p, first.sent, deals, today);
  assert.equal(again.fresh.length, 0);
  const cheaper = newDeals(p, first.sent, deals.map(d => (d.s === 'tus' ? { ...d, p: 2.49, up: 19.3 } : d)), today);
  assert.deepEqual(cheaper.fresh.map(r => r.s), ['tus']);
  // Akcija se konča: izgine iz sent, zato bo naslednja spet sporočena.
  assert.deepEqual(Object.keys(newDeals(p, first.sent, deals.slice(1), today).sent), [offerKey('tus', 'Vafelj Kinder Bueno, 3 x 43 g')]);
  assert.deepEqual(newDeals({ ...p, target: 0.94 }, {}, deals, today).fresh.map(r => r.s), ['mercator']);
});

test('buildMessages: eno obvestilo na uporabnika', () => {
  const alerts = [
    { user_id: 'u1', product_id: 'p1', product: newProduct('kinder bueno 43 g', 'p1'), sent: {} },
    { user_id: 'u1', product_id: 'p2', product: { ...newProduct('kinder bueno', 'p2'), name: 'Bueno bel', variant: ['bel'] }, sent: {} },
    { user_id: 'u2', product_id: 'p3', product: newProduct('milka', 'p3'), sent: {} },
  ];
  const { messages, updates } = buildMessages(alerts, deals, today);
  assert.equal(messages.size, 1);
  const m = messages.get('u1');
  assert.equal(m.title, 'Nove akcije (2 izdelki)');
  assert.match(m.body, /^Kinder bueno 43 g: Mercator 0,93 € za 43 g \(−20 %\), do 22\. 11\. \(\+1 drugje\)/);
  assert.equal(updates.length, 2);
});
