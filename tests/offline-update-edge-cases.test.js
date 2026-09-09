'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const { watchForUpdates } = require('../offline-update.js');
const ORIGIN = 'https://example.test';

/* A fake enough browser to drive watchForUpdates without one: a registration
   that fires the same two events the real one does (updatefound, and its own
   installing worker's statechange), a navigator whose serviceWorker fires
   controllerchange, and a document whose visibilitychange the periodic check
   rides on. Every call the code under test makes is counted, so a test reads
   as an assertion on behaviour rather than on this file's own source text. */
function fakeEnv({ onLine = true, protocol = 'https:', controller } = {}){
  const swHandlers = new Map(), docHandlers = new Map(), regHandlers = new Map();
  const installing = { state: 'installing', handlers: new Map(),
    addEventListener(type, fn){ this.handlers.set(type, fn); },
    fire(type){ const fn = this.handlers.get(type); if (fn) fn(); } };
  let updateCalls = 0;
  const reg = {
    waiting: null, installing: null,
    addEventListener(type, fn){ regHandlers.set(type, fn); },
    fire(type){ const fn = regHandlers.get(type); if (fn) fn(); },
    update: async () => { updateCalls++; },
  };
  let registerCalls = 0, reloadCalls = 0;
  const navigator = {
    onLine,
    serviceWorker: {
      controller,
      addEventListener(type, fn){ swHandlers.set(type, fn); },
      register: () => { registerCalls++; return Promise.resolve(reg); },
    },
  };
  const document = { hidden: false, addEventListener(type, fn){ docHandlers.set(type, fn); } };
  const location = { protocol, reload(){ reloadCalls++; } };
  return {
    navigator, document, location, reg, installing,
    startInstall(){ reg.installing = installing; reg.fire('updatefound'); },
    finishInstall(){ installing.state = 'installed'; installing.fire('statechange'); },
    fireControllerChange(){ swHandlers.get('controllerchange')(); },
    resume(){ document.hidden = false; docHandlers.get('visibilitychange')(); },
    get updateCalls(){ return updateCalls; },
    get registerCalls(){ return registerCalls; },
    get reloadCalls(){ return reloadCalls; },
  };
}
const waiting = () => { const calls = []; return { postMessage: m => calls.push(m), calls }; };

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
  assert.match(SW, /const SCRIPTS = \['\.\/theme-init\.js', '\.\/pdfmini\.js', '\.\/ofp-core\.js', '\.\/storage\.js',\s*\n\s*'\.\/offline-update\.js', '\.\/app\.js'/);
  assert.match(SW, /const script = scriptFor\(e\.request\);[\s\S]*?if \(script\)\{ e\.respondWith\(staleWhileRevalidate\(e\.request, script\)\); return; \}/);
});

/* watchForUpdates (offline-update.js) is what both app.js and journey-log.js
   call into now — one implementation, driven directly rather than matched
   against either page's own source text. The bug all of this guards: in the
   air every launch and every resume used to spend itself on an update check
   that could not succeed, and the reload it could lead to took the screen
   away mid-flight, or over a loaded plan or log on the ground. */
test('nothing happens without service-worker support or off the http(s) origin', () => {
  const noSwEnv = fakeEnv();
  assert.equal(watchForUpdates(() => false, { ...noSwEnv, navigator: {} }), null);
  assert.equal(noSwEnv.registerCalls, 0);

  const fileEnv = fakeEnv({ protocol: 'file:' });
  assert.equal(watchForUpdates(() => false, fileEnv), null);
  assert.equal(fileEnv.registerCalls, 0);
});

test('the check runs on launch and again on every resume, never offline', async () => {
  const env = fakeEnv({ onLine: true });
  await watchForUpdates(() => false, env);
  assert.equal(env.updateCalls, 1, 'launch did not check for an update');

  env.resume();
  assert.equal(env.updateCalls, 2, 'coming back from the background did not check again');

  const offlineEnv = fakeEnv({ onLine: false });
  await watchForUpdates(() => false, offlineEnv);
  offlineEnv.resume();
  assert.equal(offlineEnv.updateCalls, 0, 'an update was checked for while offline');
});

test('a confirmed update applies itself once online with nothing open', async () => {
  const env = fakeEnv({ onLine: true });
  await watchForUpdates(() => false, env);
  env.reg.waiting = waiting();
  env.resume();   // the next poll finds the now-waiting worker
  assert.deepEqual(env.reg.waiting.calls, [{ type: 'skip-waiting' }]);
});

test('a confirmed update never applies itself offline', async () => {
  const env = fakeEnv({ onLine: false });
  await watchForUpdates(() => false, env);
  env.reg.waiting = waiting();
  env.resume();
  assert.deepEqual(env.reg.waiting.calls, []);
});

test('a confirmed update never applies itself over an open plan or log', async () => {
  const env = fakeEnv({ onLine: true });
  await watchForUpdates(() => true, env);   // something is open
  env.reg.waiting = waiting();
  env.resume();
  assert.deepEqual(env.reg.waiting.calls, [], 'an update applied itself over an open document');
});

test('installing a new worker behind an open document applies nothing until it is checked again', async () => {
  const env = fakeEnv({ onLine: true, controller: {} });
  let open = true;
  await watchForUpdates(() => open, env);
  env.startInstall();
  env.reg.waiting = waiting();
  env.finishInstall();   // the browser's own updatefound -> installed path
  assert.deepEqual(env.reg.waiting.calls, [], 'applied itself while the document was still open');

  open = false;
  env.resume();
  assert.deepEqual(env.reg.waiting.calls, [{ type: 'skip-waiting' }]);
});

test('a fresh install with no controller yet is not treated as an update', async () => {
  // The very first install of the worker has nothing to reload away from —
  // there is no previous page a controllerchange would be replacing.
  const env = fakeEnv({ onLine: true, controller: undefined });
  await watchForUpdates(() => false, env);
  env.startInstall();
  env.reg.waiting = waiting();
  env.finishInstall();
  assert.deepEqual(env.reg.waiting.calls, []);
});

test('the page reloads exactly once when the new worker takes over, however often it fires', () => {
  const env = fakeEnv();
  watchForUpdates(() => false, env);
  env.fireControllerChange();
  env.fireControllerChange();
  env.fireControllerChange();
  assert.equal(env.reloadCalls, 1);
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
