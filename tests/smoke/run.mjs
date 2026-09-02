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

    check(await page.locator('#drop').isVisible(), 'the load box is shown');
    check(await page.locator('#clearStored').isVisible(), 'stored-data controls are shown');
    check((await page.locator('#storedNote').textContent()).includes('No other flight'),
          'the stored-flight count is filled in');

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
    check(injected.checks === 2, 'the altimeter checks are laid out');
    check(injected.chips === 1, 'the direct-to chip is shown');

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
