/* Browser smoke test.

   The unit tests above run the code without a browser; this one runs the app as
   a crew gets it — served over HTTP, parsed by a real engine, under the real
   Content-Security-Policy. It is what catches a page that stopped loading one of
   its scripts, a policy that blocks its own code, or a selector that no longer
   matches anything, none of which a Node test can see.

   Run:  node tests/smoke/run.mjs      (needs playwright; see .github/workflows)
   Set SMOKE_BROWSER=webkit to exercise the WebKit/iPad-like path. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium, webkit } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const require = createRequire(import.meta.url);
const { buildPdf } = require('../helpers/make-pdf.js');
const PDFMini = require('../../pdfmini.js');

// A minimal OFP the real parser accepts: an ETO/ATO header, then per waypoint an
// ETO line (name ... ET) and an ATO line (... T/T REM), each ending in the four
// dots the ETO and ATO boxes are found by.
function ofpPdf(ets){
  return [...buildPdf({ text: ofpText(ets), compress: false })];
}
function ofpText(ets){
  let t = 'BT /F1 10 Tf 50 720 Td (WPT  FL   ET  ETO) Tj ET\nBT /F1 10 Tf 480 720 Td (ATO) Tj ET\n';
  let y = 700, cum = 0;
  ets.forEach((et, k) => {
    cum += et;
    const tt = Math.floor(cum / 60) + '.' + String(cum % 60).padStart(2, '0');
    t += `BT /F1 10 Tf 50 ${y} Td (W${k}XX FL350 ${et} 1234) Tj ET\nBT /F1 10 Tf 470 ${y} Td (....) Tj ET\n`;
    t += `BT /F1 10 Tf 50 ${y - 12} Td (AA BB ${tt} ${30000 - cum * 50}) Tj ET\n`
       + `BT /F1 10 Tf 470 ${y - 12} Td (....) Tj ET\n`;
    y -= 30;
  });
  return t;
}
const { buildPages, manPageContent, PAGE1, PAGE2 } = require('../helpers/make-pages-pdf.js');

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); else console.log('  ok  ' + what); };

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const engineName = process.env.SMOKE_BROWSER || 'chromium';
const engines = { chromium, webkit };
const engine = engines[engineName];
if (!engine) throw new Error(`Unknown SMOKE_BROWSER: ${engineName}`);

// CI installs its own browser. A sandbox with one already in place can point at
// it instead of downloading a second copy.
const executablePath = engineName === 'webkit'
  ? process.env.PLAYWRIGHT_WEBKIT_PATH
  : process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await engine.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext(engineName === 'webkit' ? {
  viewport: { width: 1024, height: 1366 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
} : {});
console.log(`browser smoke: ${engineName}`);

async function open(url){
  const page = await context.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.goto(base + url, { waitUntil: 'networkidle' });
  return { page, problems };
}

try {
  /* ---- the OFP companion ---- */
  {
    const { page, problems } = await open('index.html');
    check(problems.length === 0, 'index.html loads without console errors' +
          (problems.length ? ': ' + problems.join(' | ') : ''));
    check(await page.title() === 'OFP Companion', 'index.html has its title');

    // The code is in external files now: if the policy or a path were wrong the
    // page would render and do nothing at all, so ask the app itself.
    check(await page.evaluate(() => typeof PDFMini === 'object'), 'pdfmini.js ran');
    check(await page.evaluate(() => typeof computeResult === 'function'), 'ofp-core.js ran');
    check(await page.evaluate(() => typeof loadBuffer === 'function'), 'app.js ran');

    // and that the arithmetic in the browser agrees with the arithmetic in the tests
    check(await page.evaluate(() => fmt(parseTime('0210') + 205)) === '0535',
          'the ETO arithmetic runs in the browser');
    check(await page.evaluate(() => parseTime('02:10') === null && parseTime('0210Z') === null),
          'OFP time input is strict four-digit HHMM');

    check(await page.locator('#drop').isVisible(), 'the load box is shown');

    await page.locator('.themesw button[data-theme-set="light"]').click();
    check(await page.evaluate(() => document.documentElement.dataset.theme) === 'light',
          'the theme switch works');

    check(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())),
          'the service worker registers');

    /* The whole point of the DOM rewrite: a waypoint name, an aerodrome name and
       a NOTAM all come out of the loaded PDF, and a crafted package can put
       markup in any of them. Every one is driven through the real render path
       here, with a payload that would run on this origin if it were ever parsed
       as HTML rather than written as text. */
    const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
    const injected = await page.evaluate(payload => {
      window.__pwned = 0;
      T0 = 130;
      RESULT = [
        { i: 0, sec: 1, wp: payload, et: '0.00', cum: 0,   t: 130, rem: 29647, page: 0 },
        { i: 1, sec: 1, wp: 'TOC',   et: '0.20', cum: 20,  t: 150, rem: 27100, page: 0 },
        { i: 2, sec: 1, wp: 'ABDAR', et: '0.55', cum: 75,  t: 205, rem: 24000, page: 1 },
        { i: 3, sec: 1, wp: 'KEGOL', et: '1.05', cum: 140, t: 270, rem: 21000, page: 1 },
        { i: 4, sec: 1, wp: 'UACC',  et: '1.05', cum: 205, t: 335, rem: 18000, page: 2 }
      ];
      render(130, 335);
      renderAlt();
      // render() is called directly in this synthetic test. A real loaded plan
      // has Step 3's parent card visible, and Calculate then opens the nested
      // Actuals section, so mirror both states before a real WebKit touch.
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      DCT.marks = [{ to: 3, skipped: [2] }];
      syncDct();
      renderDctChips();
      showWx({ airports: [{ icao: payload, name: '', role: '', group: 'flight',
                            metar: [payload], taf: [], co: [],
                            notams: [{ id: payload, from: '', to: '', subject: payload,
                                       text: payload }] }] });
      const cell = document.querySelector('#tbl tbody tr[data-i="0"] td');
      return {
        pwned: window.__pwned,
        images: document.querySelectorAll('#tbl img, #wxOut img, #altrows img').length,
        rows: document.querySelectorAll('#tbl tbody tr[data-i]').length,
        firstCell: cell && cell.textContent,
        option: document.querySelector('#wxApt option').textContent,
        notam: document.querySelector('#wxOut .ntm p').textContent,
        chips: document.querySelectorAll('#dctChips .dctchip').length,
        checks: document.querySelectorAll('#altrows .altrow').length,
        inputs: document.querySelectorAll('#tbl tbody input.ato').length
      };
    }, PAYLOAD);

    check(injected.pwned === 0, 'a crafted waypoint name does not run');
    check(injected.images === 0, 'no element is built out of document text');
    check(injected.firstCell === PAYLOAD, 'the waypoint name is shown as the text it is');
    check(injected.option === PAYLOAD, 'the aerodrome name is shown as the text it is');
    check(injected.notam === PAYLOAD, 'the NOTAM text is shown as the text it is');
    check(injected.rows === 5, 'the table has a row per waypoint');
    check(injected.inputs === 5, 'each row carries its ATO box');
    check(injected.checks === 3, 'the altimeter checks are laid out');   // TOC, then +1:00 and +2:00
    check(injected.chips === 1, 'the direct-to chip is shown');

    /* The bug this guards: progress tracking used to pin itself on the first
       waypoint a Direct-To cut out and never move again unless the crew wrote
       an ATO against that exact one — the highlight looked frozen for the rest
       of the flight. It has to keep advancing with the clock like any other
       waypoint, an ATO logged early aside. */
    const tracking = await page.evaluate(() => {
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const t0 = now - 50;   // DEP/TOC/WPT2 already due; WPT3 onward still ahead
      const cums = [0, 20, 45, 70, 95, 120, 150, 180, 220];
      const names = ['DEP', 'TOC', 'WPT2', 'WPT3', 'WPT4', 'WPT5', 'WPT6', 'WPT7', 'DEST'];
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: i ? cums[i] - cums[i - 1] : 0, cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      render(t0, t0 + 220);
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      const nextWp = () => RESULT.find(p => rowOf(p.i)?.classList.contains('next'))?.wp || null;

      applyDirect(6);   // direct WPT2 -> WPT6, cutting out WPT3/WPT4/WPT5
      const rightAfter = nextWp();

      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a){ if (a.length) return new RealDate(...a); return new RealDate(RealDate.now() + 40 * 60000); }
        static now(){ return RealDate.now() + 40 * 60000; }
      }
      window.Date = FakeDate;
      refreshProgress();
      const after40Min = nextWp();
      window.Date = RealDate;
      return { rightAfter, after40Min };
    });
    check(tracking.rightAfter === 'WPT3', 'a fresh direct tracks the first abeam waypoint');
    check(tracking.after40Min === 'WPT4',
          'tracking keeps advancing with the clock through a direct instead of freezing');

    /* The bug this guards: the offset an ATO implies used to be applied to
       every waypoint alike, including ones before the one it was drawn from.
       An ATO logged late against a waypoint further down the route could then
       make waypoints already necessarily flown through — even the takeoff
       itself — read as still ahead, because the shifted clock comparison said
       so on its own. Anything at or before the waypoint the offset came from
       must count as passed outright; only what comes after it is judged
       against the shifted clock. */
    const causality = await page.evaluate(() => {
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const t0 = now - 50;
      const cums = [0, 20, 45, 70, 95, 120, 150, 180, 220];
      const names = ['DEP', 'TOC', 'WPT2', 'WPT3', 'WPT4', 'WPT5', 'WPT6', 'WPT7', 'DEST'];
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: i ? cums[i] - cums[i - 1] : 0, cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      render(t0, t0 + 220);
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      const nextWp = () => RESULT.find(p => rowOf(p.i)?.classList.contains('next'))?.wp || null;

      applyDirect(6);   // direct WPT2 -> WPT6, cutting out WPT3/WPT4/WPT5
      // WPT6's own printed ETO is t0+150; logging it 250 minutes late must not
      // read as DEP itself — logged over three hours earlier — still being ahead.
      const inp6 = document.querySelector('#tbl tbody tr[data-i="6"] input.ato');
      inp6.value = fmt(t0 + 400); inp6.dispatchEvent(new Event('input'));

      // t0+400 is itself still ahead of the real clock the moment it's typed
      // in — as any advance entry is. Move the clock past it so this checks
      // the causality rule once WPT6 is genuinely reached, not the separate
      // still-pending case covered below; short of WPT7's own adjusted due
      // (t0+430) so WPT7 remains the one still owed.
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a){ if (a.length) return new RealDate(...a); return new RealDate(RealDate.now() + 355 * 60000); }
        static now(){ return RealDate.now() + 355 * 60000; }
      }
      window.Date = FakeDate;
      refreshProgress();
      const target = nextWp();
      window.Date = RealDate;
      return { target };
    });
    check(causality.target === 'WPT7',
          'a late ATO logged further down the route never reads as an earlier waypoint still being ahead');

    /* The bug this guards: applyDirect() auto-focuses and selects the first
       abeam waypoint's ATO box right after taking a direct. select() has no
       preventScroll option, and drags the table to wherever the browser's own
       default reveals the input a frame later — overrunning the deliberate
       scroll-to-top refreshProgress() had just done, and landing partway down
       the box instead of with the row at the top. */
    const focusScroll = await page.evaluate(async () => {
      // Clean slate: the causality check above left its own ATO and direct
      // behind on this same page, and reusing those waypoint indexes here
      // would silently feed them into this scenario's own offset.
      for (const k in ACT) delete ACT[k];
      DCT.marks = []; syncDct();
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const t0 = now - 50;
      const names = [], cums = [];
      for (let i = 0; i < 20; i++){ names.push('WPT' + i); cums.push(i * 15); }
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: i ? 15 : 0, cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      document.querySelector('.tblbox').style.maxHeight = '260px';   // force an actual scroller
      render(t0, t0 + cums[cums.length - 1]);
      applyDirect(6);   // WPT2 -> WPT6: the crew is put straight onto WPT4, the first abeam point
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 500));   // let the (possibly twice-restarted) smooth scroll settle
      const box = document.querySelector('.tblbox');
      const head = box.querySelector('thead');
      const target = RESULT.find(p => rowOf(p.i)?.classList.contains('next'));
      const row = rowOf(target.i);
      const prevRow = row.previousElementSibling;
      const topOf = el => el.getBoundingClientRect().top - box.getBoundingClientRect().top - head.offsetHeight;
      return { target: target.wp, prevTopInBox: prevRow && topOf(prevRow), rowTopInBox: topOf(row) };
    });
    check(focusScroll.target === 'WPT4', 'the crew is put straight onto the first abeam waypoint');
    // The tracked row is anchored one row past the header on purpose, clear of
    // its fade-and-chevron overlay — the row before it sits under that instead.
    check(Math.abs(focusScroll.prevTopInBox) < 2,
          'auto-focusing the abeam box after a direct does not pull the scroll off its anchor');
    check(focusScroll.rowTopInBox > 2,
          'the tracked row clears the header overlay rather than sitting flush under it');

    /* The bug this guards: focusing a numkey field opens the on-screen numpad,
       whose own focusin handler reveals the field with scrollIntoView — unlike
       scrollRowToTop, that walks every scrollable ancestor and, measured
       against a real page tall enough to actually move, dragged the whole
       page down by a few hundred pixels on every direct, not just the table.
       Reproduced against a live browser before the fix: an otherwise identical
       scenario moved window.scrollY from 753 to 1047. */
    const pageDrag = await page.evaluate(async () => {
      for (const k in ACT) delete ACT[k];
      DCT.marks = []; syncDct();
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const t0 = now - 50;
      const names = [], cums = [];
      for (let i = 0; i < 20; i++){ names.push('WPT' + i); cums.push(i * 15); }
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: i ? 15 : 0, cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      document.querySelector('.tblbox').style.maxHeight = '260px';
      render(t0, t0 + cums[cums.length - 1]);
      // Padding below the card gives the page real room to be dragged down —
      // without it the bug this guards has nowhere to move the page to.
      const pad = document.createElement('div');
      pad.style.height = '2000px';
      document.body.appendChild(pad);
      document.querySelector('#c2').scrollIntoView();
      await new Promise(r => requestAnimationFrame(r));
      const before = scrollY;
      applyDirect(6);   // box.scrollTop is still 0 here -- the row isn't in view within the box yet
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 500));
      const after = scrollY;
      pad.remove();
      return { before, after };
    });
    check(pageDrag.before === pageDrag.after,
          'auto-focusing the abeam box after a direct does not drag the page itself');

    /* The bug this guards: a crew logging actuals from the FMC ahead of
       overflying — the normal way of working, not test data — enters a time
       the wall clock has not reached yet. That entry is a prediction until
       the clock actually gets there, and tracking must not run ahead of
       where the flight really is: the highlight has to stay on the waypoint
       just logged, not jump onward the instant a value lands in its box. */
    const advanceEntry = await page.evaluate(() => {
      for (const k in ACT) delete ACT[k];
      DCT.marks = []; syncDct();
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const tegriAto = now + 9;          // logged ahead of the wall clock reaching it
      const t0 = tegriAto - 18 + 2;      // TEGRI's own plan ETO (t0+18) is 2 min later, i.e. logged early
      const names = ['DEP', 'TEGRI', '-LRBB', 'EKSUN', 'RIVOS', '-LBSR', 'DINRO', '-LTBB', 'UDROS', '-LTAA'];
      const ets = [0, 18, 0, 30, 8, 9, 1, 12, 0, 2];
      let cum = 0;
      const cums = ets.map(e => (cum += e));
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: ets[i], cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      render(t0, t0 + cums[cums.length - 1]);
      const inp = document.querySelector('#tbl tbody tr[data-i="1"] input.ato');   // TEGRI
      inp.value = fmt(tegriAto); inp.dispatchEvent(new Event('input'));
      // Direct to UDROS (8) taken from TEGRI, cutting -LRBB..-LTBB (2..7) —
      // TEGRI itself, already logged, is not part of the cut.
      DCT.marks = [{ to: 8, skipped: [2, 3, 4, 5, 6, 7] }];
      syncDct();
      afterDct();
      const target = RESULT.find(p => rowOf(p.i)?.classList.contains('next'));

      // The bug this ALSO guards: once the clock genuinely reaches that
      // advance entry, tracking has to carry through -LRBB — printed the same
      // instant as TEGRI — rather than stalling on it for a separate reason.
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a){ if (a.length) return new RealDate(...a); return new RealDate(RealDate.now() + 10 * 60000); }
        static now(){ return RealDate.now() + 10 * 60000; }
      }
      window.Date = FakeDate;
      refreshProgress();
      const targetOnceReached = RESULT.find(p => rowOf(p.i)?.classList.contains('next'));
      window.Date = RealDate;

      return { target: target && target.wp, targetOnceReached: targetOnceReached && targetOnceReached.wp };
    });
    check(advanceEntry.target === 'TEGRI',
          'an actual logged ahead of the wall clock reaching it keeps the highlight on that waypoint');
    check(advanceEntry.targetOnceReached === 'EKSUN',
          'once the clock reaches an advance entry, a waypoint logged the same instant does not stall tracking behind it');

    /* The bug this guards: the table's own row-refocus used to hold off only on
       a scroll or keystroke inside the table itself — a touch anywhere else on
       the page (a NOTAM, a chart, a document field) went unnoticed and the
       table would yank itself to a new row while the crew's hand was busy
       somewhere else on the same page. Any touch on the page now counts. */
    const idleGate = await page.evaluate(async () => {
      for (const k in ACT) delete ACT[k];
      DCT.marks = []; syncDct();
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const t0 = now - 50;
      const names = [], cums = [];
      for (let i = 0; i < 20; i++){ names.push('WPT' + i); cums.push(i * 15); }
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: i ? 15 : 0, cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      const box = document.querySelector('.tblbox');
      box.style.maxHeight = '260px';
      render(t0, t0 + cums[cums.length - 1]);
      const nextWp = () => RESULT.find(p => rowOf(p.i)?.classList.contains('next'))?.wp || null;
      const settle = async () => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 400));
      };

      refreshProgress();   // page load: nothing has touched the page yet, so this may scroll
      await settle();
      const initialTarget = nextWp();
      const scrollAfterInitial = box.scrollTop;

      const RealDate = Date;
      const fake = mins => class extends RealDate {
        constructor(...a){ if (a.length) return new RealDate(...a); return new RealDate(RealDate.now() + mins * 60000); }
        static now(){ return RealDate.now() + mins * 60000; }
      };

      // A touch elsewhere on the page — not the table — while the clock moves
      // far enough for a new waypoint to become 'next'.
      window.Date = fake(46);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      refreshProgress();
      window.Date = RealDate;
      await settle();
      const heldTarget = nextWp();
      const scrollWhileHeld = box.scrollTop;

      // The same target, twenty-one seconds after that touch: now it may follow.
      window.Date = fake(46 + 21 / 60);
      refreshProgress();
      window.Date = RealDate;
      await settle();
      const scrollAfterRelease = box.scrollTop;

      return { initialTarget, heldTarget, scrollAfterInitial, scrollWhileHeld, scrollAfterRelease };
    });
    check(idleGate.heldTarget !== idleGate.initialTarget,
          'the tracked waypoint actually changes once the clock moves on');
    check(idleGate.scrollWhileHeld === idleGate.scrollAfterInitial,
          'a touch anywhere on the page holds the carousel refocus back, not just a touch on the table');
    check(idleGate.scrollAfterRelease !== idleGate.scrollWhileHeld,
          'the carousel follows again once twenty seconds have actually passed since that touch');

    /* The bug this guards: an on-screen keypad field, once focused, is never
       blurred on its own -- Enter only ever moves focus to the next field, so
       some box stays focused for the rest of the flight, exactly as the
       comment above already says. A version of this fix that used "is a box
       currently focused" as its own signal for "an entry is genuinely still
       in progress" was wrong for exactly that reason: once any entry has ever
       been made, a box is always focused, so that signal never goes away and
       the carousel stops following the flight at all -- confirmed against a
       real iPad. A box merely being focused, with the twenty-second gate
       already open, must not hold the follow back: nothing has touched the
       page in twenty seconds regardless of what still happens to have focus. */
    const staleFocus = await page.evaluate(async () => {
      for (const k in ACT) delete ACT[k];
      DCT.marks = []; syncDct();
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const t0 = now - 5;
      const names = [], cums = [];
      for (let i = 0; i < 20; i++){ names.push('WPT' + i); cums.push(i * 15); }
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: i ? 15 : 0, cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      const box = document.querySelector('.tblbox');
      box.style.maxHeight = '260px';
      render(t0, t0 + cums[cums.length - 1]);
      const settle = async () => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 400));
      };
      refreshProgress();
      await settle();

      // Focus WPT5's ATO box and log it -- moving the tracked target on to
      // WPT6 -- then leave the box focused and simply stop touching anything,
      // the way it's left after a real entry with nothing tapped afterward.
      const inp = document.querySelector('#tbl tbody tr[data-i="5"] input.ato');
      inp.focus();
      inp.value = fmt(now); inp.dispatchEvent(new Event('input'));
      await settle();

      // Twenty-one seconds later, still nothing touched, the box still
      // holding focus it was never explicitly given up.
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a){ if (a.length) return new RealDate(...a); return new RealDate(RealDate.now() + 21000); }
        static now(){ return RealDate.now() + 21000; }
      }
      window.Date = FakeDate;
      refreshProgress();
      window.Date = RealDate;
      await settle();

      const row6 = rowOf(6);
      const head = box.querySelector('thead'), headH = head.offsetHeight;
      const anchor = row6.previousElementSibling || row6;
      const rel = anchor.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      const wantTopPin = Math.round(Math.max(0, Math.min(rel - headH, box.scrollHeight - box.clientHeight)));

      const result = { scrollAfterQuiet: box.scrollTop, wantTopPin, stillFocused: document.activeElement === inp };
      inp.blur();
      return result;
    });
    check(staleFocus.stillFocused,
          'the box logged against stays focused afterward, with nothing having explicitly closed it');
    check(Math.abs(staleFocus.scrollAfterQuiet - staleFocus.wantTopPin) < 4,
          'the carousel still follows the flight to the top once the gate opens, a stale focused box notwithstanding');

    /* The bug this guards: a touch anywhere resets the quiet wait, so a crew
       genuinely busy elsewhere for minutes at a stretch -- reading a NOTAM,
       working document fields, anything -- could keep the carousel from ever
       following at all, exactly like a stuck-focused keypad box could. The
       target changing at all now starts its own twenty-second clock that
       nothing resets: the row is guaranteed onto screen within twenty
       seconds of becoming the tracked one, no matter what keeps touching the
       page after that. The quiet-since-last-touch rule still applies on its
       own too -- it can let the carousel follow sooner, if the page was
       already quiet when the target changed. */
    const guaranteedFocus = await page.evaluate(async () => {
      for (const k in ACT) delete ACT[k];
      DCT.marks = []; syncDct();
      const now = (() => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
      const t0 = now - 50;
      const names = [], cums = [];
      for (let i = 0; i < 20; i++){ names.push('WPT' + i); cums.push(i * 15); }
      T0 = t0;
      RESULT = names.map((wp, i) => ({
        i, sec: 1, wp, et: i ? 15 : 0, cum: cums[i],
        t: t0 + cums[i], rem: 30000 - cums[i] * 100, page: 0
      }));
      document.querySelector('#c2').classList.remove('hide');
      document.querySelector('#c3').classList.remove('hide');
      const box = document.querySelector('.tblbox');
      box.style.maxHeight = '260px';
      render(t0, t0 + cums[cums.length - 1]);
      const nextWp = () => RESULT.find(p => rowOf(p.i)?.classList.contains('next'))?.wp || null;
      const settle = async () => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 400));
      };

      refreshProgress();
      await settle();
      const initialTarget = nextWp();
      const scrollAfterInitial = box.scrollTop;

      const RealDate = Date;
      const fake = mins => class extends RealDate {
        constructor(...a){ if (a.length) return new RealDate(...a); return new RealDate(RealDate.now() + mins * 60000); }
        static now(){ return RealDate.now() + mins * 60000; }
      };

      // A touch elsewhere on the page, the same instant the clock moves the
      // target on: the wait starts now, for both rules alike.
      window.Date = fake(46);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      refreshProgress();
      window.Date = RealDate;
      await settle();
      const targetAfterChange = nextWp();
      const scrollRightAfterChange = box.scrollTop;

      // Nineteen seconds later, still another touch -- under the old,
      // touch-only rule this would push the wait back out by a further
      // twenty seconds from here. It must not push back the target's own
      // twenty-second ceiling.
      window.Date = fake(46 + 19 / 60);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      refreshProgress();
      window.Date = RealDate;
      await settle();
      const scrollAt19s = box.scrollTop;

      // One second later -- twenty seconds since the target itself changed,
      // only one since that last touch: the touch-only rule would still hold
      // it back here, but the guarantee does not.
      window.Date = fake(46 + 20 / 60);
      refreshProgress();
      window.Date = RealDate;
      await settle();
      const scrollAt20s = box.scrollTop;

      return { initialTarget, targetAfterChange, scrollAfterInitial, scrollRightAfterChange, scrollAt19s, scrollAt20s };
    });
    check(guaranteedFocus.targetAfterChange !== guaranteedFocus.initialTarget,
          'the tracked waypoint actually changes once the clock moves on');
    check(guaranteedFocus.scrollRightAfterChange === guaranteedFocus.scrollAfterInitial,
          'the carousel does not jump the instant the target changes');
    check(guaranteedFocus.scrollAt19s === guaranteedFocus.scrollAfterInitial,
          'a touch nineteen seconds after the change still holds the carousel back');
    check(guaranteedFocus.scrollAt20s !== guaranteedFocus.scrollAfterInitial,
          'but twenty seconds after the target changed the carousel follows regardless of that touch');

    // WebKit gets an iPad-sized/touch-enabled context and verifies the custom
    // numpad plus both orientations. A real tap is used here because programmatic
    // focus does not consistently model a user gesture in mobile WebKit.
    if (engineName === 'webkit'){
      const firstAto = page.locator('#tbl tbody input.ato:visible').first();
      await firstAto.tap();
      check(await page.locator('#numpad').evaluate(e => e.classList.contains('show')),
            'WebKit opens the custom numpad for an ATO field');
      await page.setViewportSize({ width: 1366, height: 1024 });
      check(await page.evaluate(() => matchMedia('(orientation: landscape)').matches),
            'WebKit survives landscape orientation');
      await page.setViewportSize({ width: 1024, height: 1366 });
      check(await page.evaluate(() => matchMedia('(orientation: portrait)').matches),
            'WebKit survives portrait orientation');
      await page.locator('#numpadHide').dispatchEvent('pointerdown');
      check(!await page.locator('#numpad').evaluate(e => e.classList.contains('show')),
            'WebKit dismisses the custom numpad');
    }
    await page.close();
  }

  /* ---- the keypad stays open for the tap that opened it ----
     The bug this guards: a tap on a box with the slightest finger movement —
     turbulence, a roll of the fingertip — counted as a drag of the page, and the
     scroll that then brings the box up above the keypad was read as the crew
     scrolling away: the keypad closed as they went to type. A drag made while
     it is open still closes it, the way scrolling closes the system keyboard. */
  {
    const { page } = await open('index.html');
    const r = await page.evaluate(async a => {
      await loadBuffer('K.pdf', a.length, new Uint8Array(a).buffer, false);
      document.body.style.minHeight = '5000px';
      document.querySelector('.wrap').style.paddingTop = '1500px';      // the box well down the page
      document.activeElement.blur();
      const fob = document.querySelector('#fob');
      const settle = ms => new Promise(res => setTimeout(res, ms));
      // the box low on the screen, so bringing it above the keypad scrolls the page
      scrollTo(0, scrollY + fob.getBoundingClientRect().top - innerHeight + 40);
      await settle(200);
      const y0 = scrollY;
      fob.dispatchEvent(new Event('touchmove', { bubbles: true }));    // the tap's own small movement
      fob.focus();
      await settle(600);
      const open = { scrolled: scrollY !== y0, open: document.querySelector('#numpad').classList.contains('show') };
      // now a real drag of the page with the keypad up
      document.body.dispatchEvent(new Event('touchmove', { bubbles: true }));
      scrollBy(0, 200);
      await settle(300);
      return { ...open, closedByDrag: !document.querySelector('#numpad').classList.contains('show') };
    }, ofpPdf([0, 20, 40, 60]));
    check(r.scrolled && r.open, 'a tap that moves the finger slightly still leaves the keypad open once the box is brought up'
          + ` (${JSON.stringify(r)})`);
    check(r.closedByDrag, 'while dragging the page with the keypad up still closes it');
    await page.close();
  }

  /* ---- framed by another site ----
     No frame-ancestors can be sent from GitHub Pages, so the page hides itself
     when it finds it is not the top-level document. */
  {
    const page = await context.newPage();
    await page.setContent(`<iframe src="${base}index.html" width="800" height="600"></iframe>`);
    const frame = page.frames().find(f => f.url().endsWith('index.html'));
    await frame.waitForLoadState('load').catch(() => {});
    const hidden = page.url() === 'about:blank'
      ? await frame.evaluate(() => getComputedStyle(document.documentElement).display === 'none')
      : true;                                  // or it broke out to the top level instead
    check(hidden, 'the app refuses to be shown inside another page\u2019s frame');
    await page.close();
  }

  /* ---- a second plan loaded over a calculated one ----
     The bug this guards: loading the next sector kept the previous plan's
     computed rows until Calculate was pressed again, and Save PDF — offered as
     soon as a plan is loaded — wrote the previous flight's ETOs onto the new
     one's ETO column. */
  {
    const { page } = await open('index.html');
    const out = await page.evaluate(async ([a, b]) => {
      const buf = x => new Uint8Array(x).buffer;
      await loadBuffer('A.pdf', a.length, buf(a), false);
      document.querySelector('#etd').value = '1000';
      document.querySelector('#calc').click();
      const calculated = RESULT.length;
      await loadBuffer('B.pdf', b.length, buf(b), false);
      return { calculated, rows: RESULT.length, checks: CHECKS.length,
               etd: document.querySelector('#etd').value,
               saved: [...new Uint8Array(await build().arrayBuffer())] };
    }, [ofpPdf([0, 20, 40, 60]), ofpPdf([0, 33, 44, 55])]);
    const saved = new PDFMini.Doc(new Uint8Array(out.saved));
    const written = PDFMini.textItems(await saved.content(saved.pages()[0]))
      .filter(i => i.x > 460 && i.x < 500 && /^\d{4}$/.test(i.str));
    check(out.calculated === 4, 'the first plan is calculated');
    check(out.rows === 0 && out.checks === 0, 'loading the next plan drops the previous plan\u2019s rows and checks');
    check(out.etd === '', 'loading the next plan clears the previous takeoff time');
    check(written.length === 0, 'Save PDF writes no previous-flight ETOs onto the next plan');
    await page.close();
  }

  /* ---- reopening a flight, offline ----
     The bug this guards: every time iPadOS unloaded the app — and every trip
     back from the Journey Log — the whole package was read again, page by page,
     behind an empty load screen that then jumped to the plan. The reading is
     kept with the PDF now: the flight comes back from it without a parse, says
     it is reopening rather than showing the load screen, returns to where it was
     scrolled, and still saves a complete PDF.
     And the one after it: the reading came out of IndexedDB, which answers only
     once the page has been drawn, so the first frame was a blank page and the
     flight appeared over it. Read from its localStorage copy it is back before
     the page has even finished loading — its first frame is the flight. */
  {
    const { page } = await open('index.html');
    await page.evaluate(async a => {
      await loadBuffer('R.pdf', a.length, new Uint8Array(a).buffer, false);
      document.querySelector('#etd').value = '1000';
      document.querySelector('#calc').click();
      flushSave();
      await new Promise(r => setTimeout(r, 300));            // the stored copy is written
    }, ofpPdf([0, 20, 40, 60]));
    await page.evaluate(() => {
      document.body.style.minHeight = '4000px';               // room to scroll
      scrollTo(0, 600);
      dispatchEvent(new Event('pagehide'));
    });
    // Reloaded offline where the harness can: Playwright's Linux WebKit fails
    // any reload of a service-worker page while its offline emulation is on
    // ("WebKit encountered an internal error" — on main too, before this
    // change), so under WebKit the same reopen is driven online. The reopen
    // itself makes no request either way.
    const offline = engineName !== 'webkit';
    if (offline) await page.context().setOffline(true);
    await page.addInitScript(() => {
      // theme-init.js sets the mark before first paint; record that it did.
      // (Before any markup is parsed there is no documentElement yet to watch.)
      window.__marked = false;
      new MutationObserver(() => {
        const html = document.documentElement;
        if (html && html.hasAttribute('data-resuming')) window.__marked = true;
        // The same room to scroll as before the reload, from the start: on the
        // tall iPad viewport the plan alone is shorter than the offset being
        // restored, and it is restored before the page has finished loading.
        if (html && !html.style.minHeight) html.style.minHeight = '4000px';
      }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['data-resuming'] });
    });
    // Parses are counted by app.js's own performance mark, one per reading of
    // a package — on the page's own timeline, which starts again with each load.
    const reopen = async () => {
      await page.reload({ waitUntil: 'load' });
      // Until the mark clears the reopen is not finished: the scroll position is
      // restored after the plan's rows exist, just before the page is shown.
      await page.waitForFunction(() => RESULT.length === 4
        && !document.documentElement.hasAttribute('data-resuming'), null, { timeout: 10000 });
      return page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const resumed = performance.getEntriesByName('ofp:resumed')[0];
        return { marked: window.__marked, cleared: !document.documentElement.hasAttribute('data-resuming'),
                 parses: performance.getEntriesByName('ofp:parse').length, y: Math.round(scrollY),
                 resumed: !!resumed,
                 early: !!resumed && !!nav && resumed.startTime <= nav.domContentLoadedEventStart };
      });
    };
    const back = await reopen();
    // The PDF's bytes are read after the flight is on screen; Save waits for them.
    const saved = await page.evaluate(async () => { await ensureRaw(); return [...new Uint8Array(await build().arrayBuffer())]; });
    // A decoded chart is released when the viewer closes, not kept in memory.
    const released = await page.evaluate(() => {
      const box = document.querySelector('#chartBox');
      CHARTS = [{ page: 0, key: 'X', url: URL.createObjectURL(new Blob(['x'])) }];
      box.appendChild(document.createElement('img'));
      openCharts(false);
      return box.childElementCount === 0 && CHARTS[0].url === null;
    });
    if (offline) await page.context().setOffline(false);
    const out = new PDFMini.Doc(new Uint8Array(saved));
    const etos = PDFMini.textItems(await out.content(out.pages()[0]))
      .filter(i => i.x > 460 && i.x < 500 && /^\d{4}$/.test(i.str)).map(i => i.str);
    check(back.marked, 'a reopening flight is marked before first paint, not shown as the load screen');
    check(back.cleared, 'and the mark is cleared once the flight is back');
    check(back.parses === 0, 'the flight comes back from its stored reading, without parsing the PDF again'
          + (back.parses ? ` (parsed ${back.parses}x)` : ''));
    check(back.y === 600, 'the page comes back where it was scrolled' + (back.y === 600 ? '' : ` (at ${back.y})`));
    check(back.early, 'the flight is back before the page has finished loading, so its first frame is the flight');
    check(etos.join(' ') === '1000 1020 1100 1200', 'a reopened flight still saves its ETOs into the PDF');
    check(released, 'closing the chart viewer lets its decoded images go');

    // Without its localStorage copy — too big for a device's quota, say — the
    // flight still comes back, the slower way, from IndexedDB, and unparsed.
    await page.evaluate(() => {
      localStorage.removeItem('etofill:reading');
      scrollTo(0, 600);
      dispatchEvent(new Event('pagehide'));
    });
    const slow = await reopen();
    check(slow.resumed && slow.parses === 0 && slow.y === 600,
          'without that copy the flight still comes back from IndexedDB, unparsed and where it was'
          + ` (${JSON.stringify(slow)})`);
    await page.close();
  }

  /* ---- a reopened flight's table is already in place ----
     The waypoint table follows the flight: with no touch for a while it scrolls
     itself to the tracked row, smoothly. On a reopened flight there has been no
     touch at all, so it did that the moment the page appeared — the table
     gliding down in front of the crew, one more thing moving on a page that
     should simply be there. While a flight is being reopened it is put there
     at once. */
  {
    const { page } = await open('index.html');
    const r = await page.evaluate(async a => {
      await loadBuffer('T.pdf', a.length, new Uint8Array(a).buffer, false);
      document.querySelector('#etd').value = '1000';
      document.querySelector('#calc').click();
      const box = document.querySelector('.tblbox');
      box.style.maxHeight = '200px';                     // a box with somewhere to scroll
      box.scrollTop = 0;
      document.documentElement.setAttribute('data-resuming', '');
      scrollRowToTop(rowOf(RESULT[RESULT.length - 2].i));
      const at = box.scrollTop;                           // where it is straight away, no frame later
      document.documentElement.removeAttribute('data-resuming');
      return { at, room: box.scrollHeight - box.clientHeight };
    }, ofpPdf(Array.from({ length: 22 }, () => 10)));
    check(r.room > 0 && r.at > 0, 'while a flight is reopened its table is put on the tracked row at once, not scrolled there'
          + ` (at ${r.at} of ${r.room})`);
    await page.close();
  }

  /* ---- mandatory reads ----
     A "MAN nnn-yy" document at the back of the package is listed on a card of
     its own and opened as printed: its pages of the original PDF, in the chart
     viewer, released again when the viewer closes. */
  {
    const { page, problems } = await open('index.html');
    const bytes = [...buildPages([ofpText([0, 20, 40, 60]), manPageContent(PAGE1), manPageContent(PAGE2)])];
    const card = await page.evaluate(async a => {
      await loadBuffer('MAN.pdf', a.length, new Uint8Array(a).buffer, false);
      const c9 = document.querySelector('#c9'), rows = c9.querySelectorAll('button.man');
      return { shown: !c9.classList.contains('hide'), docs: rows.length,
               title: rows[0] && rows[0].querySelector('b').textContent,
               meta: rows[0] && rows[0].querySelector('small').textContent,
               text: !!c9.querySelector('p, h4') };
    }, bytes);
    check(card.shown && card.docs === 1, 'a mandatory read in the package is listed on its own card');
    check(card.title === 'ACARS LOGON PROCEDURE' && card.meta.startsWith('Mandatory read · MAN 123-24 · issue 2 · rev 1 · pp. 2\u20133'),
          'by its subject, MAN number, issue and pages' + (card.meta && card.meta.startsWith('MAN') ? '' : ` (${card.title} / ${card.meta})`));
    check(!card.text, 'and nothing of it is re-set as text');

    await page.setViewportSize({ width: 1180, height: 820 });   // an iPad held landscape
    const viewer = await page.evaluate(async () => {
      document.querySelector('#c9 button.man').click();
      const box = document.querySelector('#chartBox');
      for (let i = 0; i < 100; i++){
        const img = box.querySelector('img'), a = box.querySelector('a');
        if ((img && img.complete && img.naturalWidth) || a) break;
        await new Promise(r => setTimeout(r, 50));
      }
      const img = box.querySelector('img'), a = box.querySelector('a');
      const out = {
        open: !document.querySelector('#charts').classList.contains('hide'),
        title: document.querySelector('#chartTitle').textContent,
        next: !document.querySelector('#chartNext').disabled,
        shown: !!(img && img.naturalWidth) || !!(a && a.href.startsWith('blob:'))
      };
      // A headless browser may not draw a PDF as a picture, so the page's
      // sizing is checked with a portrait picture standing in for it.
      const cv = Object.assign(document.createElement('canvas'), { width: 612, height: 792 });
      SHEETS[0].url = URL.createObjectURL(await new Promise(r => cv.toBlob(r)));
      await paintChart();
      const pic = box.querySelector('img');
      for (let i = 0; i < 100 && !(pic.complete && pic.naturalWidth && pic.style.width); i++)
        await new Promise(r => setTimeout(r, 50));
      const r = pic.getBoundingClientRect();
      out.ratio = (r.width / r.height) / (pic.naturalWidth / pic.naturalHeight);
      openCharts(false);
      out.released = box.childElementCount === 0 && SHEETS.every(x => x.url === null);
      return out;
    });
    check(viewer.open && viewer.title === 'Page 2 of the PDF  ·  1 of 2' && viewer.next,
          'opening it shows its first page, with Next to the rest of it');
    check(viewer.shown, 'drawn from a one-page PDF cut out of the package, or offered to the PDF viewer');
    check(viewer.released, 'and let go when the viewer closes');
    check(Math.abs(viewer.ratio - 1) < 0.02,
          'a portrait page on a landscape screen keeps its proportions, filling the width and scrolling'
          + ` (ratio ${viewer.ratio && viewer.ratio.toFixed(3)})`);

    const fir = await page.evaluate(() => {
      const n = (icao, group, co) => ({ icao, group, role: group === 'flight' ? 'departure' : null,
        name: null, metar: [], taf: [], notams: [], co });
      showWx({ airports: [n('UAAA', 'flight', []), n('UTTR', 'fir', [{ id: 'X', text: 'RESTRICTED AREA' }]),
                          n('UTSD', 'fir', [{ id: 'Y', text: '' }].slice(1))] });
      const first = document.querySelector('#wxApt optgroup');
      return [...first.querySelectorAll('option')].map(o => o.textContent);
    });
    check(fir.includes('UTTR — area, company notice') && !fir.some(t => t.startsWith('UTSD')),
          'an area carrying a company notice is listed with the flight\u2019s own aerodromes');
    check(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
    await page.close();
  }

  /* ---- actual wind and temperature, and the fuel on board before start ----
     One captain also logs the wind and temperature met at each waypoint; the
     boxes are there when switched on and out of the way when not. The FOB read
     off the fuel panel before start adds, under each REM, what the waypoint
     should show from it — the DIFF column stays against the OFP. */
  {
    const { page, problems } = await open('index.html');
    const block = 'BT /F1 10 Tf 50 760 Td (TOW 70000 LW 60000 ZFW 55000 PLD 10000 BLKF 30000) Tj ET\n';
    const bytes = [...buildPdf({ text: ofpText([0, 20, 40, 60]) + block, compress: false })];
    const r = await page.evaluate(async a => {
      try { localStorage.removeItem('etofill:wt'); } catch(e){}
      await loadBuffer('WT.pdf', a.length, new Uint8Array(a).buffer, false);
      document.querySelector('#etd').value = '1000';
      document.querySelector('#calc').click();
      const tbl = document.querySelector('#tbl');
      const out = { hiddenAtFirst: !tbl.classList.contains('wt-on') && !tableInputs().some(i => i.closest('.wt')) };
      const wt = document.querySelector('#wtOn');
      wt.checked = true; wt.dispatchEvent(new Event('change'));
      out.shownWhenOn = tbl.classList.contains('wt-on') && tableInputs().some(i => i.classList.contains('temp'));
      out.remembered = localStorage.getItem('etofill:wt') === '1';
      // typed on the app's own keypad
      const key = k => document.querySelector(`#numpad [data-k="${k}"]`)
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      const wind = document.querySelector('#tbl tr[data-i="1"] input.wind');
      wind.focus(); for (const k of '28045') key(k);
      const temp = document.querySelector('#tbl tr[data-i="1"] input.temp');
      temp.focus();
      out.signShown = document.querySelector('#numpadSign').classList.contains('on');
      for (const k of '52') key(k);
      out.minus = temp.value;
      key('sign');
      out.plus = temp.value;
      wind.focus();
      out.signHidden = !document.querySelector('#numpadSign').classList.contains('on');
      out.wind = wind.value;
      out.saved = JSON.stringify(ACT[1]);
      // FOB before start
      const fob = document.querySelector('#fob');
      fob.value = '30500'; fob.dispatchEvent(new Event('input', { bubbles: true }));
      out.exp = [...document.querySelectorAll('#tbl tbody .fobexp')].map(e => e.textContent);
      out.note = document.querySelector('#fobNote').textContent;
      out.hdr = document.querySelector('#remFobHdr').textContent;
      const fuel = document.querySelector('#tbl tr[data-i="1"] input.fuel');
      fuel.value = '29500'; fuel.dispatchEvent(new Event('input', { bubbles: true }));
      out.diff = document.querySelector('#tbl td.diff[data-d="1"]').textContent;
      flushSave();
      out.fobSaved = JSON.parse(localStorage.getItem(KEY)).fob;
      wt.checked = false; wt.dispatchEvent(new Event('change'));
      out.hiddenAgain = !tableInputs().some(i => i.closest('.wt'));
      return out;
    }, bytes);
    check(r.hiddenAtFirst && r.shownWhenOn && r.hiddenAgain, 'the wind/temp boxes come and go with their checkbox');
    check(r.remembered, 'and the choice is kept for the device');
    check(r.wind === '28045', 'a wind typed as 28045 stays as the OFP prints one');
    check(r.minus === '-52' && r.plus === '+52', 'a temperature is minus unless the \u00b1 key makes it plus');
    check(r.signShown && r.signHidden, 'the \u00b1 key is there only for a temperature');
    check(r.saved === JSON.stringify({ wind: '28045', temp: '+52' }), 'both are saved with the waypoint');
    check(r.exp.join(' ') === '30500 29500 27500 24500', 'under each REM: what it should show from the FOB'
          + (r.exp.join(' ') === '30500 29500 27500 24500' ? '' : ` (${r.exp.join(' ')})`));
    check(/\+500/.test(r.note) && r.hdr === 'from FOB', 'with the FOB against the planned block fuel stated, and the column labelled');
    check(r.diff === '+500', 'and the DIFF still against the OFP');
    check(r.fobSaved === '30500', 'the FOB is saved with the flight');
    check(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
    await page.close();
  }

  /* ---- the actual wind printed over the OFP's own ----
     The planned wind stands under the table's WIND heading on each waypoint's
     upper line ("33016"), with a blank line above every waypoint. The box shows
     it greyed; the actual — and a temperature after it — is printed on that
     blank line, directly above the planned figure, and only where it is blank. */
  {
    const { page, problems } = await open('index.html');
    // WIND heading at x=74 (over the wind, after "W0X ") just above the ATO heading line; each waypoint's
    // upper line carries its wind at the same x, with a blank line between
    // waypoints, as the OFP sets it.
    let t = 'BT /F1 10 Tf 74 732 Td (WIND) Tj ET\n'
          + 'BT /F1 10 Tf 50 720 Td (WPT  FL   ET  ETO) Tj ET\nBT /F1 10 Tf 480 720 Td (ATO) Tj ET\n';
    let y = 696, cum = 0;
    [[0, '33016'], [20, '32025'], [40, '31030']].forEach(([et, w], k) => {
      cum += et;
      const tt = Math.floor(cum / 60) + '.' + String(cum % 60).padStart(2, '0');
      t += `BT /F1 10 Tf 50 ${y} Td (W${k}X ${w} ${et} 1234) Tj ET\nBT /F1 10 Tf 470 ${y} Td (....) Tj ET\n`;
      t += `BT /F1 10 Tf 50 ${y - 12} Td (AA BB ${tt} ${30000 - cum * 50}) Tj ET\n`
         + `BT /F1 10 Tf 470 ${y - 12} Td (....) Tj ET\n`;
      y -= 36;
    });
    // ...and one waypoint printed with something on the line above its wind.
    t += 'BT /F1 10 Tf 74 ' + (696 - 36 + 12) + ' Td (NOTE) Tj ET\n';
    const bytes = [...buildPdf({ text: t, compress: false })];
    const r = await page.evaluate(async a => {
      await loadBuffer('WIND.pdf', a.length, new Uint8Array(a).buffer, false);
      document.querySelector('#etd').value = '1000';
      document.querySelector('#calc').click();
      const grey = [...document.querySelectorAll('#tbl input.wind')].map(i => i.placeholder);
      const set = (i, k, v) => { const e = document.querySelector(`#tbl tr[data-i="${i}"] input.${k}`);
        e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
      set(0, 'wind', '33520'); set(0, 'temp', '48');
      set(1, 'wind', '32030');                           // the one with print above it
      set(2, 'temp', '51');
      await ensureRaw();
      return { grey, unplaced: RESULT.filter(p => windTempText(ACT[p.i]) && !windPrintable(p)).map(p => p.wp),
               saved: [...new Uint8Array(await build().arrayBuffer())] };
    }, bytes);
    const out = new PDFMini.Doc(new Uint8Array(r.saved));
    const items = PDFMini.textItems(await out.content(out.pages()[0]));
    const at = (x, yy) => items.filter(i => Math.abs(i.x - x) < 0.5 && Math.abs(i.y - yy) < 0.5).map(i => i.str);
    check(r.grey.join(' ') === '33016 32025 31030', 'each wind box shows the OFP\u2019s own wind greyed');
    check(at(74, 708).includes('33520 -48'), 'the actual wind and temperature are printed just above the planned wind');
    check(at(74, 636).includes('-51'), 'a temperature on its own takes the same place');
    check(!at(74, 672).some(s => /32030/.test(s)) && r.unplaced.join() === 'W1X',
          'and nothing is printed where the line above is not blank — Save names that waypoint instead');
    check(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
    await page.close();
  }

  /* ---- every NOTAM on its own ----
     The FIR pages flag a NOTAM issued since the last briefing with NEW where
     the others carry their dash, or at the start of its text; name more than
     one place for one NOTAM; and divide groups with "..D.." and "Fir:" lines.
     Each of those once ran a NOTAM into the end of the one before it. */
  {
    const { page, problems } = await open('index.html');
    const r = await page.evaluate(() => {
      const L = [
        'NDB',
        'NOTAMOAHR G0425/26 12OCT1350-08JAN2359 2027 EST',
        'NEW NDB HRT FREQ 412KHZ U/S, DUE TO ELECTRICAL FAILURE.',
        'SFC / UNL',
        'VOR/DME',
        'NEW OAKN G0348/26 28AUG0520-29OCT0800',
        'DVOR/DME KDR FREQ 116.0MHZ/107X U/S,',
        'DUE TO TECHNICAL PROBLEMS.',
        'SFC / UNL',
        '..D..',
        'ACFT ENTRY RQMNTS',
        'NOTAMOPKR OPLR A0590/26 17OCT1445-23NOV2359 EST',
        'PAKISTAN AIRSPACE NOT AVBL FOR INDIAN REGISTERED ACFT.',
        'SFC / UNL',
        'Fir: UCFO Region: OSH',
        '- UCFM UCFO A0110/26 29JUN0926-PERM',
        'NEW WPT FOR DOMESTIC ATC ROUTES ESTABLISHED.',
        'SFC / UNL'].map(text => ({ text, page: 0,
          // out in the margin: the headers, their flags and the subject lines; the rest indented
          x: /^(?:NOTAM|NEW |- |NDB$|VOR\/DME$|ACFT|Fir:|\.\.)/.test(text) && text !== 'NEW WPT FOR DOMESTIC ATC ROUTES ESTABLISHED.' ? 40 : 80 }));
      const w = weatherNotams(L, null);
      const get = c => (w.airports.find(a => a.icao === c) || { notams: [] }).notams;
      const one = n => n && `${n.id}|${n.subject}|${n.fresh ? 'NEW' : ''}|${n.text}`;
      return { oahr: get('OAHR').map(one), oakn: get('OAKN').map(one),
               opkr: get('OPKR').map(n => n.id), oplr: get('OPLR').map(n => n.id),
               ucfm: get('UCFM').map(one), ucfo: get('UCFO').map(n => n.id) };
    });
    check(r.oahr.length === 1 && r.oahr[0] === 'G0425/26|NDB|NEW|NDB HRT FREQ 412KHZ U/S, DUE TO ELECTRICAL FAILURE. SFC / UNL',
          'a NOTAM flagged NEW in its text is tagged and kept to its own words' + ` (${r.oahr.join(' / ')})`);
    check(r.oakn.length === 1 && r.oakn[0] === 'G0348/26|VOR/DME|NEW|DVOR/DME KDR FREQ 116.0MHZ/107X U/S, DUE TO TECHNICAL PROBLEMS. SFC / UNL',
          'a NOTAM headed NEW is a NOTAM of its own, with the subject above it' + ` (${r.oakn.join(' / ')})`);
    check(r.opkr.join() === 'A0590/26' && r.oplr.join() === 'A0590/26',
          'a NOTAM naming two places is listed under each, and the divider above it is in neither');
    check(r.ucfm.length === 1 && r.ucfm[0] === 'A0110/26|null||NEW WPT FOR DOMESTIC ATC ROUTES ESTABLISHED. SFC / UNL'
          && r.ucfo.join() === 'A0110/26' && !JSON.stringify(r).includes('Fir:'),
          'a FIR heading closes the NOTAM above it, and a NOTAM\u2019s own word NEW stays in its text' + ` (${r.ucfm.join(' / ')})`);
    check(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
    await page.close();
  }

  /* ---- a new version waiting behind an open document is offered, not hidden ----
     The bar is the same on both pages; Update now applies it, Later puts it away. */
  for (const file of ['index.html', 'journey-log.html']){
    const { page, problems } = await open(file);
    const r = await page.evaluate(() => {
      let applied = 0;
      updateBar(document, () => applied++);
      const bar = document.querySelector('#updBar'), now = bar.querySelector('.updnow');
      const shown = !bar.hidden && getComputedStyle(bar).position === 'fixed' && bar.getBoundingClientRect().height > 0;
      now.click();
      const busy = now.disabled && applied === 1;
      updateBar(document, () => applied++);                 // offered again on the next resume
      bar.querySelector('.updlater').click();
      return { shown, busy, again: !now.disabled, later: bar.hidden && getComputedStyle(bar).display === 'none',
               one: document.querySelectorAll('#updBar').length === 1 };
    });
    check(r.shown && r.busy && r.again && r.later && r.one,
          `${file}: a waiting version is offered with Update now, and Later puts it away`);
    check(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
    await page.close();
  }

  /* ---- everything else in the package, listed so it is noticed ----
     Documents attached behind the OFP's own marked pages, the company notices
     that belong to no aerodrome, and the brief's contents — each opening as
     printed. Built the way a real package is laid out; none of one is used. */
  {
    const { page, problems } = await open('index.html');
    const mark = n => `BT /F1 8 Tf 400 775 Td (AIR ASTANA BRIEF PAGE ${n} OF 2) Tj ET\n`;
    const lines = (y0, ls) => ls.map((l, k) => `BT /F1 10 Tf 50 ${y0 - k * 12} Td (${l}) Tj ET\n`).join('');
    const company = mark(2) + lines(740, [
      'STATION COMPANY NOTAMS', 'OMDB COMPANY NOTAMS',
      'OMDB-00001 Oper: Y 02OCT26/1155', 'VALID FROM: 02JUL26/0400 TO: UFN', 'CO.FREQS DXB - 131.6',
      'ROUTE COMPANY NOTAMS: NIL',
      'ADMIN COMPANY NOTAMS',
      'ADMIN-00001 Oper: Y 16OCT26/0811', 'VALID FROM: 10SEP26/2359 TO: 10DEC26/2359',
      'EFB TABLET EFFECTIVE VERSION',
      'ADMIN-00002 Oper: Y 02OCT26/1121', 'VALID FROM: 02JUL26/0400 TO: UFN',
      '*** CROSSCHECK FMS DATA WITH CURRENT OFP ***',
      'WAYPOINT COMPANY NOTAMS',
      'RUDEK-00001 Oper: Y 21OCT26/0348', 'VALID FROM: 02JUL26/0400 TO: 13JAN27/2359',
      '### MTCP PROCEDURES REQUIRED ###']);
    const attached = 'BT /F2 14 Tf 60 780 Td (DXB OPERATIONAL BRIEFING) Tj ET\n'
      + lines(740, ['1. Purpose', 'This briefing provides operational guidance for flights to Dubai.']);
    const bytes = [...buildPages([mark(1) + ofpText([0, 20, 40, 60]), company, attached,
                                  manPageContent(PAGE1), manPageContent(PAGE2)])];
    const r = await page.evaluate(async a => {
      await loadBuffer('PKG.pdf', a.length, new Uint8Array(a).buffer, false);
      const c9 = document.querySelector('#c9');
      const rows = [...c9.querySelectorAll('button.man')].map(b => b.querySelector('b').textContent
        + ' | ' + b.querySelector('small').textContent);
      const toc = [...c9.querySelectorAll('button.toc')].map(b => b.textContent);
      const m1 = document.querySelector('#m1');
      const folds = [...c9.querySelectorAll('details.pkggrp')].map(d => d.querySelector('.pkgn').textContent + (d.open ? 'o' : ''));
      const omdb = WX.airports.find(x => x.icao === 'OMDB');
      [...c9.querySelectorAll('button.man.co')].find(b => b.textContent.startsWith('ADMIN')).click();
      const wx = WX.airports[+document.querySelector('#wxApt').value];
      const ids = [...document.querySelectorAll('#wxOut .ntm .id')].map(e => e.textContent);
      return { shown: !c9.classList.contains('hide'), badge: document.querySelector('#manSum').textContent,
               rows, toc, folds, m1: m1.textContent, warn: m1.classList.contains('warn'),
               omdbCo: omdb && omdb.co.map(c => c.id), picked: wx.icao, ids };
    }, bytes);
    check(r.shown && r.badge === '2 attached \u00b7 3 company NOTAMs', 'a package with documents behind the OFP says how many are attached');
    check(r.folds.length === 3 && r.folds.slice(0, 2).join() === '2,3' && r.folds.every(f => !f.endsWith('o')),
          'each group folds to one line with its count, closed until opened' + ` (${r.folds.join(' / ')})`);
    check(r.warn && /2 attached documents to read/.test(r.m1), 'and the load message says so too');
    check(r.rows[0].startsWith('ACARS LOGON PROCEDURE | Mandatory read') &&
          r.rows[1] === 'DXB OPERATIONAL BRIEFING | Attached document · p. 3',
          'each attached document is listed by its title' + (r.rows[1] ? '' : ` (${r.rows.join(' / ')})`));
    check(r.rows.some(x => x.startsWith('ADMIN | 2 company NOTAMs · ADMIN-00001, ADMIN-00002'))
          && r.rows.some(x => x.startsWith('WAYPOINT | 1 company NOTAM · RUDEK-00001')),
          'company notices that belong to no aerodrome are listed, not dropped');
    check(JSON.stringify(r.omdbCo) === JSON.stringify(['OMDB-00001']), 'a station company NOTAM stays with its aerodrome');
    check(r.picked === 'ADMIN' && r.ids.join() === 'ADMIN-00001,ADMIN-00002', 'View opens them in the NOTAM card');
    check(r.toc.some(t => /Navigation log/.test(t)) && r.toc.some(t => /p\. 2Company NOTAMs/.test(t)),
          'the brief\u2019s contents are listed with their pages');
    check(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
    await page.close();
  }

  /* ---- the order the NOTAMs are listed in ----
     As printed, or the relevant ones first: in effect for the flight ahead of
     the rest, a closure or the runway before a taxiway, then what is marked but
     not in effect, then the remainder in printed order after a divider. */
  {
    const { page, problems } = await open('index.html');
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('etofill:ntmorder'); localStorage.removeItem('etofill:wxhi'); } catch(e){}
      ICAO = { oneLine: '(FPL-KZR123-IS -A321/M-SDE2E3FGHIRWY/LB1 -UAAA1000 -N0450F350 DCT -UTTT0500 DOF/261024)', lines: [] };
      FPL = { ETD: '1000', ETA: '1500' };
      const n = (id, text, from, to) => ({ id, text, from, to, est: false, subject: null });
      const now = ['24OCT0800', '24OCT1200'], later = ['25OCT0000', '26OCT0000'];
      showWx({ airports: [{ icao: 'UAAA', group: 'flight', role: 'departure', name: null,
        metar: [], taf: [], co: [], notams: [
          n('A1', 'APRON STAND 5 NOT AVBL', ...now),
          n('B2', 'TWY C CLSD', ...later),
          n('C3', 'OBST CRANE ERECTED', ...later),
          n('D4', 'RWY 05R CLSD', ...later),
          n('E5', 'AD CLSD DUE WX', ...now),
          n('F6', 'BIRD ACTIVITY', ...later),
          n('G7', 'RWY 28 LLZ U/S', ...later)] }] });
      const g7 = [...document.querySelectorAll('#wxOut .ntm')].find(e => e.querySelector('.id').textContent === 'G7');
      const d4 = [...document.querySelectorAll('#wxOut .ntm')].find(e => e.querySelector('.id').textContent === 'D4');
      const navOut = { cls: g7.className, tag: (g7.querySelector('.navtag') || {}).textContent,
                       red: getComputedStyle(g7.querySelector('.id')).color, rwyRed: getComputedStyle(d4.querySelector('.id')).color };
      const ids = () => [...document.querySelectorAll('#wxOut .ntms > *')]
        .map(e => e.classList.contains('ntmsep') ? '|' : e.querySelector('.id').textContent).join(' ');
      const sel = document.querySelector('#wxOrder');
      const out = { printed: ids(), defaultOrder: sel.value, navOut };
      sel.value = 'relevant'; sel.dispatchEvent(new Event('change'));
      out.relevant = ids();
      out.kept = localStorage.getItem('etofill:ntmorder');
      const hi = document.querySelector('#wxHi');
      hi.checked = false; hi.dispatchEvent(new Event('change'));
      out.offOrder = ids(); out.disabled = sel.disabled;
      hi.checked = true; hi.dispatchEvent(new Event('change'));
      sel.value = 'printed'; sel.dispatchEvent(new Event('change'));
      out.back = ids();
      return out;
    });
    check(r.defaultOrder === 'printed' && r.printed === 'A1 B2 C3 D4 E5 F6 G7', 'NOTAMs are listed as printed by default');
    check(r.relevant === 'E5 A1 D4 G7 B2 | C3 F6', 'relevant first: in effect, then marked, then the rest as printed'
          + (r.relevant === 'E5 A1 D4 G7 B2 | C3 F6' ? '' : ` (${r.relevant})`));
    check(r.kept === 'relevant', 'the order chosen is kept for the device');
    check(/\bnav\b/.test(r.navOut.cls) && r.navOut.tag === 'NAVAID U/S' && r.navOut.red !== r.navOut.rwyRed,
          'a navaid out of use is tagged and marked in a red of its own, not the runway\u2019s'
          + ` (${r.navOut.cls} / ${r.navOut.red} vs ${r.navOut.rwyRed})`);
    check(r.offOrder === 'A1 B2 C3 D4 E5 F6 G7' && r.disabled, 'with the highlights off the list is as printed and the order waits');
    check(r.back === 'A1 B2 C3 D4 E5 F6 G7', 'and as printed again when chosen');
    check(problems.length === 0, 'no console errors' + (problems.length ? ': ' + problems.join(' | ') : ''));
    await page.close();
  }

  /* ---- the Journey Log ---- */
  {
    const { page, problems } = await open('journey-log.html');
    check(problems.length === 0, 'journey-log.html loads without console errors' +
          (problems.length ? ': ' + problems.join(' | ') : ''));
    check(await page.evaluate(() => typeof appendPdf === 'function'), 'jl-pdf.js ran');
    check(await page.evaluate(() => typeof exportOps === 'function'), 'journey-log.js ran');
    check(await page.evaluate(() => toMinutes('0340') === 220 && toMinutes('03:40') === 220 &&
                                   toMinutes('340') === null && toMinutes('2460') === null),
          'Journey Log accepts only valid four-digit HHMM / formatted HH:MM');

    // The fix this stands over: the export geometry must not move with the zoom.
    check(await page.evaluate(() => {
      const at = z => exportPlacement({
        sheetRect: { left: 0, top: 0, width: 841.89 * 4 / 3 * z, height: 595.28 * 4 / 3 * z },
        rect: { left: 100 * z, top: 50 * z, width: 80 * z, height: 16 * z },
        fontPx: 12, length: 5, alignLeft: false, pageW: 841.89, pageH: 595.28 });
      const a = at(1), b = at(3.5);
      return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && a.size === b.size;
    }), 'the export geometry is the same at any zoom');

    // Retention: a log untouched for thirty days is gone the next time the page
    // opens; a recent one is still there.
    const kept = async age => {
      await page.evaluate(age => localStorage.setItem('journeylog.v1', JSON.stringify({
        version: '2', manual: {}, pages: [], source: null, mark: 'M',
        savedAt: Date.now() - age })), age);
      await page.reload({ waitUntil: 'networkidle' });
      return page.evaluate(() => doc.mark === 'M');
    };
    check(await kept(29 * 86400000), 'a Journey Log saved 29 days ago is kept');
    check(!await kept(31 * 86400000), 'a Journey Log saved 31 days ago is removed');
    check(await page.evaluate(() => localStorage.getItem('journeylog.v1') === null),
          'and its stored copy is gone too');
    await page.close();
  }

  /* ---- one page reaches the other ---- */
  {
    const { page } = await open('index.html');
    await page.locator('#jlogBtn').click();
    await page.waitForURL(/journey-log\.html/);
    check(await page.title() === 'Journey Log — Задание на полет', 'the Journey Log button crosses over');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length){
  console.error('\nsmoke test failed:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('\nsmoke test passed');
