'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTime, fmt, norm, wrapMin, sinceDueAt, computeResult
} = require('../ofp-core.js');

/*
 * Time-boundary regression suite.
 *
 * These cases are deliberately kept separate from the general core tests: a
 * change to clock arithmetic must make the operational boundaries visible in
 * CI rather than being buried among unrelated route/storage assertions.
 */

test('23:59 takeoff crosses midnight without losing elapsed minutes', () => {
  const plan = [
    { i: 0, sec: 1, wp: 'DEP', cum: 0 },
    { i: 1, sec: 1, wp: 'ONE', cum: 1 },
    { i: 2, sec: 1, wp: 'HOUR', cum: 61 },
    { i: 3, sec: 1, wp: 'DEST', cum: 121 }
  ];
  const t0 = parseTime('2359');
  const { rows, arr } = computeResult(plan, t0, false);

  assert.deepEqual(rows.map(p => fmt(p.t)), ['2359', '0000', '0100', '0200']);
  assert.equal(arr, 23 * 60 + 59 + 121); // raw timeline stays monotonic past 1440
  assert.equal(norm(arr), 120);
});

test('a one-minute sector and a long sector both preserve exact duration', () => {
  const short = [
    { i: 0, sec: 1, wp: 'DEP', cum: 0 },
    { i: 1, sec: 1, wp: 'DEST', cum: 1 }
  ];
  const long = [
    { i: 0, sec: 1, wp: 'DEP', cum: 0 },
    { i: 1, sec: 1, wp: 'MID', cum: 390 },
    { i: 2, sec: 1, wp: 'DEST', cum: 780 }
  ];

  const a = computeResult(short, parseTime('2359'), false);
  assert.equal(a.arr - parseTime('2359'), 1);
  assert.equal(fmt(a.arr), '0000');

  const b = computeResult(long, parseTime('1800'), false);
  assert.equal(b.arr - parseTime('1800'), 780); // 13:00 en route
  assert.equal(fmt(b.arr), '0700');
});

test('early and late ATO deviations keep their sign across midnight', () => {
  // Planned 00:05, actually 23:55 on the previous side of midnight: ten early.
  assert.equal(sinceDueAt(parseTime('2355'), parseTime('0005')), -10);
  // Planned 23:55, actually 00:05 after midnight: ten late.
  assert.equal(sinceDueAt(parseTime('0005'), parseTime('2355')), 10);

  // Ordinary same-day early/late deviations remain unchanged by the same helper.
  assert.equal(sinceDueAt(parseTime('1150'), parseTime('1200')), -10);
  assert.equal(sinceDueAt(parseTime('1210'), parseTime('1200')), 10);
});

test('deviation wrapping is deterministic at the twelve-hour boundary', () => {
  assert.equal(wrapMin(719), 719);
  assert.equal(wrapMin(-719), -719);
  assert.equal(wrapMin(720), -720);
  assert.equal(wrapMin(-720), -720);
  assert.equal(wrapMin(721), -719);
  assert.equal(wrapMin(-721), 719);
});

test('invalid HHMM values are rejected instead of guessed', () => {
  const invalid = [
    '', '0', '1', '12', '123', '12345',
    '2400', '2401', '2460', '2360', '1260', '9999'
  ];
  for (const value of invalid)
    assert.equal(parseTime(value), null, `${JSON.stringify(value)} must be invalid`);
});

test('valid HHMM boundary values still parse exactly', () => {
  assert.equal(parseTime('0000'), 0);
  assert.equal(parseTime('00:00'), 0);
  assert.equal(parseTime('0001'), 1);
  assert.equal(parseTime('2358'), 1438);
  assert.equal(parseTime('2359'), 1439);
});
