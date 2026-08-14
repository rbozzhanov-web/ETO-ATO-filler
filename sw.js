/* ETO Filler — offline cache. The whole app lives in index.html. */
const V = 'eto-filler-v6';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(V).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match('./index.html')))
  );
});
