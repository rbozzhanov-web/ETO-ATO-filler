import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.png':'image/png', '.webmanifest':'application/manifest+json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404).end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const cases = [
  ['iPhone portrait', 390, 844], ['iPhone landscape', 844, 390],
  ['iPad mini portrait', 744, 1133], ['iPad mini landscape', 1133, 744],
  ['iPad Pro portrait', 1024, 1366], ['iPad Pro landscape', 1366, 1024],
];
const failures = [];
const check = (ok, what) => ok ? console.log('  ok  ' + what) : failures.push(what);

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width:1024, height:1366 }, deviceScaleFactor:2, isMobile:true, hasTouch:true
});

try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + 'index.html', { waitUntil:'networkidle' });
  await page.evaluate(() => {
    T0 = 600;
    RESULT = [
      { i:0, sec:1, wp:'DEP',  et:'0.00', cum:0,   t:600, rem:30000, page:0 },
      { i:1, sec:1, wp:'TOC',  et:'0.20', cum:20,  t:620, rem:27000, page:0 },
      { i:2, sec:1, wp:'WPT1', et:'0.45', cum:65,  t:665, rem:23000, page:1 },
      { i:3, sec:1, wp:'WPT2', et:'0.55', cum:120, t:720, rem:19000, page:1 },
      { i:4, sec:1, wp:'DEST', et:'1.05', cum:185, t:785, rem:15000, page:2 },
    ];
    render(600, 785);
    renderAlt();
    // This synthetic route bypasses the loaded-plan UI transition. Mirror the
    // visible Step 3 parent plus its nested Actuals section before touch tests.
    document.querySelector('#c2').classList.remove('hide');
    document.querySelector('#c3').classList.remove('hide');
  });

  for (const [name, width, height] of cases){
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(30);
    const layout = await page.evaluate(() => ({
      bodyOverflow: document.documentElement.scrollWidth - innerWidth,
      cardRight: Math.max(...[...document.querySelectorAll('.card')].map(e => e.getBoundingClientRect().right), 0),
      width: innerWidth,
    }));
    check(layout.bodyOverflow <= 2, `${name}: no document-level horizontal overflow`);
    check(layout.cardRight <= layout.width + 2, `${name}: cards stay inside the viewport`);

    const first = page.locator('#tbl tbody input.ato:visible').first();
    await first.tap();
    // The keypad deliberately slides for 220 ms. Geometry measured before that
    // transition finishes describes an animation frame, not the docked state.
    await page.waitForTimeout(260);
    const pad = await page.locator('#numpad').evaluate(e => {
      const r = e.getBoundingClientRect();
      return { shown:e.classList.contains('show'), left:r.left, right:r.right, bottom:r.bottom,
               width:innerWidth, height:innerHeight };
    });
    check(pad.shown, `${name}: custom numpad opens`);
    check(pad.left >= -1 && pad.right <= pad.width + 1, `${name}: numpad stays within horizontal bounds`);
    check(Math.abs(pad.bottom - pad.height) <= 2, `${name}: numpad stays docked to viewport bottom`);
    await page.locator('#numpadHide').dispatchEvent('pointerdown');
    await page.waitForTimeout(260);
  }
  check(errors.length === 0, 'viewport matrix produces no browser errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await page.close();

  const jl = await context.newPage();
  const jlErrors = [];
  jl.on('pageerror', e => jlErrors.push(e.message));
  await jl.goto(base + 'journey-log.html', { waitUntil:'networkidle' });
  for (const [name, width, height] of cases){
    await jl.setViewportSize({ width, height });
    const ok = await jl.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2);
    check(ok, `${name}: Journey Log chrome has no horizontal overflow before load`);
  }
  check(jlErrors.length === 0, 'Journey Log viewport matrix produces no page errors');
  await jl.close();
} finally {
  await browser.close();
  server.close();
}

if (failures.length){
  console.error('\nWebKit viewport regression failed:');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('\nWebKit viewport regression passed');
