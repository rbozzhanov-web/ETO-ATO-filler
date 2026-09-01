'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jl = require('../jl-pdf.js');
const { buildPdf, objectHeaders, lastXrefEntries } = require('./helpers/make-pdf.js');

const str = u8 => Buffer.from(u8).toString('latin1');
const PAGE_W = 841.89, PAGE_H = 595.28;

/* ------------------------------------------------------------ export geometry
   The bug this guards: the exported font size was the computed CSS size divided
   by a ratio taken off the sheet's on-screen width. The sheet is scaled by a CSS
   transform for pinch-zoom, so that ratio carried the zoom — a Journey Log
   exported while zoomed in came out with text of the wrong size, in the wrong
   place. Every measurement below is taken at three zoom levels; the placement
   must not move. */
function place(zoom, fontPx = 9){
  const px = pt => pt * (4 / 3) * zoom;            // 1pt = 4/3 css px, then zoomed
  return jl.exportPlacement({
    sheetRect: { left: 30, top: 15, width: px(PAGE_W), height: px(PAGE_H) },
    rect: { left: 30 + px(100), top: 15 + px(50), width: px(60), height: px(12) },
    fontPx, length: 5, alignLeft: false, pageW: PAGE_W, pageH: PAGE_H });
}

test('the exported placement is the same at any zoom', () => {
  const fitted = place(1);
  for (const zoom of [0.3, 1, 2.5, 4]){
    const at = place(zoom);
    // A thousandth of a point is a hundred-thousandth of an inch: this is float
    // noise out of the rects, not the text moving.
    for (const k of ['x', 'y', 'size'])
      assert.ok(Math.abs(at[k] - fitted[k]) < 0.001,
                `zoom ${zoom} moved ${k}: ${at[k]} vs ${fitted[k]}`);
  }
});

test('the font size is the css size converted to points, zoom aside', () => {
  assert.equal(jl.PX_TO_PT, 0.75);
  assert.equal(place(1, 12).size, 9);              // 12px -> 9pt
  assert.equal(place(4, 12).size, 9);
  assert.equal(place(0.3, 12).size, 9);
});

test('the placement lands where the box is on the page', () => {
  const at = place(1, 12);
  // centred in a 60pt box: 5 characters of 9pt Helvetica come to about 24pt
  assert.ok(at.x > 100 && at.x < 160, `x was ${at.x}`);
  // y is measured up from the bottom of the page, the box 50pt down from the top
  assert.ok(Math.abs(at.y - (PAGE_H - 50 - 6 - 9 * 0.34)) < 0.001, `y was ${at.y}`);
});

test('a left-aligned box starts at its own edge instead of centring', () => {
  const centred = jl.exportPlacement({
    sheetRect: { left: 0, top: 0, width: PAGE_W * 4 / 3, height: PAGE_H * 4 / 3 },
    rect: { left: 0, top: 0, width: 80 * 4 / 3, height: 12 * 4 / 3 },
    fontPx: 12, length: 4, alignLeft: false, pageW: PAGE_W, pageH: PAGE_H });
  const left = jl.exportPlacement({
    sheetRect: { left: 0, top: 0, width: PAGE_W * 4 / 3, height: PAGE_H * 4 / 3 },
    rect: { left: 0, top: 0, width: 80 * 4 / 3, height: 12 * 4 / 3 },
    fontPx: 12, length: 4, alignLeft: true, pageW: PAGE_W, pageH: PAGE_H });
  assert.equal(left.x, 2);
  assert.ok(centred.x > left.x);
});

/* ------------------------------------------------------------------- the PDF */
test('reads the issued Journey Log and its page', () => {
  const doc = new jl.Doc(buildPdf());
  assert.equal(doc.pages().length, 1);
});

test('a page issued under a non-zero generation is rewritten under it', () => {
  const doc = new jl.Doc(buildPdf({ pageGen: 3, rootGen: 5 }));
  assert.equal(doc.pages()[0].gen, 3);

  const ops = new jl.PdfOps().text('JL', 9, 10, 20, 'ABC', [0, 0, 1]);
  const out = jl.appendPdf(doc, new Map([[0, ops]]));

  const appended = objectHeaders(out.subarray(doc.bytes.length));
  assert.ok(appended.some(([n, g]) => n === 3 && g === 3), 'page rewritten as 3 3 obj');
  assert.ok(!appended.some(([n, g]) => n === 3 && g === 0));
  assert.deepEqual(lastXrefEntries(out).map(([, g]) => g).sort(), [0, 0, 3]);
  assert.match(str(out).slice(-400), /\/Root 1 5 R/);
});

test('the exported Journey Log still parses, with the entries on the page', async () => {
  const doc = new jl.Doc(buildPdf());
  const ops = new jl.PdfOps().text('JL', 9, 10, 20, 'KC-1234', [0, 0, 1]);
  const out = jl.appendPdf(doc, new Map([[0, ops]]));

  const again = new jl.Doc(out);
  const page = again.pages()[0];
  const content = await again.content(page);
  assert.match(content, /WPT01/);                  // the issued form is intact
  assert.match(content, /\(KC-1234\) Tj/);         // and the entry is on it
  assert.match(str(out), /\/JL \d+ 0 R/);          // with the font in /Resources
});

test('a Journey Log larger than the limit is refused before it is read', () => {
  const was = jl.PDF_LIMITS.bytes;
  jl.PDF_LIMITS.bytes = 16;
  try { assert.throws(() => new jl.Doc(buildPdf()), /limit/); }
  finally { jl.PDF_LIMITS.bytes = was; }
});

test('a page tree that points back at itself terminates', () => {
  const looped = str(buildPdf()).replace('<</Type/Pages/Kids[3 0 R]/Count 1>>',
                                         '<</Type/Pages/Kids[2 0 R]/Count 1>>');
  const doc = new jl.Doc(new Uint8Array(Buffer.from(looped, 'latin1')));
  assert.deepEqual(doc.pages(), []);
});
