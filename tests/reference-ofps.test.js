'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, fmt, computeResult, hourlyChecks, directSkips } = require('../ofp-core.js');
const fixtures = require('./fixtures/reference-ofps.js');

for (const fx of fixtures) {
  test('reference OFP: ' + fx.name, () => {
    const t0 = parseTime(fx.takeoff);
    assert.notEqual(t0, null);
    const computed = computeResult(fx.plan, t0, fx.withAltn);
    assert.equal(fmt(computed.arr), fx.expected.arrival);
    const checks = hourlyChecks(computed.rows, t0).map(c => ({ mark:c.mark, wp:c.wp.wp, label:c.label }));
    assert.deepEqual(checks, fx.expected.altimeter);

    if (fx.expected.alternate) {
      const alternate = computed.rows.filter(p => p.sec === 2).map(p => ({ wp:p.wp, eto:fmt(p.t) }));
      assert.deepEqual(alternate, fx.expected.alternate);
    }

    if (fx.direct) {
      const prior = new Set(fx.direct.alreadySkipped || []);
      const skipped = directSkips(computed.rows, fx.direct.currentIndex, fx.direct.targetIndex, i => prior.has(i));
      assert.deepEqual(skipped, fx.expected.directSkipped);
    }
  });
}

test('reference OFP catalogue covers broad regression classes', () => {
  assert.ok(fixtures.length >= 10);
  assert.ok(fixtures.some(f => f.withAltn));
  assert.ok(fixtures.some(f => f.direct));
  assert.ok(fixtures.some(f => f.expected.arrival < f.takeoff));
});
