'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { navaidOut } = require('../ofp-core.js');

// Wording as the packages print it (Doc 8400 abbreviations; Q-code subjects I and N
// with conditions AS, AU, AC/AW and CT).
test('a navigation aid out of use is recognised however the NOTAM words it', () => {
  for (const t of [
    'DVOR/DME KDR FREQ 116.0MHZ/107X U/S, DUE TO TECHNICAL PROBLEMS.',
    'RWY 28 LLZ  U/S.',
    'GP GP 28L NOT AVBL DUE CIV WORK IN CRITICAL AREA.',
    'NDB HRT FREQ 412KHZ U/S, DUE TO ELECTRICAL FAILURE.',
    'DIRECTION FINDING STATION U/S',
    'ILS RWY 07 CAT II NOT AVBL',
    'ILS LOC RWY 25 ON TEST DO NOT USE. FALSE INDICATIONS POSSIBLE',
    'TACAN CH 45X UNSERVICEABLE',
    'VOR ABC WITHDRAWN FOR MAINT',
    'OUTER MARKER RWY 06 OUT OF SERVICE',
    'GNSS UNAVBL WI 50NM RADIUS',
    'glide path rwy 33 unserviceable',
  ]) assert.ok(navaidOut(t), t);
});

test('outages that are not navaids, and navaids that are not out, are left alone', () => {
  for (const t of [
    'CROSSOVER TWY Z9 NOT AVBL.',
    'RWY 23R APCH LGT U/S',
    'RNAV (GNSS) RWY 25 APCH NOT AVBL',
    'KABUL TOWER ATIS IS U/S.',
    'LAKPASS MSSR NOT AVBL WI 250NM',
    'VOR/DME ABC RESTORED',
    'STAND 5 LOC NOT AVBL',
    'ILS RWY 07 CAT I AVBL',
    '',
  ]) assert.ok(!navaidOut(t), t);
});
