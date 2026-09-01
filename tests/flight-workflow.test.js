'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fmt, parseTime, wrapMin, computeResult, hourlyChecks, fuelChecks, directSkips,
  planKeyFor, prunePlans
} = require('../ofp-core.js');
const { Doc, PdfOps, appendPdf, toStr } = require('../jl-pdf.js');
const { buildPdf } = require('./helpers/make-pdf.js');

// localStorage-shaped store used to prove that the same flight state survives a
// reload and comes back under the content-addressed PDF key.
function storeOf(){
  const m = new Map();
  return {
    get length(){ return m.size; },
    key(i){ return [...m.keys()][i] ?? null; },
    getItem(k){ return m.has(k) ? m.get(k) : null; },
    setItem(k, v){ m.set(k, String(v)); },
    removeItem(k){ m.delete(k); }
  };
}

test('one flight survives the complete operational workflow', () => {
  // A representative 3h25 main route plus a 45-minute alternate. Cumulative
  // times are the same values app.js hands to the pure flight arithmetic.
  const plan = [
    { i:0, sec:1, wp:'UAAA',  cum:0,   rem:29647 },
    { i:1, sec:1, wp:'TOC',   cum:20,  rem:28100 },
    { i:2, sec:1, wp:'ABDAR', cum:65,  rem:25200 },
    { i:3, sec:1, wp:'KEGOL', cum:125, rem:22000 },
    { i:4, sec:1, wp:'TURAN', cum:185, rem:19000 },
    { i:5, sec:1, wp:'UACC',  cum:205, rem:18000 },
    { i:6, sec:2, wp:'ALTN1', cum:20,  rem:15000 },
    { i:7, sec:2, wp:'ALTN2', cum:45,  rem:13000 }
  ];

  // 1) takeoff -> ETO calculation, including the alternate beginning at arrival.
  const t0 = parseTime('2310');
  assert.equal(t0, 1390);
  const computed = computeResult(plan, t0, true);
  assert.equal(fmt(computed.rows.find(p => p.wp === 'UACC').t), '0235');
  assert.equal(fmt(computed.rows.find(p => p.wp === 'ALTN1').t), '0255');
  assert.equal(fmt(computed.rows.find(p => p.wp === 'ALTN2').t), '0320');

  // 2) actual at ABDAR is ten minutes late; subsequent operational comparisons
  // move by that offset without rewriting the planned ETO column.
  const act = { 0:{ ato:'2310' }, 1:{ ato:'2330' }, 2:{ ato:'0025' } };
  const abdar = computed.rows.find(p => p.wp === 'ABDAR');
  const off = wrapMin(parseTime(act[2].ato) - (abdar.t % 1440));
  assert.equal(off, 10);
  assert.equal(fmt(abdar.t), '0015');

  // 3) direct KEGOL -> TURAN after ABDAR cuts KEGOL out of the flown route.
  const ci = computed.rows.findIndex(p => p.wp === 'ABDAR');
  const target = computed.rows.findIndex(p => p.wp === 'TURAN');
  const skipped = directSkips(computed.rows, ci, target, () => false);
  assert.deepEqual(skipped, [3]);
  const skipSet = new Set(skipped);
  const flown = computed.rows.filter(p => p.sec === 1 && !skipSet.has(p.i));

  // 4) hourly altimeter checks remain anchored to the plan and are present for
  // a flight of this duration.
  const altChecks = hourlyChecks(computed.rows, t0);
  assert.deepEqual(altChecks.map(c => c.mark), [60, 120]);
  assert.equal(altChecks[0].wp.wp, 'ABDAR');
  assert.equal(altChecks[1].wp.wp, 'KEGOL');

  // 5) fuel checks follow the actually flown route. Record an early check at
  // ABDAR; the next 30-minute window then starts from that actual check point.
  const fuel = { 2:'24700', 4:'20100' };
  const atTime = p => {
    const a = act[p.i] && parseTime(act[p.i].ato);
    return a == null ? p.cum + off : wrapMin(a - t0);
  };
  const checks = fuelChecks(flown, off, p => !!fuel[p.i], atTime);
  assert.ok(checks.length >= 4);
  assert.ok(checks.every(c => c.to > c.from));
  assert.ok(checks.some(c => c.from === 75), 'an early check moves the next window anchor');

  // 6) save every operational entry under the PDF-content key, then recreate the
  // store-facing state as a fresh launch would. Nothing is keyed only by filename.
  const store = storeOf();
  const hash = '0123456789abcdef'.repeat(4);
  const key = planKeyFor(hash, 'OFP.pdf', 123456);
  const saved = {
    etd:'2310', alt:true, act, fuel, alt2:{ 60:{ a1:'1013', sb:'1013', a2:'1013' } },
    dct:[{ to:4, skipped }], alerted:[60], alarm:true, savedAt:Date.now()
  };
  store.setItem(key, JSON.stringify(saved));
  prunePlans(store, saved.savedAt, 30, 20);
  const restored = JSON.parse(store.getItem(planKeyFor(hash, 'renamed.pdf', 999999)) || 'null');
  // Same bytes mean the same SHA key regardless of the filename/size supplied now.
  assert.deepEqual(restored, saved);

  // 7) Journey Log export appends filled operational text to a real generated PDF
  // and leaves a parseable incremental update behind.
  const input = buildPdf({ text:'BT /F1 10 Tf 100 700 Td (JOURNEY LOG) Tj ET\n' });
  const doc = new Doc(input);
  const ops = new PdfOps()
    .text('JL', 9, 100, 650, 'UAAA-UACC', [0,0,0])
    .text('JL', 9, 100, 635, 'OFF 2310Z / ON 0235Z', [0,0,0])
    .text('JL', 9, 100, 620, 'DCT TURAN / FUEL 20100', [0,0,0]);
  const exported = appendPdf(doc, new Map([[0, ops]]));
  const out = toStr(exported);
  assert.ok(out.includes('(UAAA-UACC) Tj'));
  assert.ok(out.includes('(OFF 2310Z / ON 0235Z) Tj'));
  assert.ok(out.includes('(DCT TURAN / FUEL 20100) Tj'));
  assert.doesNotThrow(() => new Doc(exported));
});
