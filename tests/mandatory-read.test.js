'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFMini = require('../pdfmini.js');
const { manPage, mandatoryReads } = require('../ofp-core.js');
const { buildPages, manPageContent, PAGE1, PAGE2 } = require('./helpers/make-pages-pdf.js');

/* Mandatory reads are opened as the PDF itself; what is tested here is that
   their pages are found and grouped, and that one page can be cut out to show.
   The fixture is a two-page document set the way Air Astana sets one (see
   make-pages-pdf.js). */
const pdf = () => buildPages([
  'BT /F1 10 Tf 50 700 Td (WPT01 FL350 0 1234) Tj ET\n',          // a plan page, not a read
  manPageContent(PAGE1),
  manPageContent(PAGE2) ]);

async function readAll(bytes){
  const doc = new PDFMini.Doc(bytes), pages = doc.pages(), found = [];
  for (let p = 0; p < pages.length; p++){
    const r = manPage(PDFMini.textItems(await doc.content(pages[p])), p);
    if (r) found.push(r);
  }
  return { doc, found, reads: mandatoryReads(found) };
}

test('both pages of a mandatory read are found by their head and foot', async () => {
  const { found, reads } = await readAll(pdf());
  assert.deepEqual(found.map(r => [r.man, r.page, r.first]), [['123-24', 1, true], ['123-24', 2, false]]);
  assert.equal(reads.length, 1);
  const m = reads[0];
  assert.deepEqual([m.man, m.issue, m.rev, m.subject, m.applic, m.pages],
                   ['123-24', '2', '1', 'ACARS LOGON PROCEDURE', 'A320 FLEET', [1, 2]]);
});

test('a document left without its MANDATORY READ title is not listed', async () => {
  const doc = new PDFMini.Doc(buildPages([manPageContent(PAGE2)]));
  const r = manPage(PDFMini.textItems(await doc.content(doc.pages()[0])), 0);
  assert.equal(r.man, '123-24', 'its page is still recognised');
  assert.deepEqual(mandatoryReads([r]), [], 'but a continuation page alone is no document');
});

test('a page is cut out as a PDF of its own, the original bytes untouched', async () => {
  const bytes = pdf();
  const { doc } = await readAll(bytes);
  const one = PDFMini.pagePdf(doc, 2);
  assert.deepEqual(one.subarray(0, bytes.length), bytes, 'the original is a prefix of the copy');
  const again = new PDFMini.Doc(one);
  assert.equal(again.pages().length, 1);
  const items = PDFMini.textItems(await again.content(again.pages()[0]));
  assert.ok(items.some(i => i.str.startsWith('PROCEDURE')), 'and it is page 3 that it shows');
});

test('a plan with no mandatory read has none', async () => {
  const doc = new PDFMini.Doc(buildPages(['BT /F1 10 Tf 50 700 Td (WPT01) Tj ET\n']));
  assert.equal(manPage(PDFMini.textItems(await doc.content(doc.pages()[0])), 0), null);
  assert.deepEqual(mandatoryReads([]), []);
});
