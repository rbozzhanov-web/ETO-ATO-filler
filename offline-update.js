/* offline-update — shared by both pages: checks for a new service worker at
   load and every resume, applies a confirmed update automatically once it is
   safe to, and reloads once when the new worker actually takes over.

   Nothing here touches the network while offline: a check that cannot succeed
   still has to be waited out, which is the app hesitating at exactly the
   moment it is being used, and airborne there is nothing to check against
   anyway.

   Nor does an update ever land by itself while something is open on screen —
   a loaded OFP plan on one page, a loaded Journey Log on the other — since the
   reload costs nothing on an empty load screen but takes the screen away from
   whoever is working it. `hasOpen` reports which sense of "open" applies to
   the page calling this. Then the update is offered instead: a bar saying a
   new version is ready, with Update now, so it is never left waiting unseen.
   `offer` shows it (the bar below, unless a test passes its own).

   Takes its globals as an argument rather than reaching for `navigator`,
   `document` and `location` directly, so the whole thing can be driven by a
   test without a browser. */
function watchForUpdates(hasOpen, env, offer){
  const nav = env.navigator, doc = env.document, loc = env.location;
  offer = offer || (go => updateBar(doc, go));
  if (!('serviceWorker' in nav) || !loc.protocol.startsWith('http')) return null;
  let reloading = false, requested = false;
  const offline = () => nav.onLine === false;

  function applyUpdate(reg){
    const worker = reg.waiting;
    if (!worker || offline()) return;
    const go = () => { requested = true; worker.postMessage({ type: 'skip-waiting' }); };
    if (hasOpen()) offer(go); else go();
  }

  // Only the switch this page asked for, above — on the ground, with nothing
  // open, or on the crew's own Update now — is followed by a reload. A worker can also take over on its own: a
  // release downloaded on the ground and left waiting becomes active the next
  // time the app starts from cold, which in the air is every time iPadOS has
  // unloaded it, and it then claims the page that has just loaded. That page is
  // already working; reloading it would only redo the whole load in front of
  // the crew, with a flight open and no network. The new version is simply in
  // place from the next load on.
  nav.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !requested) return;
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

// The bar offering a waiting version over an open document. Everything typed
// is already saved as it is entered, and the reload brings the same document
// back, so the update costs a moment's reload and nothing else. Later puts the
// bar away until the app is next brought back to the front.
function updateBar(doc, go){
  if (!doc || !doc.createElement || !doc.body) return;
  let bar = doc.getElementById('updBar');
  if (!bar){
    bar = doc.createElement('div');
    bar.id = 'updBar';
    bar.className = 'updbar';
    bar.setAttribute('role', 'status');
    const txt = doc.createElement('span');
    txt.textContent = 'A new version is ready \u2014 nothing entered is lost.';
    const now = doc.createElement('button');
    now.type = 'button'; now.className = 'updnow'; now.textContent = 'Update now';
    const later = doc.createElement('button');
    later.type = 'button'; later.className = 'updlater'; later.textContent = 'Later';
    later.onclick = () => { bar.hidden = true; };
    bar.append(txt, now, later);
    doc.body.appendChild(bar);
  }
  const now = bar.querySelector('.updnow');
  now.disabled = false; now.textContent = 'Update now';
  now.onclick = () => { now.disabled = true; now.textContent = 'Updating\u2026'; go(); };
  bar.hidden = false;
}

// In the browser this is a classic script and watchForUpdates is simply a
// global. Under Node — the test runner — it is a CommonJS module instead.
if (typeof module !== 'undefined' && module.exports) module.exports = { watchForUpdates, updateBar };
