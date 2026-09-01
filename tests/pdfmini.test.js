'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFMini = require('../pdfmini.js');
const { buildPdf, objectHeaders, lastXrefEntries } = require('./helpers/make-pdf.js');

const str = u8 => Buffer.from(u8).toString('latin1');

test('reads a classic xref document and its one page', async () => {
  const doc = new PDFMini.Doc(buildPdf());
  const pages = doc.pages();
  assert.equal(pages.length, 1);
  assert.equal(doc.get(pages[0].dict.Type).name, 'Page');
  assert.deepEqual(doc.get(pages[0].MediaBox), [0, 0, 612, 792]);
});

test('extracts text with its coordinates and size', async () => {
  const doc = new PDFMini.Doc(buildPdf());
  const items = PDFMini.textItems(await doc.content(doc.pages()[0]));
  assert.equal(items.length, 1);
  assert.equal(items[0].str, 'WPT01');
  assert.equal(items[0].x, 100);
  assert.equal(items[0].y, 700);
  assert.equal(items[0].size, 10);
});

test('decodes an uncompressed content stream too', async () => {
  const doc = new PDFMini.Doc(buildPdf({ compress: false }));
  const items = PDFMini.textItems(await doc.content(doc.pages()[0]));
  assert.equal(items[0].str, 'WPT01');
});

test('a reference carries its generation', () => {
  const lx = new PDFMini.Lexer('<</Page 7 4 R/Other 9 0 R>>', 0);
  const d = lx.obj();
  assert.deepEqual(d.Page, { ref: 7, gen: 4 });
  assert.deepEqual(d.Other, { ref: 9, gen: 0 });
});

test('a page issued under a non-zero generation keeps it', () => {
  const doc = new PDFMini.Doc(buildPdf({ pageGen: 4 }));
  assert.equal(doc.pages()[0].gen, 4);
  assert.equal(doc.genOf(3), 4);
  assert.equal(doc.genOf(1), 0);
});

/* The bug this guards: the reader kept only object numbers, so the incremental
   update re-emitted every modified object as generation 0. A reader following
   "3 4 R" out of the page tree then found "3 0 obj" and was entitled to ignore
   the overlay — or the whole update. */
test('the incremental update rewrites objects under their own generation', async () => {
  const doc = new PDFMini.Doc(buildPdf({ pageGen: 4, rootGen: 2 }));
  const ops = new PDFMini.Ops().text('FB', 9, 10, 20, '0455', [0, 0, 1]).done();
  const out = PDFMini.append(doc, new Map([[0, ops]]),
    { fonts: [{ name: 'FB', dict: '<</Type/Font/Subtype/Type1/BaseFont/Courier-Bold>>' }] });
  const s = str(out);

  // the page goes back out as "3 4 obj", never "3 0 obj"
  const appended = objectHeaders(out.subarray(doc.bytes.length));
  assert.ok(appended.some(([n, g]) => n === 3 && g === 4), 'page rewritten as 3 4 obj');
  assert.ok(!appended.some(([n, g]) => n === 3 && g === 0), 'page not rewritten as 3 0 obj');

  // the new xref section carries generation 4 for the page and 0 for new objects
  const gens = lastXrefEntries(out).map(([, g]) => g).sort();
  assert.deepEqual(gens, [0, 0, 4]);

  // and the trailer's own /Root reference keeps the generation it was read with
  assert.match(s.slice(-400), /\/Root 1 2 R/);
  assert.match(s.slice(-400), /\/Prev \d+/);
});

test('the appended document still parses, with the overlay on the page', async () => {
  const doc = new PDFMini.Doc(buildPdf({ pageGen: 4 }));
  const ops = new PDFMini.Ops().text('FB', 9, 10, 20, '0455', [0, 0, 1]).done();
  const out = PDFMini.append(doc, new Map([[0, ops]]),
    { fonts: [{ name: 'FB', dict: '<</Type/Font/Subtype/Type1/BaseFont/Courier-Bold>>' }] });

  const again = new PDFMini.Doc(out);
  const page = again.pages()[0];
  assert.equal(again.pages().length, 1);
  assert.equal(page.gen, 4);

  const contents = again.get(page.dict.Contents);
  assert.ok(Array.isArray(contents), '/Contents became an array');
  assert.equal(contents.length, 2);

  const content = await again.content(page);
  assert.match(content, /WPT01/);           // the original page is intact
  assert.match(content, /\(0455\) Tj/);     // and the overlay is on it
  assert.match(str(out), /\/FB \d+ 0 R/);   // with the font added to /Resources
});

test('an /Contents already given as an array is extended, not replaced', async () => {
  const doc = new PDFMini.Doc(buildPdf({ contentsArray: true }));
  const out = PDFMini.append(doc, new Map([[0, new PDFMini.Ops().done()]]), { fonts: [] });
  const again = new PDFMini.Doc(out);
  const contents = again.get(again.pages()[0].dict.Contents);
  assert.equal(contents.length, 2);
});

test('a document larger than the limit is refused before it is read', () => {
  const was = PDFMini.LIMITS.bytes;
  PDFMini.LIMITS.bytes = 16;
  try {
    assert.throws(() => new PDFMini.Doc(buildPdf()), /limit/);
  } finally { PDFMini.LIMITS.bytes = was; }
});

test('a stream that inflates past the limit is stopped', async () => {
  const doc = new PDFMini.Doc(buildPdf({ text: 'BT /F1 10 Tf (x) Tj ET\n'.repeat(200) }));
  const was = PDFMini.LIMITS.stream;
  PDFMini.LIMITS.stream = 64;
  try {
    await assert.rejects(() => doc.content(doc.pages()[0]), /limit/);
  } finally { PDFMini.LIMITS.stream = was; }
});

test('more pages than the limit is refused', () => {
  const doc = new PDFMini.Doc(buildPdf());
  doc._pages = null;
  const was = PDFMini.LIMITS.pages;
  PDFMini.LIMITS.pages = 0;
  try {
    assert.throws(() => doc.pages(), /limit/);
  } finally { PDFMini.LIMITS.pages = was; }
});

/* A /Kids that points back up its own tree used to recurse until the stack gave
   out — a crafted package could take the tab down before anything was shown. */
test('a page tree that points back at itself terminates', () => {
  const base = str(buildPdf());
  const looped = base.replace('<</Type/Pages/Kids[3 0 R]/Count 1>>',
                              '<</Type/Pages/Kids[2 0 R]/Count 1>>');
  const doc = new PDFMini.Doc(new Uint8Array(Buffer.from(looped, 'latin1')));
  assert.deepEqual(doc.pages(), []);
});
