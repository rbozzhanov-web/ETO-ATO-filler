'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planKeyFor, planKeysIn, prunePlans } = require('../ofp-core.js');

class FakeStore {
  constructor(entries = {}, { failSet = false, failRemove = false } = {}){
    this.map = new Map(Object.entries(entries));
    this.failSet = failSet;
    this.failRemove = failRemove;
  }
  get length(){ return this.map.size; }
  key(i){ return [...this.map.keys()][i]; }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){
    if (this.failSet) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k){
    if (this.failRemove) throw new Error('storage unavailable');
    this.map.delete(k);
  }
}

const state = savedAt => JSON.stringify({ savedAt, act: {}, dct: [] });

test('the same PDF bytes share one state key even when renamed', () => {
  const hash = 'a'.repeat(64);
  assert.equal(planKeyFor(hash, 'OFP-ALA-FRA.pdf', 400000),
               planKeyFor(hash, 'renamed.pdf', 999999));
});

test('changed PDF bytes never inherit state from the old file with the same name and size', () => {
  const a = planKeyFor('a'.repeat(64), 'OFP.pdf', 524288);
  const b = planKeyFor('b'.repeat(64), 'OFP.pdf', 524288);
  assert.notEqual(a, b);
});

test('the 30-day retention boundary is inclusive and older data is removed', () => {
  const now = 2_000_000_000_000, day = 86400000;
  const store = new FakeStore({
    'etofill:plan:boundary': state(now - 30 * day),
    'etofill:plan:old': state(now - 30 * day - 1),
  });
  assert.deepEqual(prunePlans(store, now, 30, 20), ['etofill:plan:old']);
  assert.ok(store.getItem('etofill:plan:boundary'));
});

test('exactly the 20 most-recent flights survive the cap', () => {
  const now = 2_000_000_000_000;
  const entries = {};
  for (let i = 0; i < 21; i++) entries[`etofill:plan:${String(i).padStart(2, '0')}`] = state(now - i * 1000);
  const store = new FakeStore(entries);
  const dropped = prunePlans(store, now, 30, 20);
  assert.deepEqual(dropped, ['etofill:plan:20']);
  assert.equal(planKeysIn(store).length, 20);
  assert.ok(store.getItem('etofill:plan:00'));
});

test('device-wide settings survive retention and capacity pruning', () => {
  const now = 2_000_000_000_000, day = 86400000;
  const store = new FakeStore({
    'etofill:theme': 'light',
    'etofill:wxhi': '1',
    'etofill:last': '{"resume":true}',
    'etofill:plan:stale': state(now - 31 * day),
  });
  prunePlans(store, now, 30, 20);
  assert.equal(store.getItem('etofill:theme'), 'light');
  assert.equal(store.getItem('etofill:wxhi'), '1');
  assert.equal(store.getItem('etofill:last'), '{"resume":true}');
});

test('quota failure while stamping a legacy entry does not crash pruning', () => {
  const now = 2_000_000_000_000;
  const store = new FakeStore({ 'etofill:plan:legacy': JSON.stringify({ act: {} }) }, { failSet: true });
  assert.doesNotThrow(() => prunePlans(store, now, 30, 20));
  assert.ok(store.getItem('etofill:plan:legacy'));
});

test('remove failure is contained rather than crashing the app', () => {
  const now = 2_000_000_000_000, day = 86400000;
  const store = new FakeStore({ 'etofill:plan:stale': state(now - 31 * day) }, { failRemove: true });
  assert.doesNotThrow(() => prunePlans(store, now, 30, 20));
});

test('autosave delegates cold-session persistence to the isolated storage module', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const storage = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(app, /const digestOf = OFPStorage\.digestOf;/);
  assert.match(app, /OFPStorage\.keepSession\(name, size, HASH, buf\)/);
  assert.match(app, /OFPStorage\.resumeRecord\(\)/);
  assert.match(storage, /catch\(e\)\{ \/\* quota\/private mode:/);
  assert.match(storage, /if \(meta\.hash && rec\.hash && meta\.hash !== rec\.hash\)/);
  assert.match(html, /ofp-core\.js[\s\S]*storage\.js[\s\S]*app\.js/);
  assert.match(sw, /ofp-core\.js', '\.\/storage\.js', '\.\/app\.js/);
});
