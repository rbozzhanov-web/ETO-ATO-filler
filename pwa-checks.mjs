import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const index = read('index.html');
const journey = read('journey-log.html');
const worker = read('sw.js');

function scriptsIn(html){
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
}

function checkHtml(name, html){
  const scripts = scriptsIn(html);
  assert.ok(scripts.length, `${name} must contain JavaScript`);
  scripts.forEach((source, i) => new vm.Script(source, { filename: `${name}#script-${i + 1}` }));

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(duplicates)], [], `${name} has duplicate static IDs`);

  assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=/i, `${name} must not use inline event attributes`);
  assert.match(html, /Content-Security-Policy[^>]+connect-src 'self'/, `${name} must restrict connections`);
  assert.match(html, /Content-Security-Policy[^>]+object-src 'none'/, `${name} must block plug-ins`);
  assert.match(html, /Content-Security-Policy[^>]+base-uri 'none'/, `${name} must block base-tag injection`);

  for (const button of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)){
    const attrs = button[1];
    const body = button[2]
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
    const hidden = /aria-hidden="true"/i.test(attrs);
    assert.ok(body || /aria-label="[^"]+"/i.test(attrs) || hidden,
      `${name} has an unlabelled button: ${button[0].slice(0, 100)}`);
  }
}

checkHtml('index.html', index);
checkHtml('journey-log.html', journey);
new vm.Script(worker, { filename: 'sw.js' });
JSON.parse(read('manifest.webmanifest'));

assert.match(index, /crypto\.subtle\.digest\('SHA-256'/, 'OFP state must use a SHA-256 document identity');
assert.match(index, /KEY = 'etofill:sha256:' \+ hash/, 'OFP state key must use the document hash');
assert.match(index, /calculate\(false\)/, 'restoring a session must preserve acknowledged alerts');
assert.match(index, /\.stats\{[^}]*position:sticky[^}]*top:var\(--topgap\)/,
  'live stats must remain sticky below the iPad safe-area inset');
assert.match(index, /id="fplHead" aria-expanded="true" aria-controls="fplText"/,
  'the ICAO plan must have an accessible collapse control');
assert.match(index, /id="c4Head" aria-expanded="true" aria-controls="fields"/,
  'the document fields must have an accessible collapse control');
assert.match(index, /id="tableDetails" aria-controls="tbl" aria-expanded="false"/,
  'compact table details must be available on a narrow iPad');
assert.match(index, /#tbl:not\(\.show-details\) \.detail-col\{display:none\}/,
  'secondary table columns must collapse on a narrow iPad');
assert.doesNotMatch(index, /<td>\$\{p\.wp\}/, 'waypoints must not be interpolated into table HTML');
assert.doesNotMatch(index, /tag\.innerHTML\s*=[\s\S]{0,200}c\.wp\.wp/, 'waypoints must not be interpolated into alert HTML');
assert.doesNotMatch(index, /chip\.innerHTML\s*=[\s\S]{0,200}p\.wp/, 'waypoints must not be interpolated into DIRECT HTML');
assert.match(index, /id="drop" role="button" tabindex="0"/, 'the OFP file picker must be keyboard reachable');

const hashSource = index.match(/async function documentHash\(buf\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(hashSource, 'documentHash implementation must be present');
const hashContext = { crypto: webcrypto, Uint8Array, ArrayBuffer };
vm.runInNewContext(hashSource, hashContext);
assert.equal(await hashContext.documentHash(new TextEncoder().encode('abc').buffer),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'documentHash must compute the standard SHA-256 digest');

assert.match(journey, /const next = emptyDoc\(\)/, 'Journey Log must parse into a replacement document');
assert.match(journey, /next\.fileName = file\.name/, 'Journey Log must update the filename only after parsing');
assert.match(journey, /id="drop" role="button" tabindex="0"/, 'the Journey Log picker must be keyboard reachable');

// Exercise the service worker in a small fake origin. It must leave unrelated
// caches alone and fall back to cached HTML on a failed navigation response.
const listeners = {};
const deleted = [];
const writes = [];
const cachedPage = new Response('cached OFP', { status: 200 });
const context = {
  URL, Response, Promise, setTimeout, clearTimeout,
  fetch: async () => new Response('server error', { status: 500 }),
  caches: {
    keys: async () => ['eto-filler-v50.3', 'ofp-companion-v50.3',
                       'ofp-companion-v50.4', 'another-pages-app-v9'],
    delete: async key => { deleted.push(key); return true; },
    match: async key => key === './index.html' ? cachedPage.clone() : undefined,
    open: async () => ({
      addAll: async () => {},
      put: async (key, value) => { writes.push([key, value.status]); }
    })
  },
  self: {
    location: { origin: 'https://example.test' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, handler) => { listeners[type] = handler; }
  }
};
vm.runInNewContext(worker, context, { filename: 'sw.js' });

let activation;
listeners.activate({ waitUntil: promise => { activation = promise; } });
await activation;
assert.deepEqual(deleted, ['eto-filler-v50.3', 'ofp-companion-v50.3', 'ofp-companion-v50.4'],
  'activation may delete only old OFP Companion caches');

let navigation;
listeners.fetch({
  request: { method: 'GET', mode: 'navigate', url: 'https://example.test/index.html' },
  respondWith: promise => { navigation = promise; }
});
const fallback = await navigation;
assert.equal(await fallback.text(), 'cached OFP', 'a 500 navigation must fall back to cached HTML');
assert.deepEqual(writes, [], 'a failed response must not replace a good cached page');

context.fetch = async () => { throw new Error('offline'); };
let asset;
listeners.fetch({
  request: { method: 'GET', mode: 'same-origin', url: 'https://example.test/missing.png' },
  respondWith: promise => { asset = promise; }
});
assert.equal((await asset).status, 0, 'a missing asset must return a network error, not an HTML page');

console.log('PWA checks passed');
