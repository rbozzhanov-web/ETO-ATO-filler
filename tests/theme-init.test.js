'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'theme-init.js'), 'utf8');

/* Just enough of a page for theme-init.js, which runs in the <head> before
   anything is drawn: the root element's attributes, the two metas it updates,
   the stored theme, the device's appearance, and how the page was reached. */
function run({ theme = null, light = false, standalone = true, type = 'navigate', referrer = '',
               flight = false, path: pathname = '/ETO-ATO-filler/index.html' } = {}){
  const attrs = new Map(), metas = { 'theme-color': '#0f1419', 'color-scheme': 'dark' };
  const frames = [], dcl = [];
  const root = {
    setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: k => attrs.has(k) ? attrs.get(k) : null,
    hasAttribute: k => attrs.has(k), removeAttribute: k => attrs.delete(k), style: {}
  };
  const store = new Map(Object.entries({ ...(theme ? { 'etofill:theme': theme } : {}),
                                         ...(flight ? { 'etofill:last': '{}' } : {}) }));
  const win = {
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null },
    matchMedia: q => ({ matches: q.includes('light') ? light : q.includes('standalone') ? standalone : false }),
    navigator: {},
    performance: { getEntriesByType: () => [{ type }] },
    location: { origin: 'https://example.test', pathname },
    requestAnimationFrame: fn => frames.push(fn),
    document: {
      documentElement: root, referrer,
      querySelector: sel => { const m = /meta\[name=([\w-]+)\]/.exec(sel); return m && {
        setAttribute: (_, v) => { metas[m[1]] = v; } }; },
      addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') dcl.push(fn); }
    }
  };
  win.window = win; win.self = win; win.top = win;
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return {
    attrs, metas, win,
    loaded(){ dcl.forEach(fn => fn()); },
    frame(){ const due = frames.splice(0); due.forEach(fn => fn()); }
  };
}

test('the theme, the browser’s page colour and the colour scheme are set before the first frame', () => {
  const light = run({ theme: 'light' });
  assert.equal(light.attrs.get('data-theme'), 'light');
  assert.equal(light.metas['theme-color'], '#f2f5f8');
  assert.equal(light.metas['color-scheme'], 'light');
  const dark = run({ theme: 'dark', light: true });
  assert.equal(dark.attrs.has('data-theme'), false, 'dark is the markup’s own');
  assert.equal(dark.metas['color-scheme'], 'dark', 'pickers and menus drawn dark');
  assert.equal(run({ light: true }).metas['color-scheme'], 'light', 'no choice made: the iPad’s appearance');
});

/* The bug this guards: a cold start of the installed app went from iPadOS's
   dark launch screen straight to the page — in the light theme, at night, a
   bright page switched on at once in a dark cockpit. The page comes up out of
   the launch screen's dark now, and only where there was a launch screen. */
test('only a cold start of the installed app comes up out of the launch screen’s dark', () => {
  assert.equal(run().attrs.get('data-launch'), '', 'a cold start');
  assert.equal(run({ type: 'reload' }).attrs.has('data-launch'), false, 'a reload has no launch screen');
  assert.equal(run({ referrer: 'https://example.test/ETO-ATO-filler/journey-log.html' }).attrs.has('data-launch'),
               false, 'nor a crossing from the Journey Log');
  assert.equal(run({ standalone: false }).attrs.has('data-launch'), false, 'nor a Safari tab');
});

test('the cover is lifted only once a frame has been drawn, and not while a flight is being reopened', () => {
  const page = run();
  page.loaded();
  assert.equal(page.attrs.get('data-launch'), '', 'not at load itself');
  page.frame();
  assert.equal(page.attrs.get('data-launch'), '', 'nor on the first frame, which shows the cover');
  page.frame();
  assert.equal(page.attrs.get('data-launch'), 'out', 'the fade runs from the next');

  const reopening = run({ flight: true });
  assert.equal(reopening.attrs.get('data-resuming'), '');
  reopening.loaded(); reopening.frame(); reopening.frame();
  assert.equal(reopening.attrs.get('data-launch'), '', 'held while the flight is still being reopened');
  reopening.attrs.delete('data-resuming');
  reopening.win.liftLaunch();                         // what app.js does once the flight is back
  reopening.frame(); reopening.frame();
  assert.equal(reopening.attrs.get('data-launch'), 'out');
});
