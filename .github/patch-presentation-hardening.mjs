import fs from 'node:fs';

function read(path){ return fs.readFileSync(path, 'utf8'); }
function write(path, text){ fs.writeFileSync(path, text); }
function once(path, oldText, newText, label){
  const text = read(path);
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match in ${path}, found ${count}`);
  write(path, text.replace(oldText, newText));
}
function append(path, text){ write(path, read(path) + text); }

once('ofp-core.js', `function parseTime(v){
  const d = (v || '').replace(/\\D/g, '');
  if (d.length !== 4) return null;
  const h = +d.slice(0, 2), m = +d.slice(2);
  return (h > 23 || m > 59) ? null : h * 60 + m;
}`, `function parseTime(v){
  const d = String(v ?? '');
  if (!/^\\d{4}$/.test(d)) return null;
  const h = +d.slice(0, 2), m = +d.slice(2);
  return (h > 23 || m > 59) ? null : h * 60 + m;
}`, 'strict OFP HHMM parser');

once('tests/ofp-core.test.js', `  assert.equal(parseTime('0210'), 130);
  assert.equal(parseTime('00:00'), 0);
  assert.equal(parseTime('2359'), 23 * 60 + 59);
  assert.equal(parseTime('2400'), null);   // hour out of range
  assert.equal(parseTime('1260'), null);   // minute out of range
  assert.equal(parseTime('210'), null);    // not four digits
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(undefined), null);`, `  assert.equal(parseTime('0210'), 130);
  assert.equal(parseTime('0000'), 0);
  assert.equal(parseTime('2359'), 23 * 60 + 59);
  assert.equal(parseTime('2400'), null);   // hour out of range
  assert.equal(parseTime('1260'), null);   // minute out of range
  assert.equal(parseTime('210'), null);    // not four digits
  assert.equal(parseTime('00:00'), null);  // punctuation is never stripped/guessed
  assert.equal(parseTime('02 10'), null);
  assert.equal(parseTime('0210Z'), null);
  assert.equal(parseTime('ab0210'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(undefined), null);`, 'OFP HHMM regression expectations');

once('journey-log.js', `let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    try{
      localStorage.setItem(KEY, JSON.stringify(doc));
    }catch(e){ say('There is no room left on the device to save this.', 'err'); }
  }, 250);
}`, `let saveTimer = null;
function saveNow(){
  clearTimeout(saveTimer); saveTimer = null;
  try{
    localStorage.setItem(KEY, JSON.stringify(doc));
    return true;
  }catch(e){
    say('There is no room left on the device to save this.', 'err');
    return false;
  }
}
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
function flushSave(){ if(saveTimer) saveNow(); }
// iPadOS can freeze or evict a backgrounded Home Screen app quickly. Flush the
// last debounced keystrokes before the page is hidden so lock, app switching or
// a PWA restart cannot lose the final entry.
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) flushSave(); });`, 'Journey Log lifecycle save flush');

once('journey-log.js', `      const value = el.tagName === 'INPUT' ? el.value.trim() : el.textContent.trim();
      if(!value) return;
      const { x, y, size } = exportPlacement({`, `      const value = el.tagName === 'INPUT' ? el.value.trim() : el.textContent.trim();
      if(!value) return;
      if(el.dataset.time && !isTimeEntry(value))
        throw new Error('invalid Journey Log time field: ' + (el.dataset.path || 'unknown'));
      const { x, y, size } = exportPlacement({`, 'defensive Journey Log export validation');

once('journey-log.js', `async function exportPdf(){
  if(document.activeElement) document.activeElement.blur();
  const button = document.getElementById('export');`, `async function exportPdf(){
  if(document.activeElement) document.activeElement.blur();
  if(!validateTimesForExport()) return;
  const button = document.getElementById('export');`, 'block Journey Log export on invalid time');

once('journey-log.js', `function toMinutes(s){
  const m = /^\\s*(\\d{1,2}):?(\\d{2})\\s*$/.exec(s || '');
  if(!m) return null;
  const h = +m[1], mi = +m[2];
  return (h > 23 || mi > 59) ? null : h*60 + mi;
}
function fromMinutes(n){
  n = ((n % 1440) + 1440) % 1440;
  return String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0');
}
function span(from, to){
  const a = toMinutes(from), b = toMinutes(to);
  if(a == null || b == null) return '';
  return fromMinutes(b - a);
}`, `function toMinutes(s){
  const m = /^\\s*(?:(\\d{2})(\\d{2})|(\\d{2}):(\\d{2}))\\s*$/.exec(s || '');
  if(!m) return null;
  const h = +(m[1] ?? m[3]), mi = +(m[2] ?? m[4]);
  return (h > 23 || mi > 59) ? null : h*60 + mi;
}
function fromMinutes(n){
  n = ((n % 1440) + 1440) % 1440;
  return String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0');
}
function span(from, to){
  const a = toMinutes(from), b = toMinutes(to);
  if(a == null || b == null) return '';
  return fromMinutes(b - a);
}
function isTimeEntry(v){
  const s = String(v ?? '').trim();
  if(!s) return true;
  return (/^\\d{4}$/.test(s) || /^\\d{2}:\\d{2}$/.test(s)) && toMinutes(s) != null;
}
function setTimeInvalid(t, bad){
  t.toggleAttribute('aria-invalid', !!bad);
  t.classList.toggle('badtime', !!bad);
}
function previewTimeField(t){
  const s = t.value.trim();
  const complete = /^\\d{4,}$/.test(s) || s.includes(':');
  setTimeInvalid(t, !!s && complete && !isTimeEntry(s));
}
function normalizeTimeField(t){
  const s = t.value.trim();
  if(!s){ setTimeInvalid(t, false); return true; }
  if(/^\\d{4}$/.test(s) && toMinutes(s) != null){
    const v = s.slice(0,2) + ':' + s.slice(2);
    t.value = v;
    set(t.dataset.path, v);
    setTimeInvalid(t, false);
    return true;
  }
  const ok = /^\\d{2}:\\d{2}$/.test(s) && toMinutes(s) != null;
  setTimeInvalid(t, !ok);
  return ok;
}
function validateTimesForExport(){
  const fields = [...stage.querySelectorAll('input[data-time]:not([readonly])')];
  const bad = fields.find(t => !normalizeTimeField(t));
  if(!bad){ refreshDerived(); saveNow(); return true; }
  bad.focus(); bad.select();
  say('Fix the highlighted time before export. Enter HHMM from 0000 to 2359.', 'err');
  return false;
}`, 'strict Journey Log time helpers');

once('journey-log.js', `  const path = t.dataset.path;
  set(path, t.value);
  if(derived.has(path)){`, `  const path = t.dataset.path;
  set(path, t.value);
  if(t.dataset.time) previewTimeField(t);
  if(derived.has(path)){`, 'live Journey Log time validity');

once('journey-log.js', `stage.addEventListener('change', e=>{
  const t = e.target;
  if(t.tagName !== 'INPUT' || !t.dataset.time) return;
  const m = /^\\s*(\\d{3,4})\\s*$/.exec(t.value);
  if(m){
    const raw = m[1].padStart(4,'0');
    const v = raw.slice(0,2) + ':' + raw.slice(2);
    if(toMinutes(v) != null){
      t.value = v; set(t.dataset.path, v); refreshDerived(); save();
    }
  }
});`, `stage.addEventListener('change', e=>{
  const t = e.target;
  if(t.tagName !== 'INPUT' || !t.dataset.time) return;
  normalizeTimeField(t);
  refreshDerived();
  save();
});`, 'Journey Log change normalization');

once('journey-log.js', `  applyZoom();
  refreshDerived();
  fitAll(stage);`, `  applyZoom();
  refreshDerived();
  stage.querySelectorAll('input[data-time]:not([readonly])').forEach(t => {
    if(t.value.trim()) setTimeInvalid(t, !isTimeEntry(t.value));
  });
  fitAll(stage);`, 'persisted Journey Log invalid-state rendering');

once('journey-log.html', `input.fill:focus{background:var(--fill-focus); box-shadow:inset 0 0 0 .75pt var(--accent)}
/* Blk and Flt are worked out`, `input.fill:focus{background:var(--fill-focus); box-shadow:inset 0 0 0 .75pt var(--accent)}
input.fill.badtime,input.fill[aria-invalid=true]{
  background:rgba(248,81,73,.12); box-shadow:inset 0 0 0 1.2pt var(--err)
}
/* Blk and Flt are worked out`, 'Journey Log invalid-time style');

once('journey-log.html', `<h1>Journey Log <span class="buildbadge" id="buildBadge">RC 1.3 · TEST · Build 20260902.2</span></h1>`, `<h1>Journey Log <span>Electronic filling tool</span> <span class="buildbadge" id="buildBadge">RC 1.3 · TEST · Build 20260902.3</span></h1>`, 'Journey Log scope title/build');

once('journey-log.html', `    <p class="disc"><span>Only Air Astana Journey Logs are supported.</span></p>`, `    <p class="disc"><span><b>Purpose:</b> electronic filling and formatting of the issued Journey Log only. This tool does not replace the approved OFP, SOP, current flight-information sources or airline-approved EFB applications.</span></p>
    <p class="disc"><span>Only Air Astana Journey Logs are supported.</span></p>`, 'Journey Log purpose notice');

once('index.html', `<div class="sub">Operational flight plan — in flight</div>
      <div class="buildbadge" id="buildBadge">RC 1.3 · TEST · Build 20260902.2</div>`, `<div class="sub">Electronic OFP / Journey Log filling tool</div>
      <div class="buildbadge" id="buildBadge">RC 1.3 · TEST · Build 20260902.3</div>`, 'OFP scope subtitle/build');

once('index.html', `  <div class="msg" id="mUpd"></div>

  <div class="card">`, `  <div class="msg" id="mUpd"></div>
  <div class="scopeNotice" role="note"><b>Purpose:</b> electronic filling and formatting of OFP / Journey Log only. This app does not replace the issued or approved OFP, SOP, current flight-information sources, or airline-approved EFB applications. Weather, NOTAM and chart views only reproduce information from the loaded package and are not an operational decision source.</div>

  <div class="card">`, 'OFP permanent purpose notice');

once('index.html', `.buildbadge{display:inline-flex;align-items:center;margin-top:5px;padding:2px 7px;
  border:1px solid var(--warn);border-radius:999px;color:var(--warn);
  font:700 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  letter-spacing:.35px;text-transform:uppercase;white-space:nowrap}`, `.buildbadge{display:inline-flex;align-items:center;margin-top:5px;padding:2px 7px;
  border:1px solid var(--warn);border-radius:999px;color:var(--warn);
  font:700 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  letter-spacing:.35px;text-transform:uppercase;white-space:nowrap}
.scopeNotice{margin:-6px 0 18px;padding:10px 12px;border:1px solid var(--warn);border-radius:8px;
  background:var(--panel);color:var(--dim);font-size:12.5px;line-height:1.45}
.scopeNotice b{color:var(--txt)}`, 'OFP purpose notice style');

once('index.html', `      <h3>Install once</h3>`, `      <h3>Operational scope</h3>
      <p><b>This is an electronic OFP / Journey Log filling and formatting tool only.</b>
      It does not replace the issued or approved OFP, SOP, current flight-information sources,
      or airline-approved EFB applications. Weather, NOTAM and chart views duplicate information
      from the loaded package for document navigation only and must not be used as the source for
      operational decisions.</p>

      <h3>Install once</h3>`, 'User guide operational scope');

once('index.html', `<span class="build">RC1.3 &nbsp;·&nbsp; published 1 Sep 2026</span>`, `<span class="build">RC1.3 TEST &nbsp;·&nbsp; Build 20260902.3 &nbsp;·&nbsp; 2 Sep 2026</span>`, 'User guide build marker');

once('sw.js', `const V = CACHE_PREFIX + 'rc1.3-test-20260902.2';`, `const V = CACHE_PREFIX + 'rc1.3-test-20260902.3';`, 'service-worker cache bump');

once('README.md', `The app is fully self-contained: the PDF is parsed and written on the device.
Nothing is uploaded anywhere, and after installation nothing is fetched either.
Everything flies with the radios off.

Requires iPadOS 16.4 or newer`, `The app is fully self-contained: the PDF is parsed and written on the device.
Nothing is uploaded anywhere, and after installation nothing is fetched either.
Everything flies with the radios off.

## Operational scope

> Приложение предназначено исключительно для заполнения и оформления OFP/Journey Log. Оно не заменяет утверждённые источники полётной информации, OFP, SOP и одобренные приложения авиакомпании.

**English:** This application is only an electronic tool for filling and formatting OFP / Journey Log. It is not an approved source of flight information and does not replace the issued/approved OFP, SOP, current operational sources or airline-approved EFB applications.

Weather, NOTAM and chart views only duplicate information already carried by the loaded package. They are document-navigation conveniences, not live data and not a source for operational decisions. Until the real-document, physical-iPad and shadow-flight gates in \`RELEASE_CHECKLIST.md\` are complete, describe the build as a working prototype / candidate for a controlled pilot rather than a verified production tool.

Requires iPadOS 16.4 or newer`, 'README operational scope');

once('README.md', `## Weather and NOTAMs

A card at the bottom shows`, `## Weather and NOTAMs

**Document-view convenience only.** This section does not provide live operational information and no highlight is an approved decision aid. The authoritative source remains the airline-approved briefing / EFB process.

A card at the bottom shows`, 'README weather framing');

append('tests/journey-log-edge-cases.test.js', `

test('Journey Log rejects malformed or out-of-range times before PDF export', () => {
  assert.match(app, /function validateTimesForExport\\(\\)/);
  assert.match(app, /if\\(!validateTimesForExport\\(\\)\\) return;/);
  assert.match(app, /invalid Journey Log time field/);
  assert.match(app, /aria-invalid/);
  assert.doesNotMatch(app, /\\\\d\\{3,4\\}/);
  assert.doesNotMatch(app, /padStart\\(4,'0'\\)/);
});

test('Journey Log flushes pending form state before iPadOS can freeze the page', () => {
  assert.match(app, /addEventListener\\('pagehide', flushSave\\)/);
  assert.match(app, /visibilitychange[\\s\\S]*?document\\.hidden[\\s\\S]*?flushSave/);
});
`);

once('tests/smoke/run.mjs', `    check(await page.evaluate(() => fmt(parseTime('0210') + 205)) === '0535',
          'the ETO arithmetic runs in the browser');`, `    check(await page.evaluate(() => fmt(parseTime('0210') + 205)) === '0535',
          'the ETO arithmetic runs in the browser');
    check(await page.evaluate(() => parseTime('02:10') === null && parseTime('0210Z') === null),
          'OFP time input is strict four-digit HHMM');`, 'OFP browser strict-time smoke');

once('tests/smoke/run.mjs', `    check(await page.evaluate(() => typeof exportOps === 'function'), 'journey-log.js ran');

    // The fix this stands over`, `    check(await page.evaluate(() => typeof exportOps === 'function'), 'journey-log.js ran');
    check(await page.evaluate(() => toMinutes('0340') === 220 && toMinutes('03:40') === 220 &&
                                   toMinutes('340') === null && toMinutes('2460') === null),
          'Journey Log accepts only valid four-digit HHMM / formatted HH:MM');

    // The fix this stands over`, 'Journey Log browser strict-time smoke');

console.log('presentation hardening patch applied');
