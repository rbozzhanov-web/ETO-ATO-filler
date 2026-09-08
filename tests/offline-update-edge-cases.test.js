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

function workerHarness({ network = async () => { throw new Error('offline'); }, onLine } = {}){
  const handlers = new Map();
  let skipWaitingCalls = 0, claimCalls = 0, fetchCalls = 0;
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
  // Left off entirely unless a test asks for it, the way an older WorkerNavigator
  // that cannot answer the question would.
  if (onLine !== undefined) self.navigator = { onLine };
  const counted = (...a) => { fetchCalls++; return network(...a); };
  const ctx = { self, caches, fetch: counted, Response, URL, Promise, setTimeout, clearTimeout, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  return { handlers, caches, store,
           get skipWaitingCalls(){ return skipWaitingCalls; },
           get claimCalls(){ return claimCalls; },
           get fetchCalls(){ return fetchCalls; } };
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

test('a confirmed update applies itself, but never offline and never over a loaded plan', () => {
  // The bug this guards: in the air every launch and every resume spent itself
  // on an update check that could not succeed, and the reload it could lead to
  // took the screen away mid-flight.
  assert.match(APP, /const offline = \(\) => navigator\.onLine === false;/);
  assert.match(APP, /function applyUpdate\(reg\)\{[\s\S]*?if \(worker && !offline\(\) && !PLAN\) worker\.postMessage\(\{ type: 'skip-waiting' \}\);/);
  assert.match(APP, /const poll = \(\) => \{\s*if \(offline\(\)\) return;\s*reg\.update\(\)\.catch\(\(\) => \{\}\);\s*applyUpdate\(reg\);/);
  assert.match(APP, /navigator\.serviceWorker\.addEventListener\('controllerchange',[\s\S]*?if \(reloading\) return;[\s\S]*?location\.reload\(\);/);
  // The check runs on launch and again on every resume — both go through poll.
  assert.match(APP, /\n {4}poll\(\);\n {4}document\.addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden\) poll\(\); \}\);/);
});

test('the Journey Log page stands its worker down offline and over a loaded log too', () => {
  const JL = fs.readFileSync(path.join(ROOT, 'journey-log.js'), 'utf8');
  assert.match(JL, /const offline = \(\)=> navigator\.onLine === false;/);
  assert.match(JL, /if\(worker && !offline\(\) && !document\.body\.classList\.contains\('loaded'\)\)/);
  assert.match(JL, /const poll = \(\)=>\{\s*if\(offline\(\)\) return;/);
});

test('a cached page offline is served without a request being made at all', async () => {
  // Not merely "the request fails harmlessly": in the air it is started, queued
  // and waited out, once for the page and once for every script behind it.
  const w = workerHarness({ network: async () => new Response('net'), onLine: false });
  await fire(w.handlers, 'install');
  const before = w.fetchCalls;
  const r = await fire(w.handlers, 'fetch', { request: request('/index.html') });
  assert.match(await r.text(), /^cached /);
  assert.equal(w.fetchCalls, before, 'offline navigation still reached for the network');
});

test('offline with nothing cached still says so rather than hanging', async () => {
  const w = workerHarness({ network: async () => new Response('net'), onLine: false });
  const r = await fire(w.handlers, 'fetch', { request: request('/index.html') });
  assert.equal(r.status, 503);
});

test('with a network the page is still refreshed in the background as before', async () => {
  const w = workerHarness({ network: async () => new Response('fresh page'), onLine: true });
  await fire(w.handlers, 'install');
  await fire(w.handlers, 'fetch', { request: request('/index.html') });
  await new Promise(res => setTimeout(res, 0));
  assert.equal(await (await w.caches.match('./index.html')).text(), 'fresh page');
});
