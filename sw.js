/* OFP Companion — offline cache. Two apps, one page each:
   index.html is the OFP companion, journey-log.html the Journey Log form. */
const CACHE_PREFIX = 'ofp-companion-';
const LEGACY_CACHE_PREFIX = 'eto-filler-v';
const V = CACHE_PREFIX + 'v51.3';
const FILES = ['./', './index.html', './journey-log.html',
               './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const PAGES = ['./index.html', './journey-log.html'];
const NET_MS = 2500;            // give the network this long before falling back to the cache

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => (k.startsWith(CACHE_PREFIX)
                                          || k.startsWith(LEGACY_CACHE_PREFIX)) && k !== V)
                                .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page itself comes from the network when there is one, so a new version is
// picked up on the next launch instead of waiting on a service-worker update
// check. Everything else stays cache-first — it only changes with the page.
// A slow link must not delay start-up, hence the race against NET_MS.
// Which of the two pages a navigation is asking for. Anything else — the root
// included — is the OFP companion, as it always was.
function pageFor(req){
  const path = new URL(req.url).pathname;
  const hit = PAGES.find(p => path.endsWith(p.slice(1)));
  return hit || './index.html';
}

function offlineResponse(){
  return new Response('OFP Companion is offline and this page is not cached yet.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// Only cache what's actually safe to replay later: a same-origin, successful
// response. An opaque cross-origin response or an error page cached under the
// real URL would otherwise be served back as if it had worked.
function cacheable(req, response){
  return response.ok
    && (response.type === 'basic' || response.type === 'default')
    && new URL(req.url).origin === self.location.origin;
}

function freshPage(req){
  const key = pageFor(req);
  return new Promise(resolve => {
    let done = false;
    const fallback = async () => {
      if (done) return;
      done = true;
      resolve(await caches.match(key) || offlineResponse());
    };
    const timer = setTimeout(fallback, NET_MS);
    fetch(req).then(r => {
      clearTimeout(timer);
      if (!cacheable(req, r)){ fallback(); return; }
      caches.open(V).then(c => c.put(key, r.clone())).catch(() => {});
      if (done) return;
      done = true;
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
        if (cacheable(e.request, r)){
          const copy = r.clone();
          caches.open(V).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => Response.error()))
  );
});
