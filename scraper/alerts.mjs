// Obvestila o akcijah za izdelke z zvoncem (Nakupi → Izdelki). Teče v dnevnem workflowu po pobiranju akcij.
// Zaženi: node scraper/alerts.mjs data/deals.json  (ali --test: preizkusno obvestilo vsem napravam)
// Okolje: PUSH_SECRET (ključ za push_jobs/push_done), VAPID_PRIVATE_KEY (d, base64url).
// Repozitorij je javen in dnevniki workflowa tudi: izpisuj samo števila, nikoli imen izdelkov ali naslovov.

import { readFile } from 'node:fs/promises';
import { productOffers, productSummary } from '../js/catalog.js';
import { enrichDeal } from '../js/products.js';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from '../js/config.js';
import { vapidKey, sendPush } from './webpush.mjs';

const STORE_NAMES = { tus: 'Tuš', lidl: 'Lidl', hofer: 'Hofer', mercator: 'Mercator', eurospin: 'Eurospin', spar: 'Spar' };
const eur = v => `${v.toFixed(2).replace('.', ',')} €`;
const fmtDay = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };

/**
 * Nove akcije za en izdelek z zvoncem.
 * product: { name, size, terms, variant, not, links, target? } (target = najvišja cena na kos oz. na referenčno velikost).
 * sent: { ključ imena v trgovini: cena } (že sporočeno). Ista akcija se sporoči znova samo, če je cena nižja.
 * Vrne { fresh: [ponudbe], best, ref, sent: nov zapis (samo akcije, ki še veljajo) }.
 */
export function newDeals(product, sent, deals, today) {
  const offers = productOffers(product, { deals }, today).filter(o => o.source === 'deal');
  const s = productSummary(product, offers, today);
  const rows = s.rows.filter(r => r.eq != null && (product.target == null || r.eq <= product.target + 0.005));
  const next = {};
  for (const r of rows) next[r.key] = Math.min(r.price, sent?.[r.key] ?? Infinity);
  const fresh = rows.filter(r => sent?.[r.key] == null || r.price < sent[r.key] - 0.005).sort((a, b) => a.eq - b.eq);
  return { fresh, ref: s.ref, sent: next };
}

const refLabel = (ref, size) => (size ? ` za ${size}` : ref ? ` za ${ref.qty === 1 ? '' : `${Math.round(ref.qty * 1000)} `}${ref.qty === 1 ? `1 ${ref.unit}` : ref.unit === 'kg' ? 'g' : 'ml'}` : '');

/** Vrstica obvestila: »Kinder Bueno 43 g: Mercator 0,93 € za 43 g (−20 %), do 22. 11.« */
export function alertLine(product, fresh, ref) {
  const r = fresh[0];
  const when = r.upcoming ? `od ${fmtDay(r.f)}` : r.to ? `do ${fmtDay(r.to)}` : '';
  const more = fresh.length > 1 ? ` (+${fresh.length - 1} drugje)` : '';
  return `${product.name}${product.size ? ` ${product.size}` : ''}: ${STORE_NAMES[r.s] ?? r.s} ${eur(r.eq)}${refLabel(ref, product.size)}${r.d ? ` (−${r.d} %)` : ''}${when ? `, ${when}` : ''}${r.plus ? ', s kartico' : ''}${more}`;
}

/** Sporočila po uporabnikih: Map user_id → { title, body, url }; in posodobitve za push_done. */
export function buildMessages(alerts, deals, today) {
  const byUser = new Map();
  const updates = [];
  for (const a of alerts) {
    const { fresh, ref, sent } = newDeals(a.product, a.sent ?? {}, deals, today);
    if (JSON.stringify(sent) !== JSON.stringify(a.sent ?? {})) updates.push({ user_id: a.user_id, product_id: a.product_id, sent });
    if (!fresh.length) continue;
    const list = byUser.get(a.user_id) ?? [];
    list.push({ id: a.product_id, line: alertLine(a.product, fresh, ref), name: a.product.name });
    byUser.set(a.user_id, list);
  }
  const messages = new Map();
  for (const [user, list] of byUser) {
    messages.set(user, {
      title: list.length === 1 ? `Akcija: ${list[0].name}` : `Nove akcije (${list.length} izdelki)`,
      body: list.map(x => x.line).join('\n'),
      path: list.length === 1 ? `#/izdelki?p=${encodeURIComponent(list[0].id)}` : '#/izdelki',
      tag: 'akcije',
    });
  }
  return { messages, updates };
}

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const [dealsFile] = process.argv.slice(2);
  const testOnly = dealsFile === '--test';
  const secret = process.env.PUSH_SECRET;
  const d = process.env.VAPID_PRIVATE_KEY;
  if (!secret || !d) { console.log('obvestila: ni ključev, preskočeno'); return; }
  const jobs = await rpc('push_jobs', { p_secret: secret });
  let messages, updates = [];
  if (testOnly) {
    messages = new Map((jobs.subs ?? []).map(s => [s.user_id, { title: 'Preizkus obvestil', body: 'Obvestila o akcijah delujejo.', path: '#/izdelki', tag: 'preizkus' }]));
  } else {
    const data = JSON.parse(await readFile(dealsFile, 'utf8'));
    const today = new Date(data.updatedAt ?? Date.now()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' });
    const deals = data.deals.map(x => (x.g || x.up ? x : enrichDeal(x)));
    ({ messages, updates } = buildMessages(jobs.alerts ?? [], deals, today));
  }
  const opts = { privateKey: vapidKey(d, VAPID_PUBLIC_KEY), publicRaw: VAPID_PUBLIC_KEY, subject: 'https://jakobboro-wq.github.io/stroski/' };
  const gone = [];
  let ok = 0, failed = 0;
  for (const sub of jobs.subs ?? []) {
    const m = messages.get(sub.user_id);
    if (!m) continue;
    const app = sub.app === 'nakupi' ? 'nakupi/' : '';
    try {
      const status = await sendPush(sub, { title: m.title, body: m.body, url: `${app}${m.path}`, tag: m.tag }, opts);
      if (status === 404 || status === 410) gone.push(sub.endpoint);
      else if (status >= 200 && status < 300) ok++;
      else failed++;
    } catch { failed++; }
  }
  // Sporočeno zapišemo tudi, ko uporabnik nima naprave: ob prijavi naprave ne dobi starih akcij.
  if (updates.length || gone.length) await rpc('push_done', { p_secret: secret, p_sent: updates, p_gone: gone });
  console.log(`obvestila: ${jobs.alerts?.length ?? 0} izdelkov, ${messages.size} uporabnikov z novimi akcijami, poslano ${ok}, napak ${failed}, odstranjenih naprav ${gone.length}`);
  if (failed) process.exitCode = 1;
}

if (/(^|[\\/])alerts\.mjs$/.test(process.argv[1] ?? '')) await main();
