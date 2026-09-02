'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hourlyChecks, sinceDueAt } = require('../ofp-core.js');

const row = (i, wp, cum) => ({ i, wp, cum, sec: 1, t: 600 + cum });

test('short flight uses TOC fallback', () => {
  const c = hourlyChecks([row(0, 'DEP', 0), row(1, 'TOC', 24), row(2, 'DEST', 95)], 600);
  assert.equal(c.length, 1);
  assert.equal(c[0].label, 'TOC');
  assert.equal(c[0].wp.wp, 'TOC');
  assert.equal(c[0].due, 624);
});

test('skipped TOC does not invent a short-flight fallback', () => {
  assert.deepEqual(hourlyChecks([row(0, 'DEP', 0), row(2, 'DEST', 95)], 600), []);
});

test('hourly checks stop inside the final hour', () => {
  const make = total => {
    const a = [row(0, 'DEP', 0)];
    for (let m = 30, i = 1; m < total; m += 30, i++) a.push(row(i, 'W' + i, m));
    a.push(row(a.length, 'DEST', total));
    return a;
  };
  assert.deepEqual(hourlyChecks(make(120), 600).map(c => c.mark), [60]);
  assert.deepEqual(hourlyChecks(make(180), 600).map(c => c.mark), [60, 120]);
  assert.deepEqual(hourlyChecks(make(300), 600).map(c => c.mark), [60, 120, 180, 240]);
});

test('Direct-To remaps a check to a flown waypoint without moving its clock mark', () => {
  const full = [
    row(0, 'DEP', 0), row(1, 'W1', 25), row(2, 'W2', 50),
    row(3, 'W3', 70), row(4, 'W4', 95), row(5, 'DEST', 150)
  ];
  const before = hourlyChecks(full, 600);
  assert.equal(before[0].wp.wp, 'W3');

  const after = hourlyChecks(full.filter(p => ![2, 3].includes(p.i)), 600);
  assert.equal(after[0].mark, 60);
  assert.equal(after[0].due, before[0].due);
  assert.equal(after[0].wp.wp, 'W4');
});

test('due-state boundaries remain stable across midnight', () => {
  assert.equal(sinceDueAt(1439, 1440), -1);
  assert.equal(sinceDueAt(0, 1440), 0);
  assert.equal(sinceDueAt(5, 1440), 5);
  assert.equal(sinceDueAt(1430, 1440), -10);
});

test('app rebuilds altimeter checks from flown route after Direct-To', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /function afterDct\(\)[\s\S]*?renderAlt\(true\);[\s\S]*?renderFuel\(\);/);
  assert.match(app, /function renderAlt\(preserveAlerts = false\)[\s\S]*?CHECKS = hourlyChecks\(flown\(\), T0\);/);
  assert.match(app, /classList\.toggle\('hide', !CHECKS\.length\)/);
  assert.match(app, /if \(announced\)[\s\S]*?CHECKS\.some\(c => c\.mark === mark\)/);
});
