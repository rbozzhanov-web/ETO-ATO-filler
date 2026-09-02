/* Device persistence for OFP Companion.
   No DOM and no flight arithmetic live here: only SHA-256 identity and the
   IndexedDB/localStorage resume copy that lets iPadOS restore an evicted tab. */
const OFPStorage = (() => {
  const LAST = 'etofill:last';

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

  async function keepSession(name, size, hash, buf){
    if (typeof indexedDB === 'undefined') return;
    try {
      await idbSet('last', { name, size, hash, buf });
      localStorage.setItem(LAST, JSON.stringify({ name, size, hash, at: Date.now() }));
    } catch(e){ /* quota/private mode: the live flight continues without cold resume */ }
  }
  async function dropSession(){
    try { localStorage.removeItem(LAST); } catch(e){}
    if (typeof indexedDB === 'undefined') return;
    try { await idbSet('last', null); } catch(e){}
  }
  async function resumeRecord(){
    if (typeof indexedDB === 'undefined') return null;
    let meta;
    try { meta = JSON.parse(localStorage.getItem(LAST) || 'null'); } catch(e){ return null; }
    if (!meta) return null;
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
  return { LAST, digestOf, keepSession, dropSession, resumeRecord };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OFPStorage;
