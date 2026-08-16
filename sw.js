/* OFP Companion — offline cache. The whole app lives in index.html. */
const V = 'eto-filler-v22';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const NET_MS = 2500;            // give the network this long before falling back to the cache

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page itself comes from the network when there is one, so a new version is
// picked up on the next launch instead of waiting on a service-worker update
// check. Everything else stays cache-first — it only changes with the page.
// A slow link must not delay start-up, hence the race against NET_MS.
function freshPage(req){
  return new Promise(resolve => {
    let done = false;
    const fallback = () => { if (!done){ done = true; resolve(caches.match('./index.html')); } };
    const timer = setTimeout(fallback, NET_MS);
    fetch(req).then(r => {
      clearTimeout(timer);
      if (done) { caches.open(V).then(c => c.put('./index.html', r.clone())).catch(() => {}); return; }
      done = true;
      caches.open(V).then(c => c.put('./index.html', r.clone())).catch(() => {});
      resolve(r);
    }).catch(() => { clearTimeout(timer); fallback(); });
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate'){ e.respondWith(freshPage(e.request)); return; }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(V).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match('./index.html')))
  );
});
