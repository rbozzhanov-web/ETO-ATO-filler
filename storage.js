/* Device persistence for OFP Companion.
   No DOM and no flight arithmetic live here: only SHA-256 identity and the
   IndexedDB/localStorage resume copy that lets iPadOS restore an evicted tab. */
const OFPStorage = (() => {
  const LAST = 'etofill:last';
  // The resume copy is there to carry a flight across iPadOS evicting the app,
  // not to open a tablet's next crew onto an old flight. Once nothing has been
  // done with it for this long it is dropped rather than reopened.
  const RESUME_MAX_AGE = 24 * 3600 * 1000;

  async function digestOf(buf){
    try {
      if (typeof crypto === 'undefined' || !crypto.subtle) return null;
      const d = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch(e){ return null; }
  }

  function idb(){
    return new Promise((res, rej) => {
      const rq = indexedDB.open('etofill', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('pdf');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function idbSet(key, val){
    const db = await idb();
    try {
      await new Promise((res, rej) => {
        const tx = db.transaction('pdf', 'readwrite');
        tx.objectStore('pdf').put(val, key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } finally { db.close(); }
  }
  async function idbGet(key){
    const db = await idb();
    try {
      return await new Promise((res, rej) => {
        const rq = db.transaction('pdf', 'readonly').objectStore('pdf').get(key);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    } finally { db.close(); }
  }

  // Two records. 'last' is the PDF itself; 'lastParsed' is what reading it
  // produced — small, and all that is needed to put the flight back on
  // screen. Reopening the flight after iPadOS unloads the app, or on the way
  // back from the Journey Log, reads only the second; the PDF is fetched and
  // checked afterwards, off the path to the screen (readPdf).
  async function keepSession(name, size, hash, buf, parsed){
    if (typeof indexedDB === 'undefined') return false;
    try {
      await idbSet('last', { name, size, hash, buf });
      await idbSet('lastParsed', parsed ? { name, size, hash, parsed } : null);
      localStorage.setItem(LAST, JSON.stringify({ name, size, hash, at: Date.now() }));
      return true;
    } catch(e){ return false; /* quota/private mode: the live flight continues without cold resume */ }
  }
  async function dropSession(){
    try { localStorage.removeItem(LAST); } catch(e){}
    if (typeof indexedDB === 'undefined') return;
    try { await idbSet('last', null); await idbSet('lastParsed', null); } catch(e){}
  }
  // Called on every save: the age that matters is the time since the flight
  // was last worked, not since its PDF was first loaded.
  function touchSession(){
    try {
      const meta = JSON.parse(localStorage.getItem(LAST) || 'null');
      if (!meta) return;
      meta.at = Date.now();
      localStorage.setItem(LAST, JSON.stringify(meta));
    } catch(e){}
  }
  async function resumeRecord(now = Date.now()){
    if (typeof indexedDB === 'undefined') return null;
    let meta;
    try { meta = JSON.parse(localStorage.getItem(LAST) || 'null'); } catch(e){ return null; }
    if (!meta) return null;
    if (typeof meta.at !== 'number' || now - meta.at > RESUME_MAX_AGE){ await dropSession(); return null; }
    // The quick way back: the stored reading, when it is this very PDF's.
    // Its bytes are not touched here — readPdf fetches and checks them later.
    let quick = null;
    try { quick = await idbGet('lastParsed'); } catch(e){}
    if (quick && quick.parsed && quick.name === meta.name && quick.size === meta.size
        && (quick.hash || null) === (meta.hash || null))
      return { name: quick.name, size: quick.size, hash: quick.hash, parsed: quick.parsed, buf: null };

    let rec;
    try { rec = await idbGet('last'); } catch(e){ return null; }
    if (!rec || !rec.buf || rec.name !== meta.name || rec.size !== meta.size) return null;
    if (meta.hash || rec.hash){
      if (meta.hash && rec.hash && meta.hash !== rec.hash){ await dropSession(); return null; }
      const have = await digestOf(rec.buf);
      if (have && have !== (meta.hash || rec.hash)){ await dropSession(); return null; }
    }
    return rec;
  }
  // The stored PDF, checked against the digest its flight was saved under
  // before anything is written from it: a copy that does not match is never
  // paired with that flight's entries.
  async function readPdf(hash){
    const rec = await idbGet('last');
    if (!rec || !rec.buf) throw new Error('the stored copy of this PDF is missing');
    if (hash){
      const have = await digestOf(rec.buf);
      if (have && have !== hash) throw new Error('the stored copy of this PDF does not match');
    }
    return rec.buf;
  }
  return { LAST, RESUME_MAX_AGE, digestOf, keepSession, touchSession, dropSession, resumeRecord, readPdf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OFPStorage;
