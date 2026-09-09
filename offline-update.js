/* offline-update — shared by both pages: checks for a new service worker at
   load and every resume, applies a confirmed update automatically once it is
   safe to, and reloads once when the new worker actually takes over.

   Nothing here touches the network while offline: a check that cannot succeed
   still has to be waited out, which is the app hesitating at exactly the
   moment it is being used, and airborne there is nothing to check against
   anyway.

   Nor does an update ever land while something is open on screen — a loaded
   OFP plan on one page, a loaded Journey Log on the other — since the reload
   costs nothing on an empty load screen but takes the screen away from
   whoever is working it. `hasOpen` reports which sense of "open" applies to
   the page calling this.

   Takes its globals as an argument rather than reaching for `navigator`,
   `document` and `location` directly, so the whole thing can be driven by a
   test without a browser. */
function watchForUpdates(hasOpen, env){
  const nav = env.navigator, doc = env.document, loc = env.location;
  if (!('serviceWorker' in nav) || !loc.protocol.startsWith('http')) return null;
  let reloading = false;
  const offline = () => nav.onLine === false;

  function applyUpdate(reg){
    const worker = reg.waiting;
    if (worker && !offline() && !hasOpen()) worker.postMessage({ type: 'skip-waiting' });
  }

  nav.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    loc.reload();
  });

  return nav.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // The browser checks for a new sw.js on its own, but not more than once a
    // day. Ask now, and again whenever the app comes back from the
    // background, so a version published minutes ago is found this launch
    // rather than up to a day later — and pick up anything already waiting
    // from a previous one.
    const poll = () => {
      if (offline()) return;
      reg.update().catch(() => {});
      applyUpdate(reg);
    };
    reg.addEventListener('updatefound', () => {
      const candidate = reg.installing;
      if (!candidate) return;
      candidate.addEventListener('statechange', () => {
        if (candidate.state === 'installed' && nav.serviceWorker.controller) applyUpdate(reg);
      });
    });
    poll();
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) poll(); });
    return reg;
  }).catch(() => null);
}

// In the browser this is a classic script and watchForUpdates is simply a
// global. Under Node — the test runner — it is a CommonJS module instead.
if (typeof module !== 'undefined' && module.exports) module.exports = { watchForUpdates };
