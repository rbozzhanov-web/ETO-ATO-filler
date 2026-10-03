'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFMini = require('../pdfmini.js');
const { manPage, mandatoryReads } = require('../ofp-core.js');
const { buildPages, manPageContent, PAGE1, PAGE2 } = require('./helpers/make-pages-pdf.js');

/* Mandatory reads, ported from the OFP viewer. The fixture is a two-page
   document set the way Air Astana sets one (see make-pages-pdf.js). */
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

test('its lines come back as paragraphs, headings and bullets, to the last page', async () => {
  const { reads } = await readAll(pdf());
  const paras = reads[0].paras;
  const kinds = paras.map(q => q.kind);
  assert.equal(paras[0].kind, 'p');
  assert.match(paras[0].text, /^Crews shall log on .* available to the operator\.$/, 'two lines, one paragraph');
  assert.ok(paras.some(q => q.kind === 'p' && q.text.includes('“LOGON ACCEPTED”')),
            'WinAnsi quotes come back as quotes');
  assert.deepEqual(paras.filter(q => q.kind === 'li').map(q => q.text),
    ['Check the flight number entered in the INIT page', 'Check the departure and destination codes']);
  assert.ok(paras.some(q => q.kind === 'h' && q.text === 'PROCEDURE'), 'the heading on page 2');
  assert.ok(paras.some(q => /voice clearance as the primary means\.$/.test(q.text || '')),
            'the second page is read, not dropped');
  assert.ok(!paras.some(q => /Chief Pilot|Issued By/.test(q.text || '')), 'the sign-off is left to the PDF');
  assert.ok(kinds.includes('lost'));
});

test('a pointer at a picture, and an undecodable line, link to their page', async () => {
  const { reads } = await readAll(pdf());
  const paras = reads[0].paras;
  const pic = paras.find(q => /picture below/.test(q.text || ''));
  assert.equal(pic.ref, 1);
  assert.deepEqual(paras.find(q => q.kind === 'lost'), { kind: 'lost', page: 1 });
  assert.equal(paras[0].ref, undefined, 'plain prose carries no link');
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
