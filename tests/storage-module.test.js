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
