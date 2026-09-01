'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeResult, directSkips, fuelChecks, fuelBox, hourlyChecks
} = require('../ofp-core.js');

const PLAN = [
  { i: 0, sec: 1, wp: 'DEP', cum: 0 },
  { i: 1, sec: 1, wp: 'TOC', cum: 20 },
  { i: 2, sec: 1, wp: 'WPT2', cum: 45 },
  { i: 3, sec: 1, wp: 'WPT3', cum: 70 },
  { i: 4, sec: 1, wp: 'WPT4', cum: 95 },
  { i: 5, sec: 1, wp: 'WPT5', cum: 120 },
  { i: 6, sec: 1, wp: 'WPT6', cum: 150 },
  { i: 7, sec: 1, wp: 'WPT7', cum: 180 },
  { i: 8, sec: 1, wp: 'DEST', cum: 220 }
];

const RESULT = computeResult(PLAN, 600, false).rows;
const skipSet = marks => new Set(marks.flatMap(m => m.skipped));
const flown = marks => {
  const skipped = skipSet(marks);
  return RESULT.filter(p => p.sec === 1 && !skipped.has(p.i));
};

function applyDirect(marks, currentIndex, targetIndex){
  const skipped = skipSet(marks);
  const mark = {
    to: RESULT[targetIndex].i,
    skipped: directSkips(RESULT, currentIndex, targetIndex, i => skipped.has(i))
  };
  return [...marks, mark];
}

test('direct to the next-but-one waypoint skips exactly one point', () => {
  const marks = applyDirect([], 1, 3); // after TOC, direct WPT3
  assert.deepEqual(marks[0], { to: 3, skipped: [2] });
  assert.deepEqual([...skipSet(marks)], [2]);
});

test('one direct can remove several consecutive waypoints', () => {
  const marks = applyDirect([], 1, 6); // after TOC, direct WPT6
  assert.deepEqual(marks[0].skipped, [2, 3, 4, 5]);
  assert.deepEqual(flown(marks).map(p => p.wp), ['DEP', 'TOC', 'WPT6', 'WPT7', 'DEST']);
});

test('repeated directs do not count an already skipped waypoint twice', () => {
  let marks = applyDirect([], 1, 4);   // skip WPT2, WPT3
  marks = applyDirect(marks, 1, 6);    // WPT2/WPT3 already skipped; only WPT4/WPT5 are new

  assert.deepEqual(marks[0].skipped, [2, 3]);
  assert.deepEqual(marks[1].skipped, [4, 5]);
  assert.deepEqual([...skipSet(marks)], [2, 3, 4, 5]);
});

test('undoing one direct restores only the waypoints owned by that mark', () => {
  let marks = applyDirect([], 1, 4);   // owns 2,3
  marks = applyDirect(marks, 1, 6);    // owns 4,5

  marks.splice(0, 1);                  // undo the first DIRECT
  assert.deepEqual([...skipSet(marks)], [4, 5]);
  assert.deepEqual(flown(marks).map(p => p.wp),
                   ['DEP', 'TOC', 'WPT2', 'WPT3', 'WPT6', 'WPT7', 'DEST']);
});

test('changing a direct by undoing and applying a nearer target leaves no stale skips', () => {
  let marks = applyDirect([], 1, 6);   // skip 2..5
  marks.splice(0, 1);                  // crew cancels it
  marks = applyDirect(marks, 1, 4);    // new clearance: direct WPT4

  assert.deepEqual([...skipSet(marks)], [2, 3]);
  assert.deepEqual(flown(marks).map(p => p.wp),
                   ['DEP', 'TOC', 'WPT4', 'WPT5', 'WPT6', 'WPT7', 'DEST']);
});

test('a direct to the immediate next waypoint creates no skipped rows', () => {
  const marks = applyDirect([], 3, 4);
  assert.deepEqual(marks[0].skipped, []);
  assert.equal(skipSet(marks).size, 0);
});

test('fuel windows after a direct never assign a check to a skipped waypoint', () => {
  const marks = applyDirect([], 1, 6); // WPT2..WPT5 are no longer overflown
  const route = flown(marks);
  const skipped = skipSet(marks);
  const noFuel = () => false;
  const atPlan = (p, off) => p.t + off;
  const checks = fuelChecks(route, 0, noFuel, atPlan);

  assert.ok(checks.length > 0);
  for (const c of checks){
    const box = fuelBox(route, c, 0);
    assert.ok(box.length > 0);
    assert.ok(box.every(p => !skipped.has(p.i)),
              `fuel window ${c.from}-${c.to} referenced a skipped waypoint`);
  }
});

test('altimeter mapping can be recomputed against the flown route after a direct', () => {
  // Without the direct, +1:00 maps to WPT3 (70 min). Direct WPT6 removes WPT3,
  // so the first flown waypoint at/after +1:00 is WPT6 instead. The hourly mark
  // itself remains +1:00; only the place where the crew records it moves.
  const normal = hourlyChecks(RESULT, 600);
  assert.equal(normal[0].label, '+1:00');
  assert.equal(normal[0].wp.wp, 'WPT3');

  const marks = applyDirect([], 1, 6);
  const afterDirect = hourlyChecks(flown(marks), 600);
  assert.equal(afterDirect[0].label, '+1:00');
  assert.equal(afterDirect[0].wp.wp, 'WPT6');
  assert.ok(!skipSet(marks).has(afterDirect[0].wp.i));
});

test('undoing the direct restores the original altimeter waypoint mapping', () => {
  let marks = applyDirect([], 1, 6);
  assert.equal(hourlyChecks(flown(marks), 600)[0].wp.wp, 'WPT6');

  marks = [];
  assert.equal(hourlyChecks(flown(marks), 600)[0].wp.wp, 'WPT3');
});
