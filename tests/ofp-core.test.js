'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../ofp-core.js');

const { parseTime, fmt, hhmm, norm, wrapMin, sinceDueAt, computeResult,
        hourlyChecks, fuelBox, fuelChecks, directSkips,
        legacyKeyFor, planKeyFor, planKeysIn, prunePlans } = core;

/* ---------------------------------------------------------------- times */
test('parseTime takes HHMM and refuses anything else', () => {
  assert.equal(parseTime('0210'), 130);
  assert.equal(parseTime('0000'), 0);
  assert.equal(parseTime('2359'), 23 * 60 + 59);
  assert.equal(parseTime('2400'), null);   // hour out of range
  assert.equal(parseTime('1260'), null);   // minute out of range
  assert.equal(parseTime('210'), null);    // not four digits
  assert.equal(parseTime('00:00'), null);  // punctuation is never stripped/guessed
  assert.equal(parseTime('02 10'), null);
  assert.equal(parseTime('0210Z'), null);
  assert.equal(parseTime('ab0210'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(undefined), null);
});

test('fmt folds into the day, hhmm does not', () => {
  assert.equal(fmt(130), '0210');
  assert.equal(fmt(1440 + 130), '0210');   // a flight over midnight
  assert.equal(fmt(-30), '2330');
  assert.equal(norm(-30), 1410);
  assert.equal(hhmm(130), '2.10');
  assert.equal(hhmm(1440 + 130), '26.10'); // time en route is a duration, not a clock
});

test('a time difference is read the short way round', () => {
  assert.equal(wrapMin(10), 10);
  assert.equal(wrapMin(-10), -10);
  assert.equal(wrapMin(1430), -10);        // ten minutes early over midnight
  assert.equal(wrapMin(-1430), 10);
  assert.equal(sinceDueAt(5, 1435), 10);   // 00:05 now, due 23:55 — ten minutes late
  assert.equal(sinceDueAt(1435, 5), -10);
});

/* ------------------------------------------------------------ ETO table */
const PLAN = [
  { i: 0, sec: 1, wp: 'ALA',   cum: 0 },
  { i: 1, sec: 1, wp: 'TOC',   cum: 20 },
  { i: 2, sec: 1, wp: 'ABDAR', cum: 75 },
  { i: 3, sec: 1, wp: 'KEGOL', cum: 140 },
  { i: 4, sec: 1, wp: 'TOD',   cum: 190 },
  { i: 5, sec: 1, wp: 'UACC',  cum: 205 },
  { i: 6, sec: 2, wp: 'ALTN1', cum: 15 },
  { i: 7, sec: 2, wp: 'UAKD',  cum: 40 }
];

test('ETOs run from takeoff, and the alternate from arrival', () => {
  const { rows, arr } = computeResult(PLAN, 130, true);   // takeoff 0210
  assert.equal(rows.length, 8);
  assert.equal(arr, 130 + 205);
  assert.equal(fmt(rows[0].t), '0210');
  assert.equal(fmt(rows[5].t), '0535');                   // 0210 + 3.25
  assert.equal(fmt(rows[7].t), '0615');                   // arrival + 0.40
});

test('the alternate is left out unless it is asked for', () => {
  const { rows } = computeResult(PLAN, 130, false);
  assert.equal(rows.length, 6);
  assert.ok(rows.every(p => p.sec === 1));
});

test('an ETO past midnight keeps counting and prints folded', () => {
  const { rows } = computeResult(PLAN, 23 * 60, false);   // takeoff 2300
  assert.equal(rows[5].t, 23 * 60 + 205);
  assert.equal(fmt(rows[5].t), '0225');
});

/* -------------------------------------------------- altimeter cross-checks */
test('one altimeter check an hour, and none in the last hour', () => {
  const { rows } = computeResult(PLAN, 130, false);       // 3h25 en route
  const checks = hourlyChecks(rows, 130);
  assert.deepEqual(checks.map(c => c.label), ['+1:00', '+2:00']);
  assert.deepEqual(checks.map(c => c.wp.wp), ['ABDAR', 'KEGOL']);
  assert.equal(fmt(checks[0].due), '0310');
});

test('a short flight still owes a check, taken at TOC', () => {
  const short = [
    { i: 0, sec: 1, wp: 'ALA', cum: 0 },
    { i: 1, sec: 1, wp: 'TOC', cum: 18 },
    { i: 2, sec: 1, wp: 'UACC', cum: 70 }
  ];
  const { rows } = computeResult(short, 600, false);
  const checks = hourlyChecks(rows, 600);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].label, 'TOC');
  assert.equal(checks[0].wp.wp, 'TOC');
});

test('no waypoints, no checks', () => {
  assert.deepEqual(hourlyChecks([], 0), []);
});

/* -------------------------------------------------------------- fuel checks */
const flown = computeResult(PLAN, 130, false).rows;
const noFuel = () => false;
const atPlan = (p, off) => p.t + off;

test('a fuel check every half hour, on the waypoint before the mark', () => {
  const checks = fuelChecks(flown, 0, noFuel, atPlan);
  // 3h25 en route, so the last full half hour starts at 2h30; nothing is opened
  // that the flight does not have thirty minutes left to fly.
  assert.deepEqual(checks.map(c => [c.from, c.to]),
                   [[0, 30], [30, 60], [60, 90], [90, 120], [120, 150], [150, 180]]);
  assert.deepEqual(fuelBox(flown, checks[0], 0).map(p => p.wp), ['TOC']);
  assert.deepEqual(fuelBox(flown, checks[2], 0).map(p => p.wp), ['ABDAR']);
});

test('a window a direct has emptied falls on the next waypoint actually overflown', () => {
  const box = fuelBox(flown, { from: 30, to: 60 }, 0);   // nothing between 0.30 and 1.00
  assert.deepEqual(box.map(p => p.wp), ['ABDAR']);       // the next one that is
});

test('a figure entered early restarts the half hour from there', () => {
  const early = p => p.wp === 'TOC';                     // written at 0.20, not at 0.30
  const checks = fuelChecks(flown, 0, early, atPlan);
  assert.deepEqual(checks[0], { from: 0, to: 30, mark: 30, due: flown[1].t });
  assert.equal(checks[1].from, 20);                      // the next window runs from 0.20
  assert.equal(checks[1].to, 50);
});

test('the offset from the entered ATOs moves the windows with the flight', () => {
  // Running twelve minutes late, every waypoint sits twelve minutes further into
  // the flight, so the first half hour now closes on ALA rather than on TOC and
  // the check falls due twelve minutes after ALA's planned time.
  const on = fuelChecks(flown, 0, noFuel, atPlan);
  assert.equal(on[0].due, flown[1].t);
  const late = fuelChecks(flown, 12, noFuel, atPlan);
  assert.deepEqual(fuelBox(flown, late[0], 12).map(p => p.wp), ['ALA']);
  assert.equal(late[0].due, flown[0].t + 12);
});

/* ---------------------------------------------------------------- direct to */
test('a direct takes out the waypoints between here and the cleared one', () => {
  const skipped = directSkips(flown, 1, 4, () => false);  // past TOC, direct to TOD
  assert.deepEqual(skipped, [2, 3]);                      // ABDAR and KEGOL
});

test('a waypoint already taken out by an earlier direct is not counted twice', () => {
  const already = new Set([2]);
  assert.deepEqual(directSkips(flown, 1, 4, i => already.has(i)), [3]);
});

test('a direct to the very next waypoint takes nothing out', () => {
  assert.deepEqual(directSkips(flown, 1, 2, () => false), []);
});

/* ------------------------------------------- one plan's state, one plan only */
class FakeStore {
  constructor(entries = {}){ this.map = new Map(Object.entries(entries)); }
  get length(){ return this.map.size; }
  key(i){ return [...this.map.keys()][i]; }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}

/* The bug this guards: state was keyed by file name and byte length, so two
   different packages that happened to share both — the same daily flight number
   on two days, say — handed one flight's takeoff time, ATO, fuel and directs to
   the other. */
test('two different PDFs of the same name and size do not share a key', () => {
  const a = planKeyFor('a'.repeat(64), 'OFP.pdf', 524288);
  const b = planKeyFor('b'.repeat(64), 'OFP.pdf', 524288);
  assert.notEqual(a, b);
  assert.equal(planKeyFor('a'.repeat(64), 'OTHER.pdf', 9), a); // the bytes decide, not the name
});

test('without a digest the old name-and-size key is still used', () => {
  assert.equal(planKeyFor(null, 'OFP.pdf', 524288), legacyKeyFor('OFP.pdf', 524288));
});

test('device settings are never counted as stored flights', () => {
  const store = new FakeStore({
    'etofill:theme': 'dark', 'etofill:wxhi': '1', 'etofill:last': '{}',
    'etofill:plan:abc': '{}', 'etofill:OFP.pdf:1234': '{}', 'unrelated': 'x'
  });
  assert.deepEqual(planKeysIn(store).sort(), ['etofill:OFP.pdf:1234', 'etofill:plan:abc']);
});

test('stored flights age out and the oldest beyond the cap are dropped', () => {
  const now = 1_700_000_000_000, day = 86400000;
  const store = new FakeStore({
    'etofill:plan:new':   JSON.stringify({ savedAt: now - day }),
    'etofill:plan:mid':   JSON.stringify({ savedAt: now - 5 * day }),
    'etofill:plan:stale': JSON.stringify({ savedAt: now - 40 * day }),
    'etofill:theme':      'dark'
  });
  const dropped = prunePlans(store, now, 30, 2);
  assert.deepEqual(dropped, ['etofill:plan:stale']);
  assert.equal(store.getItem('etofill:theme'), 'dark');

  const dropped2 = prunePlans(store, now, 30, 1);
  assert.deepEqual(dropped2, ['etofill:plan:mid']);      // the older of the two
  assert.ok(store.getItem('etofill:plan:new'));
});

test('an entry with no clock is stamped rather than kept for ever', () => {
  const now = 1_700_000_000_000;
  const store = new FakeStore({ 'etofill:plan:old': JSON.stringify({ act: {} }) });
  assert.deepEqual(prunePlans(store, now, 30, 20), []);
  assert.equal(JSON.parse(store.getItem('etofill:plan:old')).savedAt, now);
  // and from that stamp it ages like any other
  assert.deepEqual(prunePlans(store, now + 31 * 86400000, 30, 20), ['etofill:plan:old']);
});

test('unreadable entries are cleared out rather than left to sit', () => {
  const store = new FakeStore({ 'etofill:plan:bad': 'not json' });
  assert.deepEqual(prunePlans(store, Date.now(), 30, 20), ['etofill:plan:bad']);
  assert.equal(store.length, 0);
});
