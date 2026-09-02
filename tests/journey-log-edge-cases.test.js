'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jl = require('../jl-pdf.js');
const { buildPdf } = require('./helpers/make-pdf.js');

const PAGE_W = 841.89, PAGE_H = 595.28;
const app = fs.readFileSync(path.join(__dirname, '..', 'journey-log.js'), 'utf8');

function placement(scale, left, top){
  const px = pt => pt * 4 / 3 * scale;
  return jl.exportPlacement({
    sheetRect: { left, top, width: px(PAGE_W), height: px(PAGE_H) },
    rect: { left: left + px(125), top: top + px(72), width: px(80), height: px(14) },
    fontPx: 11, length: 12, alignLeft: false, pageW: PAGE_W, pageH: PAGE_H,
  });
}

test('export placement survives a portrait/landscape refit without moving on the PDF', () => {
  const portraitFit = placement(0.55, 17, 64);
  const landscapeFit = placement(1.15, 103, 12);
  for (const k of ['x', 'y', 'size'])
    assert.ok(Math.abs(portraitFit[k] - landscapeFit[k]) < 0.001,
              `${k} moved after viewport refit`);
});

test('long entered text is escaped safely into the incremental PDF stream', async () => {
  const value = 'CAPT (TEST) \\ LONG — VALUE';
  const doc = new jl.Doc(buildPdf());
  const ops = new jl.PdfOps().text('JL', 7.5, 40, 50, value, [0, 0, 1]);
  const out = jl.appendPdf(doc, new Map([[0, ops]]));
  const again = new jl.Doc(out);
  const content = await again.content(again.pages()[0]);
  assert.ok(content.includes('\\(TEST\\)'), 'parentheses stay escaped in the PDF string');
  assert.ok(content.includes('\\\\ LONG - VALUE'), 'backslash stays escaped and em dash degrades safely');
});

test('characters outside the PDF writer encoding degrade predictably instead of corrupting syntax', () => {
  const ops = new jl.PdfOps().text('JL', 8, 1, 2, 'ABC ✈ DEF', [0, 0, 1]).done();
  assert.match(ops, /\(ABC \? DEF\) Tj/);
});

test('blank editable fields are deliberately omitted from export', () => {
  assert.match(app, /const value = el\.tagName === 'INPUT' \? el\.value\.trim\(\) : el\.textContent\.trim\(\);[\s\S]*?if\(!value\) return;/);
});

test('every writable Journey Log cell joins the common Enter navigation order', () => {
  assert.match(app, /if\(opt\.pre\)\{ inp\.readOnly = true; inp\.tabIndex = -1; \}[\s\S]*?else inputs\.push\(inp\);/);
  assert.match(app, /stage\.addEventListener\('keydown',[\s\S]*?if\(e\.key !== 'Enter'\) return;[\s\S]*?inputs\.indexOf\(t\)[\s\S]*?e\.shiftKey \? -1 : 1/);
});

test('numeric Journey Log cells use the custom keypad and expose Next navigation', () => {
  assert.match(app, /if\(opt\.numeric\)\{ inp\.inputMode = 'none'; inp\.classList\.add\('numkey'\); inp\.enterKeyHint = 'next'; \}/);
  assert.match(app, /numpadDone[\s\S]*?KeyboardEvent\('keydown', \{ key: 'Enter'/);
});

test('export walks all sheets and all writable input/contenteditable fields', () => {
  assert.match(app, /stage\.querySelectorAll\('\.sheet'\)\.forEach\(\(sheet, pi\) =>/);
  assert.match(app, /sheet\.querySelectorAll\('input\.fill, \.ed:not\(\.pre\)'\)/);
});
