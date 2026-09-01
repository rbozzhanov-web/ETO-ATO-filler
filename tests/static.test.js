'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PAGES = ['index.html', 'journey-log.html'];
const SCRIPTS = ['pdfmini.js', 'ofp-core.js', 'app.js', 'jl-pdf.js', 'journey-log.js', 'sw.js'];

// Comments say what the code does not do, so a word like innerHTML can appear in
// one. Only the code itself is searched.
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '')
                         .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

/* Structural checks on the shipped files. They are cheap, they run without a
   browser, and each one stands for a way the app has actually been broken:
   markup built out of document text, a script that stopped being loaded, a
   Content-Security-Policy that let inline code back in. */

/* -------------------------------------------------------------- no HTML sinks
   The bug this guards: waypoint names, aerodrome names and NOTAM text read out
   of a PDF were interpolated into innerHTML. A crafted package could then run
   script on this origin and read every flight saved on the device. Nothing that
   parses a string as markup is allowed in this app any more — the DOM helpers
   in app.js write text, and text cannot become an element. */
test('no code parses a string as HTML', () => {
  for (const f of SCRIPTS){
    const src = read(f);
    const code = codeOf(src);
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML',
                        'document.write', 'createContextualFragment'])
      assert.ok(!code.includes(sink), `${f} uses ${sink}`);
  }
});

/* --------------------------------------------------------------------- CSP */
test('each page carries a policy that keeps inline script out', () => {
  for (const f of PAGES){
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read(f));
    assert.ok(m, f + ' has no Content-Security-Policy');
    const csp = m[1];
    const script = /script-src ([^;]+)/.exec(csp);
    assert.ok(script, f + ' sets no script-src');
    assert.ok(!script[1].includes('unsafe-inline'), f + ' allows inline script');
    assert.ok(!script[1].includes('unsafe-eval'), f + ' allows eval');
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'"])
      assert.ok(csp.includes(d), `${f} is missing ${d}`);
    // Nothing in either app talks to the network beyond its own origin.
    assert.match(csp, /connect-src 'self'/);
  }
});

test('no page carries inline script or an inline event handler', () => {
  for (const f of PAGES){
    const src = read(f);
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
      assert.match(m[1], /\ssrc="/, `${f} has an inline <script>`);
      assert.equal(m[2].trim(), '', `${f} has content inside a <script src>`);
    }
    const handler = / on(?:click|load|error|input|change|submit|focus|blur)\s*=/.exec(src);
    assert.equal(handler, null, `${f} has an inline event handler: ${handler && handler[0]}`);
  }
});

/* ------------------------------------------------------- the files hang together */
test('every script a page loads exists and is precached by the worker', () => {
  const sw = read('sw.js');
  const files = /const FILES = \[([\s\S]*?)\];/.exec(sw)[1];
  for (const f of PAGES){
    for (const m of read(f).matchAll(/<script src="([^"]+)"><\/script>/g)){
      const src = m[1];
      assert.ok(fs.existsSync(path.join(ROOT, src)), `${f} loads ${src}, which does not exist`);
      assert.ok(files.includes(`'./${src}'`), `${src} is not in the worker's precache list`);
    }
    assert.ok(files.includes(`'./${f}'`), `${f} is not in the worker's precache list`);
  }
});

test('everything the worker precaches is actually in the repository', () => {
  const files = /const FILES = \[([\s\S]*?)\];/.exec(read('sw.js'))[1];
  for (const m of files.matchAll(/'\.\/([^']*)'/g))
    if (m[1]) assert.ok(fs.existsSync(path.join(ROOT, m[1])), m[1] + ' is precached but missing');
});

test('every script the worker fetches fresh is one a page loads', () => {
  const block = /const SCRIPTS = \[([\s\S]*?)\];/.exec(read('sw.js'))[1];
  const listed = [...block.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  const loaded = new Set();
  for (const f of PAGES)
    for (const m of read(f).matchAll(/<script src="([^"]+)"><\/script>/g)) loaded.add(m[1]);
  assert.deepEqual(listed.slice().sort(), [...loaded].sort());
});

/* ------------------------------------------------------------------ the markup */
test('no page has a duplicate element id', () => {
  for (const f of PAGES){
    const seen = new Set();
    for (const m of read(f).matchAll(/\sid="([^"]+)"/g)){
      assert.ok(!seen.has(m[1]), `${f} has two elements with id "${m[1]}"`);
      seen.add(m[1]);
    }
  }
});

// Moving the code out of the pages is exactly the change that can silently break
// a selector, so every literal id the code reaches for has to be in the markup.
// The three summary tiles are built by render() rather than written in the page.
const BUILT_AT_RUNTIME = { 'app.js': ['stFilled', 'stNext', 'stFuel'], 'journey-log.js': [] };

test('every element the code looks up by id exists in its page', () => {
  const pairs = [['index.html', 'app.js'], ['journey-log.html', 'journey-log.js']];
  for (const [page, script] of pairs){
    const ids = new Set([...read(page).matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    for (const id of BUILT_AT_RUNTIME[script]) ids.add(id);
    const src = read(script);
    const wanted = new Set();
    for (const m of src.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)) wanted.add(m[1]);
    for (const m of src.matchAll(/getElementById\('([A-Za-z][\w-]*)'\)/g)) wanted.add(m[1]);
    for (const id of wanted)
      assert.ok(ids.has(id), `${script} looks for #${id}, which is not in ${page}`);
  }
});

/* ------------------------------------------------------------------ no network */
test('neither app reaches off the device', () => {
  for (const f of [...PAGES, ...SCRIPTS]){
    const src = read(f);
    assert.equal(/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\//i.exec(src.replace(/<!--[\s\S]*?-->/g, '')),
                 null, `${f} names an external URL`);
    assert.ok(!/\bimportScripts\s*\(/.test(src), `${f} imports a script at runtime`);
  }
});

test('every shipped script parses', () => {
  const vm = require('node:vm');
  for (const f of SCRIPTS)
    assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f + ' does not parse');
});
