'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFMini = require('../pdfmini.js');
const { buildPdf } = require('./helpers/make-pdf.js');

const asLatin1 = u8 => Buffer.from(u8).toString('latin1');
const asBytes = s => new Uint8Array(Buffer.from(s, 'latin1'));

test('plain garbage is rejected immediately as a malformed PDF', () => {
  assert.throws(() => new PDFMini.Doc(asBytes('this is not a PDF')), /startxref not found/);
});

test('a damaged startxref target is rejected instead of being scanned heuristically', () => {
  const s = asLatin1(buildPdf());
  const bad = s.replace(/startxref\s+\d+/, 'startxref\n99999999');
  assert.throws(() => new PDFMini.Doc(asBytes(bad)), /only a classic xref table is supported/);
});

test('xref-stream style input is refused with an explicit unsupported-format error', () => {
  const s = asLatin1(buildPdf());
  const m = /startxref\s+(\d+)/.exec(s);
  assert.ok(m);
  const off = Number(m[1]);
  const marker = '9 0 obj\n<</Type/XRef>>\nendobj\n';
  const bad = s.slice(0, off) + marker + s.slice(off + marker.length);
  assert.throws(() => new PDFMini.Doc(asBytes(bad)), /only a classic xref table is supported/);
});

test('an unsupported content-stream filter is refused rather than decoded as garbage', async () => {
  const original = asLatin1(buildPdf());
  // Same token width keeps all xref byte offsets valid.
  const changed = original.replace('/FlateDecode', '/DCTDecode  ');
  const doc = new PDFMini.Doc(asBytes(changed));
  await assert.rejects(() => doc.content(doc.pages()[0]), /unsupported stream filter: DCTDecode/);
});

test('raw stream size is bounded before the stream bytes are trusted', async () => {
  const doc = new PDFMini.Doc(buildPdf({ compress: false, text: 'BT (SAFE) Tj ET' }));
  const was = PDFMini.LIMITS.rawStream;
  PDFMini.LIMITS.rawStream = 1;
  try {
    await assert.rejects(() => doc.content(doc.pages()[0]), /exceeds this app.*limit/);
  } finally {
    PDFMini.LIMITS.rawStream = was;
  }
});

test('combined page content is bounded even when an individual stream is legal', async () => {
  const doc = new PDFMini.Doc(buildPdf({ compress: false, text: 'BT /F1 10 Tf (WPT01) Tj ET' }));
  const was = PDFMini.LIMITS.content;
  PDFMini.LIMITS.content = 4;
  try {
    await assert.rejects(() => doc.content(doc.pages()[0]), /exceeds this app.*limit/);
  } finally {
    PDFMini.LIMITS.content = was;
  }
});

test('a broken page reference resolves safely instead of recursing or inventing a page', () => {
  const s = asLatin1(buildPdf());
  const broken = s.replace('/Kids[3 0 R]', '/Kids[9 0 R]');
  const doc = new PDFMini.Doc(asBytes(broken));
  assert.deepEqual(doc.pages(), []);
});

const jl = require('../jl-pdf.js');
const withTrailer = (s, extra) => s.replace('/Root 1 0 R', '/Root 1 0 R' + extra);

test('an encrypted PDF is refused by name by both readers', () => {
  const s = Buffer.from(buildPdf()).toString('latin1');
  const enc = asBytes(withTrailer(s, '/Encrypt 9 0 R'));
  assert.throws(() => new PDFMini.Doc(enc), /encrypted PDF/);
  assert.throws(() => new jl.Doc(enc), /encrypted PDF/);
});

/* The bug this guards: a cross-reference section's entry count was trusted as
   a loop bound, so a file claiming a billion entries hung the tab walking them. */
test('an xref count larger than the file is rejected instead of walked', () => {
  const s = Buffer.from(buildPdf()).toString('latin1');
  const bad = asBytes(s.replace(/xref\n0 (\d+)/, 'xref\n0 999999999'));
  const t = Date.now();
  assert.throws(() => new PDFMini.Doc(bad), /damaged cross-reference/);
  assert.throws(() => new jl.Doc(bad), /damaged cross-reference/);
  assert.ok(Date.now() - t < 1000);
});

test('wrapMin returns on a non-finite input rather than looping for ever', () => {
  const { wrapMin } = require('../ofp-core.js');
  assert.ok(Number.isNaN(wrapMin(Infinity)));
  assert.ok(Number.isNaN(wrapMin(NaN)));
});
