'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ORIGIN = 'https://example.test';

function workerHarness({ network = async () => { throw new Error('offline'); } } = {}){
  const handlers = new Map();
  let skipWaitingCalls = 0, claimCalls = 0;
  const store = new Map();
  const keyOf = k => new URL(typeof k === 'string' ? k : k.url, ORIGIN + '/').href;
  const copy = r => r && r.clone();
  const cache = name => ({
    addAll: async keys => {
      const m = store.get(name);
      for (const k of keys) m.set(keyOf(k), new Response('cached ' + k));
    },
    put: async (k, v) => store.get(name).set(keyOf(k), v.clone()),
    match: async k => copy(store.get(name).get(keyOf(k))),
  });
  const caches = {
    open: async name => { if (!store.has(name)) store.set(name, new Map()); return cache(name); },
    keys: async () => [...store.keys()],
    delete: async name => store.delete(name),
    match: async (k, opts) => {
      const want = keyOf(k);
      for (const m of store.values()){
        if (m.has(want)) return copy(m.get(want));
        if (opts && opts.ignoreSearch)
          for (const [kk, value] of m) if (kk.split('?')[0] === want.split('?')[0]) return copy(value);
      }
      return undefined;
    },
  };
  const self = {
    addEventListener: (type, fn) => handlers.set(type, fn),
    location: { origin: ORIGIN },
    skipWaiting: () => { skipWaitingCalls++; },
    clients: { claim: async () => { claimCalls++; } },
  };
  const ctx = { self, caches, fetch: network, Response, URL, Promise, setTimeout, clearTimeout, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  return { handlers, caches, store,
           get skipWaitingCalls(){ return skipWaitingCalls; },
           get claimCalls(){ return claimCalls; } };
}

async function fire(h, type, event = {}){
  let waited = null, responded = null;
  const e = { ...event, waitUntil: p => { waited = p; }, respondWith: p => { responded = p; } };
  h.get(type)(e);
  if (waited) await waited;
  return responded ? await responded : null;
}

const request = (url, mode = 'navigate') => ({ url: ORIGIN + url, method: 'GET', mode });

test('a cold offline start fails explicitly instead of returning a fake successful page', async () => {
  const w = workerHarness();
  const r = await fire(w.handlers, 'fetch', { request: request('/index.html') });
  assert.equal(r.status, 503);
  assert.match(await r.text(), /offline.*not cached/i);
});

test('installing the new worker does not activate it behind an open flight', async () => {
  const w = workerHarness({ network: async () => new Response('net') });
  await fire(w.handlers, 'install');
  assert.equal(w.skipWaitingCalls, 0);
});

test('only an explicit skip-waiting message activates the waiting worker', async () => {
  const w = workerHarness();
  await fire(w.handlers, 'message', { data: { type: 'something-else' } });
  assert.equal(w.skipWaitingCalls, 0);
  await fire(w.handlers, 'message', { data: { type: 'skip-waiting' } });
  assert.equal(w.skipWaitingCalls, 1);
});

test('activation claims clients after old app caches are removed', async () => {
  const w = workerHarness({ network: async () => new Response('net') });
  await fire(w.handlers, 'install');
  w.store.set('ofp-companion-obsolete', new Map());
  await fire(w.handlers, 'activate');
  assert.equal(w.claimCalls, 1);
  assert.equal(w.store.has('ofp-companion-obsolete'), false);
});

test('a cached navigation answers instantly even when the network never resolves', async () => {
  let releaseNetwork;
  const hang = new Promise(res => { releaseNetwork = res; });
  const w = workerHarness({ network: async () => { await hang; return new Response('late'); } });
  await fire(w.handlers, 'install');
  const r = await fire(w.handlers, 'fetch', { request: request('/index.html') });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^cached /);
  releaseNetwork();
});

test('a background fetch quietly refreshes the cache for the next launch', async () => {
  const w = workerHarness({ network: async () => new Response('fresh page') });
  await fire(w.handlers, 'install');
  await fire(w.handlers, 'fetch', { request: request('/index.html') });
  // The response above came straight from the install-time cache; give the
  // background revalidation a turn of the event loop to land.
  await new Promise(res => setTimeout(res, 0));
  assert.equal(await (await w.caches.match('./index.html')).text(), 'fresh page');
});

test('page and scripts therefore cannot mix old and new app versions', () => {
  assert.match(SW, /const SCRIPTS = \['\.\/theme-init\.js', '\.\/pdfmini\.js', '\.\/ofp-core\.js', '\.\/storage\.js', '\.\/app\.js'/);
  assert.match(SW, /const script = scriptFor\(e\.request\);[\s\S]*?if \(script\)\{ e\.respondWith\(staleWhileRevalidate\(e\.request, script\)\); return; \}/);
});

test('the UI waits for user acceptance before telling the worker to update', () => {
  assert.match(APP, /btn\.textContent = 'Update now';/);
  assert.match(APP, /btn\.onclick = \(\) => \{[\s\S]*?worker\.postMessage\(\{ type: 'skip-waiting' \}\);/);
  assert.match(APP, /navigator\.serviceWorker\.addEventListener\('controllerchange',[\s\S]*?if \(reloading\) return;[\s\S]*?location\.reload\(\);/);
});
