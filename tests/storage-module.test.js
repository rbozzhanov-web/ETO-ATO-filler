'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const OFPStorage = require('../storage.js');

test('storage module exposes only persistence responsibilities', () => {
  assert.equal(OFPStorage.LAST, 'etofill:last');
  for (const fn of ['digestOf', 'keepSession', 'dropSession', 'resumeRecord'])
    assert.equal(typeof OFPStorage[fn], 'function');
});

test('digestOf returns the SHA-256 identity used for PDF state isolation', async () => {
  const bytes = new TextEncoder().encode('same PDF bytes');
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(await OFPStorage.digestOf(bytes), expected);
});

test('cold-resume helpers degrade safely when IndexedDB is unavailable', async () => {
  const previous = global.indexedDB;
  try {
    delete global.indexedDB;
    await assert.doesNotReject(() => OFPStorage.keepSession('flight.pdf', 12, 'abc', new Uint8Array([1, 2])));
    await assert.doesNotReject(() => OFPStorage.dropSession());
    assert.equal(await OFPStorage.resumeRecord(), null);
  } finally {
    if (previous !== undefined) global.indexedDB = previous;
  }
});

// Just enough IndexedDB and localStorage for the resume path: one object store,
// put and get, with every request completing on the next tick.
function fakeDevice({ lsLimit = Infinity } = {}){
  const rows = new Map(), ls = new Map();
  let opens = 0;
  const later = fn => setTimeout(fn, 0);
  const store = () => ({
    put(val, key){ rows.set(key, val); },
    get(key){ const rq = {}; later(() => { rq.result = rows.get(key); rq.onsuccess && rq.onsuccess(); }); return rq; }
  });
  const writes = [];                     // the keys each read-write transaction put
  const db = {
    transaction(name, mode){
      const keys = [];
      if (mode === 'readwrite') writes.push(keys);
      const tx = { objectStore: () => { const st = store(); const put = st.put;
                   st.put = (val, key) => { keys.push(key); put(val, key); }; return st; } };
      later(() => tx.oncomplete && tx.oncomplete());
      return tx;
    },
    close(){}
  };
  return {
    indexedDB: { open(){ opens++; const rq = { result: db }; later(() => rq.onsuccess && rq.onsuccess()); return rq; },
                 writes, get opens(){ return opens; } },
    localStorage: {
      getItem: k => ls.has(k) ? ls.get(k) : null,
      // A device's quota, in characters: a value that would not fit is refused
      // the way Safari refuses it, with an exception and nothing written.
      setItem: (k, v) => {
        if (String(v).length > lsLimit) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
        ls.set(k, String(v));
      },
      removeItem: k => ls.delete(k)
    }
  };
}
async function withDevice(fn, opts){
  const saved = { indexedDB: global.indexedDB, localStorage: global.localStorage };
  Object.assign(global, fakeDevice(opts));
  try { await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete global[k]; else global[k] = v;
  }
}

/* The bug this guards: the last PDF reopened on every launch however old it
   was, so the next crew on a shared tablet could open straight onto a flight
   from days before, with its entries. */
test('the resume copy is reopened while fresh and dropped once stale', async () => {
  await withDevice(async () => {
    const buf = new Uint8Array([1, 2, 3]);
    await OFPStorage.keepSession('flight.pdf', 3, null, buf);
    const at = JSON.parse(localStorage.getItem(OFPStorage.LAST)).at;
    assert.ok(await OFPStorage.resumeRecord(at + 60000), 'reopened a minute later');
    assert.equal(await OFPStorage.resumeRecord(at + OFPStorage.RESUME_MAX_AGE + 1), null,
                 'not reopened a day later');
    assert.equal(localStorage.getItem(OFPStorage.LAST), null, 'and the stale copy is dropped');
  });
});

test('working the flight keeps its resume copy fresh', async () => {
  await withDevice(async () => {
    await OFPStorage.keepSession('flight.pdf', 3, null, new Uint8Array([1, 2, 3]));
    const meta = JSON.parse(localStorage.getItem(OFPStorage.LAST));
    meta.at -= OFPStorage.RESUME_MAX_AGE - 1000;           // loaded almost a day ago
    localStorage.setItem(OFPStorage.LAST, JSON.stringify(meta));
    OFPStorage.touchSession();                               // but saved just now
    assert.ok(await OFPStorage.resumeRecord());
  });
});

/* Reopening used to read the whole PDF back out of IndexedDB and hash it
   before anything reached the screen. The stored reading is enough for the
   screen; the bytes are fetched afterwards, and checked then. */
test('a reopened flight comes back from its stored reading without its PDF', async () => {
  await withDevice(async () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    const hash = await OFPStorage.digestOf(buf);
    assert.equal(await OFPStorage.keepSession('f.pdf', 4, hash, buf, { pairs: [1] }), true);
    const rec = await OFPStorage.resumeRecord();
    assert.deepEqual(rec.parsed, { pairs: [1] });
    assert.equal(rec.buf, null, 'the PDF itself is not read on the way back');
    assert.equal(rec.hash, hash);
    assert.deepEqual([...new Uint8Array(await OFPStorage.readPdf(hash))], [1, 2, 3, 4]);
  });
});

test('a stored PDF that does not match its flight is refused, not written from', async () => {
  await withDevice(async () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    await OFPStorage.keepSession('f.pdf', 4, 'not-its-digest', buf, { pairs: [1] });
    await assert.rejects(() => OFPStorage.readPdf('not-its-digest'), /does not match/);
  });
});

test('without a stored reading the PDF is read and checked as before', async () => {
  await withDevice(async () => {
    const buf = new Uint8Array([5, 6, 7]);
    const hash = await OFPStorage.digestOf(buf);
    await OFPStorage.keepSession('f.pdf', 3, hash, buf);           // no reading kept
    const rec = await OFPStorage.resumeRecord();
    assert.ok(rec.buf, 'the PDF comes back with the record');
    await OFPStorage.dropSession();
    assert.equal(await OFPStorage.resumeRecord(), null);
  });
});

/* The bug this guards: the PDF and what reading it produced went into IndexedDB
   in two transactions, one after the other. An app unloaded between them — iPadOS
   does that without warning — left one flight's reading beside another flight's
   PDF, and the flight then reopened with a stored copy that could not be saved
   from. They are written together now, in one transaction, or not at all. */
test('a flight is kept as one write: its PDF and its reading together', async () => {
  await withDevice(async () => {
    await OFPStorage.keepSession('f.pdf', 3, null, new Uint8Array([1, 2, 3]), { pairs: [] });
    assert.deepEqual(indexedDB.writes, [['last', 'lastParsed']]);
    await OFPStorage.dropSession();
    assert.deepEqual(indexedDB.writes[1], ['last', 'lastParsed'], 'and dropped together');
  });
});

/* The bug this guards: a flight reopened after iPadOS unloaded the app came
   back from IndexedDB, which answers only after the page has been drawn — so
   the first frame was a blank page, and the flight appeared over it a moment
   later. Its reading is kept in localStorage too now, and read from there the
   flight is back without waiting on anything: no IndexedDB request, nothing
   but promises already settled, all of it done before the page is drawn. */
test('a reopened flight is read back at once from its localStorage copy', async () => {
  await withDevice(async () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    const hash = await OFPStorage.digestOf(buf);
    await OFPStorage.keepSession('f.pdf', 4, hash, buf, { pairs: [1], build: 'B' });
    assert.ok(localStorage.getItem(OFPStorage.READING), 'the reading is kept in localStorage');
    const opened = indexedDB.opens;
    let rec = null;
    OFPStorage.resumeRecord().then(r => { rec = r; });
    for (let i = 0; i < 10; i++) await null;      // only already-settled promises have had a turn
    assert.ok(rec, 'back without waiting on a timer or IndexedDB');
    assert.equal(indexedDB.opens, opened, 'IndexedDB not even opened');
    assert.deepEqual(rec.parsed, { pairs: [1], build: 'B' });
    assert.equal(rec.buf, null);
    assert.equal(rec.hash, hash);
  });
});

test('a reading too big for localStorage is left to IndexedDB, which still brings the flight back', async () => {
  await withDevice(async () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    assert.equal(await OFPStorage.keepSession('f.pdf', 4, null, buf, { pairs: ['x'.repeat(500)] }), true);
    assert.equal(localStorage.getItem(OFPStorage.READING), null, 'nothing half written');
    const rec = await OFPStorage.resumeRecord();
    assert.deepEqual(rec.parsed, { pairs: ['x'.repeat(500)] }, 'from IndexedDB instead');
  }, { lsLimit: 300 });
});

test('a localStorage reading of another PDF is never used for this one', async () => {
  await withDevice(async () => {
    const a = new Uint8Array([1, 2, 3, 4]), b = new Uint8Array([9, 9, 9, 9]);
    const ha = await OFPStorage.digestOf(a), hb = await OFPStorage.digestOf(b);
    await OFPStorage.keepSession('f.pdf', 4, ha, a, { pairs: ['a'] });
    const stale = localStorage.getItem(OFPStorage.READING);
    await OFPStorage.keepSession('f.pdf', 4, hb, b, { pairs: ['b'] });
    localStorage.setItem(OFPStorage.READING, stale);        // the earlier flight's, same name and size
    const rec = await OFPStorage.resumeRecord();
    assert.deepEqual(rec.parsed, { pairs: ['b'] }, 'this PDF\u2019s own reading, from IndexedDB');
    await OFPStorage.dropSession();
    assert.equal(localStorage.getItem(OFPStorage.READING), null, 'and it goes with the flight');
  });
});
