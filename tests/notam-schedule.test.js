'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { notamSchedule } = require('../ofp-core.js');

// Every schedule shape below is printed this way in a real package (KZR089, OCT 2026).
const at = (text, iso) => notamSchedule(text)(Date.parse(iso));

test('days of the month, at a time of day', () => {
  const t = '01 08 15 22 29 1130-1300 RWY 12R/30L CLSD.';
  assert.equal(at(t, '2026-11-08T12:00Z'), true);
  assert.equal(at(t, '2026-11-09T12:00Z'), false, 'not on the 9th');
  assert.equal(at(t, '2026-11-08T13:00Z'), false, 'over at 1300');
  assert.equal(at('14 27 2130-2215 RWY 12R/30L CLSD.', '2026-10-27T21:45Z'), true);
});

test('daily, with the days it does not apply', () => {
  const t = 'DLY 0800-1200 EXC SUN RWY 25L/07R NOT AVBL EXC SUNDAY/HOLIDAYS DUE TO PREVENTIVE MAINT';
  assert.equal(at(t, '2026-11-02T09:00Z'), true, 'a Monday morning');
  assert.equal(at(t, '2026-11-01T09:00Z'), false, 'not on Sunday');
  assert.equal(at(t, '2026-11-02T14:00Z'), false, 'not in the afternoon');
  assert.equal(at('0400-1100 EXC SAT SUN UAS ACT', '2026-11-07T05:00Z'), false);
  assert.equal(at('0400-1100 EXC SAT SUN UAS ACT', '2026-11-06T05:00Z'), true);
  assert.equal(at('DLY 0400-1300 TEMPO AREA ACT', '2026-11-06T05:00Z'), true);
  assert.equal(at('0600-1400 SECN OF TWY M CLSD', '2026-11-06T15:00Z'), false);
});

test('days of the week, ranges of them, and more than one window', () => {
  assert.equal(at('TUE 0600-0700 RWY 12/30 CLSD DUE MAINT.', '2026-11-03T06:30Z'), true);
  assert.equal(at('TUE 0600-0700 RWY 12/30 CLSD DUE MAINT.', '2026-11-04T06:30Z'), false);
  assert.equal(at('SUN-THU 0300-0700 DEMOLITION ACT', '2026-11-05T04:00Z'), true);
  assert.equal(at('SUN-THU 0300-0700 DEMOLITION ACT', '2026-11-06T04:00Z'), false, 'not on Friday');
  assert.equal(at('MON 1100-1400 2000-2045 RWY 12/30 CLSD', '2026-11-02T20:10Z'), true);
  assert.equal(at('MON 1100-1400 2000-2045 RWY 12/30 CLSD', '2026-11-02T15:00Z'), false);
  assert.equal(at('1515-1545 1715-1745 TRA ESTABLISHED', '2026-11-02T16:00Z'), false);
});

test('months with their days, ranges of days, and groups of their own', () => {
  const crane = 'OCT 16 17 18 23 24 25 31 NOV 01 08 13 15 0300-1500 OBST MOBILE CRANE';
  assert.equal(at(crane, '2026-11-08T04:00Z'), true);
  assert.equal(at(crane, '2026-11-09T04:00Z'), false);
  assert.equal(at(crane, '2026-10-08T04:00Z'), false, 'the 8th is listed under NOV only');
  const route = 'OCT 19-22 26-29 0730-1030, NOV 02-05 0730-1030, NOV 09-12 1430-1730, NOV 16-19 0730-1030 ATS RTE';
  assert.equal(at(route, '2026-11-10T15:00Z'), true);
  assert.equal(at(route, '2026-11-10T08:00Z'), false, 'that week it is the afternoon');
  const uas = 'OCT 05 0600-1400, OCT 06 - DEC 10 0200-1400 UAS ACT';
  assert.equal(at(uas, '2026-11-20T03:00Z'), true, 'a run of dates from one month into another');
  assert.equal(at(uas, '2026-10-05T03:00Z'), false, 'the 5th starts later');
  assert.equal(at('OCT 01-02 05-09 12-16 19-23 26-30 0300-1859 OP/D110 ACT', '2026-10-10T04:00Z'), false);
});

test('a window past midnight belongs to the day it starts on', () => {
  assert.equal(at('1600-0100 UAS ACT', '2026-11-02T00:30Z'), true);
  assert.equal(at('1600-0100 UAS ACT', '2026-11-02T02:00Z'), false);
  assert.equal(at('DLY BTN 1700/0300 DUE TO AIR TFC CONGESTION', '2026-11-02T02:00Z'), true);
  const rwy = 'MON 0500-2359, TUE 0000-0100 RWY 05/23 CLSD';
  assert.equal(at(rwy, '2026-11-02T23:59Z'), true, '2359 runs to the end of the day');
  assert.equal(at(rwy, '2026-11-03T00:30Z'), true);
  assert.equal(at(rwy, '2026-11-03T02:00Z'), false);
});

test('a NOTAM without a schedule it can read is left to its validity', () => {
  for (const t of ['EXCAVATION 0.5M DEEP LOCATED IN FRONT OF TWY F', 'RWY 12R/30L CLSD.', '23 RWY', 'DLY RWY', ''])
    assert.equal(notamSchedule(t), null, t);
});
