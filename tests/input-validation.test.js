"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validFuelEntry } = require('../ofp-core');
const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('only a positive one-to-five digit fuel figure can satisfy a fuel check', () => {
  for (const bad of ['', '0', '00000', '-1', '12A', '123456', null, undefined])
    assert.equal(validFuelEntry(bad), false, String(bad));
  for (const good of ['1', '00001', '2500', '12345'])
    assert.equal(validFuelEntry(good), true, good);
});

test('fuel-check state ignores invalid fuel instead of silently treating it as complete', () => {
  assert.match(APP, /const hasFuel = p => validFuelEntry/);
  assert.match(APP, /const f = validFuelEntry\(a\.fuel\) \? \+a\.fuel : null/);
});

test('invalid actuals are not written into the exported PDF', () => {
  assert.match(APP, /if \(parseTime\(a\.ato\) !== null\)/);
  assert.match(APP, /if \(validFuelEntry\(a\.fuel\)\)/);
});

test('inputs expose invalid state and non-blocking fuel-increase warnings', () => {
  assert.match(APP, /setAttribute\('aria-invalid'/);
  assert.match(APP, /Fuel is higher than the previous entered value — check the entry\./);
  assert.match(HTML, /td input\.suspect\{/);
});
