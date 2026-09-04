/* OFP Companion — offline cache. Two apps, one page each:
   index.html is the OFP companion, journey-log.html the Journey Log form. */
const CACHE_PREFIX = 'ofp-companion-';
const LEGACY_CACHE_PREFIX = 'eto-filler-v';
const V = CACHE_PREFIX + 'rc1.3.3-20260904';
const FILES = ['./', './index.html', './journey-log.html',
               './theme-init.js', './pdfmini.js', './ofp-core.js', './storage.js', './app.js',
               './jl-pdf.js', './journey-log.js',
               './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const PAGES = ['./index.html', './journey-log.html'];
// The pages carry no code of their own any more: it lives in these files. They
// go through the same cache-first, background-refreshed path as the pages
// themselves, below.
const SCRIPTS = ['./theme-init.js', './pdfmini.js', './ofp-core.js', './storage.js', './app.js',
                 './jl-pdf.js', './journey-log.js'];

self.addEventListener('install', e => {
  // A new worker waits until the crew explicitly accepts it in the app. That
  // makes an update visible without moving the open OFP under their hands.
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES)));
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => (k.startsWith(CACHE_PREFIX)
                                          || k.startsWith(LEGACY_CACHE_PREFIX)) && k !== V)
                                .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page and the scripts it loads are served from the cache instantly, every
// time — a crew reopening the app after iOS evicted it must never sit through a
// network attempt that has nowhere to go. A fresh copy is fetched in the
// background on the same request and quietly replaces what's cached, so the
// next launch picks up a new version without ever blocking this one on it.
// Which of the two pages a navigation is asking for. Anything else — the root
// included — is the OFP companion, as it always was.
function pageFor(req){
  const path = new URL(req.url).pathname;
  const hit = PAGES.find(p => path.endsWith(p.slice(1)));
  return hit || './index.html';
}

// The cache key for a script this worker owns, or null for anything else.
function scriptFor(req){
  if (new URL(req.url).origin !== self.location.origin) return null;
  const path = new URL(req.url).pathname;
  return SCRIPTS.find(p => path.endsWith(p.slice(1))) || null;
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

// Cache-first, refreshed in the background: a cached copy answers immediately
// with no network wait at all, while a real fetch — started the same moment,
// never blocking the response — quietly updates the cache for next time. Only
// when there is no cached copy yet (first install's own navigation) does the
// response actually wait on the network.
function staleWhileRevalidate(req, key){
  const revalidate = fetch(req).then(r => {
    if (cacheable(req, r)) caches.open(V).then(c => c.put(key, r.clone())).catch(() => {});
    return r;
  }).catch(() => null);
  return caches.match(key).then(cached => {
    if (cached){ revalidate.catch(() => {}); return cached; }
    return revalidate.then(r => r || offlineResponse());
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate'){ e.respondWith(staleWhileRevalidate(e.request, pageFor(e.request))); return; }
  const script = scriptFor(e.request);
  if (script){ e.respondWith(staleWhileRevalidate(e.request, script)); return; }
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