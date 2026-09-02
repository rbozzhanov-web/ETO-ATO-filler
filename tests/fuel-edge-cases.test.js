'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fuelBox, fuelChecks } = require('../ofp-core.js');

// fuelChecks works on route-relative minutes (cum) while atTime returns the
// clock time shown to the crew. Keep those two axes visibly separate here so a
// future refactor cannot accidentally make an ATO offset move only one of them.
const route = (...cums) => cums.map((cum, i) => ({ i, sec: 1, wp: `W${i}`, cum, t: 600 + cum }));
const atPlan = (p, off) => p.t + off;
const none = () => false;

/* ---------------------------------------------------------------- on time */
test('a fuel entry exactly on a 30-minute boundary starts the next window there', () => {
  const flown = route(0, 20, 30, 50, 80, 110, 145);
  const hasFuel = p => p.cum === 30;
  const checks = fuelChecks(flown, 0, hasFuel, atPlan);

  assert.deepEqual(checks.slice(0, 3).map(c => [c.from, c.to]),
                   [[0, 30], [30, 60], [60, 90]]);
  assert.equal(checks[0].due, 630);
});

/* ------------------------------------------------------------------- early */
test('an early fuel entry restarts the 30-minute clock from the actual entry point', () => {
  const flown = route(0, 20, 50, 80, 110, 145);
  const hasFuel = p => p.cum === 20;
  const checks = fuelChecks(flown, 0, hasFuel, atPlan);

  assert.deepEqual(checks.slice(0, 3).map(c => [c.from, c.to]),
                   [[0, 30], [20, 50], [50, 80]]);
});

test('repeated early fuel entries keep restarting the clock without duplicating a window', () => {
  const flown = route(0, 12, 25, 35, 58, 90, 125);
  const hasFuel = p => p.cum === 12 || p.cum === 35;
  const checks = fuelChecks(flown, 0, hasFuel, atPlan);

  assert.deepEqual(checks.slice(0, 4).map(c => [c.from, c.to]),
                   [[0, 30], [12, 42], [35, 65], [65, 95]]);
  assert.ok(checks.every((c, i) => i === 0 || c.from > checks[i - 1].from));
});

/* -------------------------------------------------------------------- late */
test('a late fuel entry on the next available waypoint restarts subsequent checks from there', () => {
  const flown = route(0, 20, 65, 95, 130);
  const hasFuel = p => p.cum === 65;
  const checks = fuelChecks(flown, 0, hasFuel, atPlan);

  // The first window has W1 inside it and therefore remains a normal 0-30 check.
  // The 30-60 window is empty; its check is written at W2 (65), where the fuel
  // figure is finally entered, and the next half hour starts from that point.
  assert.deepEqual(checks.slice(0, 3).map(c => [c.from, c.to]),
                   [[0, 30], [30, 60], [65, 95]]);
  assert.deepEqual(fuelBox(flown, checks[1], 0).map(p => p.cum), [65]);
  assert.equal(checks[1].due, 665);
});

/* ---------------------------------------------------------- Direct-To gaps */
test('Direct-To gaps do not erase half-hour obligations when no fuel figure is entered', () => {
  // W1/W2/W3 represent waypoints removed by a Direct-To; fuelChecks receives only
  // the route that is still actually overflown. Two elapsed windows therefore
  // both fall on the next available waypoint rather than silently disappearing.
  const flown = route(0, 80, 110, 145);
  const checks = fuelChecks(flown, 0, none, atPlan);

  assert.deepEqual(checks.slice(0, 3).map(c => [c.from, c.to]),
                   [[0, 30], [30, 60], [60, 90]]);
  assert.deepEqual(fuelBox(flown, checks[0], 0).map(p => p.cum), [80]);
  assert.deepEqual(fuelBox(flown, checks[1], 0).map(p => p.cum), [80]);
  assert.equal(checks[0].due, 680);
  assert.equal(checks[1].due, 680);
});

test('a Direct-To taken inside the first fuel window cannot move the check backward to a passed waypoint', () => {
  // The aircraft has already passed 0:02 and 0:04 when the Direct removes the
  // intermediate rows. The first waypoint still flown after the gap is 0:34.
  // Before this regression fix the 0:04 row was incorrectly chosen because it
  // remained inside the 0-30 window even though it was behind the aircraft.
  const flown = [
    { i: 0, sec: 1, wp: 'DEP', cum: 0,  t: 600 },
    { i: 1, sec: 1, wp: 'A',   cum: 2,  t: 602 },
    { i: 2, sec: 1, wp: 'B',   cum: 4,  t: 604 },
    { i: 8, sec: 1, wp: 'DCT', cum: 34, t: 634 },
    { i: 9, sec: 1, wp: 'N1',  cum: 65, t: 665 },
    { i: 10, sec: 1, wp: 'DST', cum: 95, t: 695 }
  ];
  const checks = fuelChecks(flown, 0, none, atPlan);

  assert.deepEqual(fuelBox(flown, checks[0], 0).map(p => p.wp), ['DCT']);
  assert.equal(checks[0].due, 634);
});

test('a second Direct-To remaps the next fuel window to the new flown target', () => {
  // Two separate gaps emulate two Direct clearances in succession. The first
  // check belongs at the first target (0:34); the 30-60 window must not fall
  // back to that already-passed target after the second Direct, so it moves to
  // the second target at 0:55.
  const flown = [
    { i: 0, sec: 1, wp: 'DEP',  cum: 0,  t: 600 },
    { i: 1, sec: 1, wp: 'A',    cum: 2,  t: 602 },
    { i: 2, sec: 1, wp: 'B',    cum: 4,  t: 604 },
    { i: 8, sec: 1, wp: 'DCT1', cum: 34, t: 634 },
    { i: 14, sec: 1, wp: 'DCT2', cum: 55, t: 655 },
    { i: 15, sec: 1, wp: 'DST', cum: 85, t: 685 }
  ];
  const checks = fuelChecks(flown, 0, none, atPlan);

  assert.deepEqual(fuelBox(flown, checks[0], 0).map(p => p.wp), ['DCT1']);
  assert.equal(checks[0].due, 634);
  assert.deepEqual(fuelBox(flown, checks[1], 0).map(p => p.wp), ['DCT2']);
  assert.equal(checks[1].due, 655);
});

test('fuel already recorded before a Direct remains a completed check and restarts the clock there', () => {
  const flown = [
    { i: 0, sec: 1, wp: 'DEP', cum: 0,  t: 600 },
    { i: 1, sec: 1, wp: 'A',   cum: 2,  t: 602 },
    { i: 2, sec: 1, wp: 'B',   cum: 4,  t: 604 },
    { i: 8, sec: 1, wp: 'DCT', cum: 34, t: 634 },
    { i: 9, sec: 1, wp: 'N1',  cum: 64, t: 664 },
    { i: 10, sec: 1, wp: 'DST', cum: 95, t: 695 }
  ];
  const hasFuel = p => p.i === 2;
  const checks = fuelChecks(flown, 0, hasFuel, atPlan);

  assert.equal(checks[0].doneAt.wp, 'B');
  assert.equal(checks[1].from, 4);
  assert.deepEqual(fuelBox(flown, checks[1], 0).map(p => p.wp), ['DCT']);
});

test('a fuel figure at the first waypoint after a Direct-To gap prevents duplicate overdue windows after entry', () => {
  const flown = route(0, 80, 110, 145);
  const hasFuel = p => p.cum === 80;
  const checks = fuelChecks(flown, 0, hasFuel, atPlan);

  assert.deepEqual(checks.slice(0, 3).map(c => [c.from, c.to]),
                   [[0, 30], [80, 110], [110, 140]]);
});

/* -------------------------------------------------------------- end flight */
test('no new fuel window is opened when less than 30 minutes remain to destination', () => {
  const flown = route(0, 20, 55, 78);
  const checks = fuelChecks(flown, 0, none, atPlan);

  assert.deepEqual(checks.map(c => [c.from, c.to]), [[0, 30], [30, 60]]);
  assert.ok(checks.every(c => c.to <= 78));
});

test('missing fuel entries leave every complete half-hour window due', () => {
  const flown = route(0, 20, 55, 85, 115, 145);
  const checks = fuelChecks(flown, 0, none, atPlan);

  assert.deepEqual(checks.map(c => [c.from, c.to]),
                   [[0, 30], [30, 60], [60, 90], [90, 120]]);
  assert.equal(checks.length, 4);
});

/* ------------------------------------------------------------- ATO offset */
test('a positive ATO offset moves both fallback selection and displayed due time consistently', () => {
  const flown = route(0, 20, 65, 95);
  const checks = fuelChecks(flown, 12, none, atPlan);

  assert.deepEqual(fuelBox(flown, checks[0], 12).map(p => p.cum), [0]);
  assert.equal(checks[0].due, 612);
  assert.deepEqual(fuelBox(flown, checks[1], 12).map(p => p.cum), [20]);
  assert.equal(checks[1].due, 632);
});
