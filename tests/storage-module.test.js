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
function fakeDevice(){
  const rows = new Map(), ls = new Map();
  const later = fn => setTimeout(fn, 0);
  const store = () => ({
    put(val, key){ rows.set(key, val); },
    get(key){ const rq = {}; later(() => { rq.result = rows.get(key); rq.onsuccess && rq.onsuccess(); }); return rq; }
  });
  const db = {
    transaction(){ const tx = { objectStore: store }; later(() => tx.oncomplete && tx.oncomplete()); return tx; },
    close(){}
  };
  return {
    indexedDB: { open(){ const rq = { result: db }; later(() => rq.onsuccess && rq.onsuccess()); return rq; } },
    localStorage: {
      getItem: k => ls.has(k) ? ls.get(k) : null,
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: k => ls.delete(k)
    }
  };
}
async function withDevice(fn){
  const saved = { indexedDB: global.indexedDB, localStorage: global.localStorage };
  Object.assign(global, fakeDevice());
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
