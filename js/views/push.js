// Obvestila o akcijah na tej napravi (Web Push) in izdelki z zvoncem v oblaku.
// Pošilja jih dnevni workflow (scraper/alerts.mjs); tu se naprava samo prijavi.

import * as cloud from '../cloud.js';
import { VAPID_PUBLIC_KEY } from '../config.js';

const app = () => (location.pathname.includes('/nakupi/') ? 'nakupi' : 'stroski');
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Stanje naprave: 'on', 'off', 'denied', 'install' (iPhone: najprej na začetni zaslon), 'unsupported'. */
export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !standalone() ? 'install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const keyBytes = b64 => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), c => c.charCodeAt(0));

/** Vklopi obvestila (klic mora priti iz klika). Vrne novo stanje. */
export async function enablePush() {
  if (!cloud.currentUser()) throw new Error('Za obvestila se prijavi (nastavitve → Sinhronizacija).');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  await cloud.savePushSubscription(sub.toJSON(), app());
  return 'on';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  if (cloud.currentUser()) await cloud.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

/** Podatki izdelka, ki jih rabi workflow za prepoznavanje (brez cen, računov in drugih nastavitev). */
export const alertProduct = p => ({ name: p.name, size: p.size ?? '', terms: p.terms ?? [], variant: p.variant ?? [], not: p.not ?? [], links: p.links ?? {}, target: p.target ?? null });

/** Uskladi izdelek z oblakom: z zvoncem ga shrani, sicer odstrani. */
export async function syncAlert(p) {
  if (!cloud.currentUser()) return;
  if (p.alert) await cloud.saveDealAlert(p.id, alertProduct(p));
  else await cloud.deleteDealAlert(p.id);
}
