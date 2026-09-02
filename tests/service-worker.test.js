'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://example.test';

/* A service worker is the part of an offline app nobody exercises by hand: it
   only shows itself on a cold start with no network, which is exactly the
   situation a crew is in. So it is run here against a stub of the Cache Storage
   and fetch it would see in a browser. */
function loadWorker({ network }){
  const store = new Map();                      // cache name -> Map(absolute url -> Response)
  // Cache Storage keys on the resolved request URL, not on the relative string
  // the worker happens to hand it, and hands back a fresh Response every time.
  const keyOf = k => new URL(typeof k === 'string' ? k : k.url, ORIGIN + '/').href;
  const copy = r => r && r.clone();
  const cacheApi = name => ({
    addAll: async keys => {
      for (const k of keys) store.get(name).set(keyOf(k), new Response('cached ' + k));
    },
    put: async (k, v) => { store.get(name).set(keyOf(k), v); },
    match: async k => copy(store.get(name).get(keyOf(k)))
  });
  const caches = {
    open: async name => { if (!store.has(name)) store.set(name, new Map()); return cacheApi(name); },
    keys: async () => [...store.keys()],
    delete: async name => store.delete(name),
    match: async (k, o) => {
      const want = keyOf(k);
      for (const m of store.values()){
        if (m.has(want)) return copy(m.get(want));
        if (o && o.ignoreSearch)
          for (const [kk, v] of m) if (kk.split('?')[0] === want.split('?')[0]) return copy(v);
      }
      return undefined;
    }
  };

  const handlers = new Map();
  const self = {
    addEventListener: (t, fn) => handlers.set(t, fn),
    location: { origin: ORIGIN },
    clients: { claim: async () => {} },
    skipWaiting: () => {}
  };
  const ctx = { self, caches, fetch: network, Response, URL, Promise,
                setTimeout, clearTimeout, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx);
  return { handlers, store, caches };
}

// Drive one lifecycle or fetch event and hand back what the worker answered.
async function fire(handlers, type, event){
  let waited = null, responded = null;
  const e = { ...event, waitUntil: p => { waited = p; }, respondWith: p => { responded = p; } };
  handlers.get(type)(e);
  if (waited) await waited;
  return responded ? await responded : null;
}

const req = (url, mode) => ({ url: ORIGIN + url, method: 'GET', mode: mode || 'no-cors' });
const ok = body => new Response(body, { status: 200 });

test('install precaches every file the two apps are made of', async () => {
  const w = loadWorker({ network: async () => ok('net') });
  await fire(w.handlers, 'install', {});
  for (const f of ['./', './index.html', './journey-log.html', './theme-init.js', './pdfmini.js',
                   './ofp-core.js', './app.js', './jl-pdf.js', './journey-log.js',
                   './manifest.webmanifest', './icon-192.png', './icon-512.png'])
    assert.ok(await w.caches.match(f), f + ' is not precached');
});

test('a page comes from the network when there is one, and is cached', async () => {
  const w = loadWorker({ network: async () => ok('fresh page') });
  await fire(w.handlers, 'install', {});
  const r = await fire(w.handlers, 'fetch', { request: req('/journey-log.html', 'navigate') });
  assert.equal(await r.text(), 'fresh page');
  assert.equal(await (await w.caches.match('./journey-log.html')).text(), 'fresh page');
});

test('a page falls back to the cache when the network is gone', async () => {
  const w = loadWorker({ network: async () => { throw new Error('offline'); } });
  await fire(w.handlers, 'install', {});
  const r = await fire(w.handlers, 'fetch', { request: req('/index.html', 'navigate') });
  assert.equal(await r.text(), 'cached ./index.html');
});

/* The bug this guards: the pages carry no code of their own any more. If a page
   were fetched fresh while its scripts still came cache-first, an updated page
   would run against the previous version's app.js. */
test('the scripts a page loads are fetched the same way the page is', async () => {
  const w = loadWorker({ network: async () => ok('fresh app.js') });
  await fire(w.handlers, 'install', {});
  const r = await fire(w.handlers, 'fetch', { request: req('/app.js') });
  assert.equal(await r.text(), 'fresh app.js');
  assert.equal(await (await w.caches.match('./app.js')).text(), 'fresh app.js');
});

test('a script falls back to the cache offline', async () => {
  const w = loadWorker({ network: async () => { throw new Error('offline'); } });
  await fire(w.handlers, 'install', {});
  const r = await fire(w.handlers, 'fetch', { request: req('/ofp-core.js') });
  assert.equal(await r.text(), 'cached ./ofp-core.js');
});

test('an icon stays cache-first — it only changes with the app', async () => {
  const w = loadWorker({ network: async () => ok('from network') });
  await fire(w.handlers, 'install', {});
  const r = await fire(w.handlers, 'fetch', { request: req('/icon-192.png') });
  assert.equal(await r.text(), 'cached ./icon-192.png');
});

test('an error page is never cached under the real URL', async () => {
  const w = loadWorker({ network: async () => new Response('gone', { status: 404 }) });
  await fire(w.handlers, 'install', {});
  const r = await fire(w.handlers, 'fetch', { request: req('/index.html', 'navigate') });
  assert.equal(await r.text(), 'cached ./index.html');    // the cached page, not the 404
  assert.equal(await (await w.caches.match('./index.html')).text(), 'cached ./index.html');
});

test('a POST is left alone', async () => {
  const w = loadWorker({ network: async () => ok('net') });
  await fire(w.handlers, 'install', {});
  const r = await fire(w.handlers, 'fetch', { request: { ...req('/index.html'), method: 'POST' } });
  assert.equal(r, null);
});

test('activate clears out every older cache and keeps this one', async () => {
  const w = loadWorker({ network: async () => ok('net') });
  await fire(w.handlers, 'install', {});
  const current = [...w.store.keys()][0];
  w.store.set('ofp-companion-rc0.0.1', new Map());
  w.store.set('eto-filler-v9', new Map());
  w.store.set('someone-elses-cache', new Map());
  await fire(w.handlers, 'activate', {});
  assert.deepEqual([...w.store.keys()].sort(), [current, 'someone-elses-cache'].sort());
});
