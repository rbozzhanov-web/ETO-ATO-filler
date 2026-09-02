"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const JL = fs.readFileSync(path.join(__dirname, '..', 'journey-log.js'), 'utf8');

test('OFP parse and clipboard failures are actionable without exposing raw exceptions', () => {
  assert.match(APP, /This PDF could not be read as a supported flight-plan package\. Try another OFP PDF\./);
  assert.match(APP, /No PDF was found on the clipboard\. Use the box above to pick the file\./);
  assert.match(APP, /The clipboard could not be read\. Use the box above to pick the file instead\./);
  assert.match(APP, /console\.error\('OFP parse failed:', err\)/);
  assert.match(APP, /console\.warn\('Clipboard read failed:', err\)/);
  assert.doesNotMatch(APP, /Could not parse the document: ['"]?\s*\+\s*err\.message/);
  assert.doesNotMatch(APP, /it offered:/);
});

test('browser support errors state the supported version instead of an API implementation detail', () => {
  assert.match(APP, /OFP Companion requires Safari\/iPadOS 16\.4 or later/);
  assert.match(JL, /Journey Log requires Safari\/iPadOS 16\.4 or later/);
  assert.doesNotMatch(APP, /Browser too old: no DecompressionStream/);
  assert.doesNotMatch(JL, /Browser too old: no DecompressionStream/);
});

test('OFP save and preview failures give the next useful action', () => {
  assert.match(APP, /The completed OFP PDF could not be saved\. Try Save PDF again\./);
  assert.match(APP, /The PDF preview could not be opened\. Use Save PDF instead\./);
  assert.match(APP, /console\.error\('OFP PDF save failed:', e\)/);
  assert.match(APP, /console\.error\('OFP PDF preview failed:', e\)/);
  assert.doesNotMatch(APP, /'Error: ' \+ e\.message/);
});

test('Journey Log read and export failures stay user-readable while diagnostics remain internal', () => {
  assert.match(JL, /This PDF could not be read as a supported Journey Log\. Choose the issued Journey Log PDF and try again\./);
  assert.match(JL, /The completed PDF could not be exported\. Try Export PDF again\./);
  assert.match(JL, /console\.error\('Journey Log PDF read failed:', err\)/);
  assert.match(JL, /console\.error\('Journey Log export failed:', err\)/);
  assert.doesNotMatch(JL, /Could not export the PDF: ['"]?\s*\+/);
  assert.doesNotMatch(JL, /Could not read it: ['"]?\s*\+/);
});
