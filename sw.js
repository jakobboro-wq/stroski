// Service worker: aplikacija deluje tudi brez povezave.
// Najprej poskusi omrežje (da dobiš novo verzijo), ob izpadu uporabi shranjeno kopijo.

const CACHE = 'stroski-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/store.js', 'js/db.js', 'js/categorize.js', 'js/csv.js', 'js/xlsx.js', 'js/stats.js',
  'js/charts.js', 'js/ui.js', 'js/dialog.js', 'js/demo.js',
  'js/config.js', 'js/crypto.js', 'js/cloud.js', 'js/merge.js', 'js/sync.js',
  'js/views/overview.js', 'js/views/transactions.js', 'js/views/import.js', 'js/views/settings.js', 'js/views/sync-card.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then(r => r ?? caches.match('index.html'))),
  );
});
