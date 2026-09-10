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

    /* The bug this guards: logging an ATO is itself a touch, so it resets the
       twenty-second gate the same as anything else — but if the box it was
       entered into is left open on the keypad (the crew pauses before the
       fuel figure, say) and the tracked waypoint has since moved on by the
       time the gate actually releases, the table used to pull itself to the
       NEW target's top, dragging the row an entry is still open against out
       from under the keypad. With a box open, the release should centre that
       row instead of top-anchoring whichever one is now tracked. */
    const centerAfterGate = await page.evaluate(async () => {
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

      // Focus WPT5's ATO box the way the on-screen keypad does, then log it
      // -- moving the tracked target on to WPT6 -- but leave the box focused,
      // same as a real entry stays open until Enter moves on.
      const inp = document.querySelector('#tbl tbody tr[data-i="5"] input.ato');
      inp.focus();
      await settle();
      const scrollAfterFocus = box.scrollTop;

      inp.value = fmt(now); inp.dispatchEvent(new Event('input'));
      await settle();
      const scrollAfterEntry = box.scrollTop;

      // Twenty-one seconds later, still nothing else touched and the box
      // still open: the gate now releases.
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor(...a){ if (a.length) return new RealDate(...a); return new RealDate(RealDate.now() + 21000); }
        static now(){ return RealDate.now() + 21000; }
      }
      window.Date = FakeDate;
      refreshProgress();
      window.Date = RealDate;
      await settle();
      const scrollAfterQuiet = box.scrollTop;

      // What a top-pin on the new target (WPT6) would have wanted, for
      // comparison -- the exact wrong answer this fix moves away from.
      const row6 = rowOf(6);
      const head = box.querySelector('thead'), headH = head.offsetHeight;
      const anchor = row6.previousElementSibling || row6;
      const rel = anchor.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      const wouldBeTopPin = Math.round(Math.max(0, Math.min(rel - headH, box.scrollHeight - box.clientHeight)));

      const nextWp = () => RESULT.find(p => rowOf(p.i)?.classList.contains('next'))?.wp || null;
      return {
        entryTarget: nextWp(), scrollAfterFocus, scrollAfterEntry, scrollAfterQuiet, wouldBeTopPin,
        stillEditing: document.activeElement === inp
      };
    });
    check(centerAfterGate.entryTarget === 'WPT6',
          'tracking still advances past the waypoint just logged, entry left open or not');
    check(centerAfterGate.stillEditing,
          'the box being typed into is left focused, matching a real entry not yet closed with Enter');
    check(centerAfterGate.scrollAfterEntry === centerAfterGate.scrollAfterFocus,
          'logging the ATO is itself a touch, so it does not release the gate any sooner than any other touch would');
    check(Math.abs(centerAfterGate.scrollAfterQuiet - centerAfterGate.scrollAfterFocus) < 20,
          'once the gate releases, the box left open stays roughly where it already was centred');
    check(Math.abs(centerAfterGate.scrollAfterQuiet - centerAfterGate.wouldBeTopPin) > 40,
          'the row an entry is still open against is not top-anchored away once the tracked waypoint moves on');

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
