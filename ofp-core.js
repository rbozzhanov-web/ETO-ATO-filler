/* ofp-core — the flight-plan arithmetic behind the OFP companion.

   Everything here is a pure function of its arguments: no DOM, no storage, no
   clock of its own. The app in app.js holds the loaded plan, the entered
   actuals and the wall clock, and hands them in; the test suite hands in
   fixtures instead. That is the whole reason this file is separate — the
   numbers a crew flies on are checked on the ground, by tests, and not only by
   reading the app. */

/* ---------- times ----------
   Minutes since midnight UTC throughout. norm() folds a time back into the day;
   a duration (time en route) is not folded, so hhmm() does not use it. */
const norm = m => ((m % 1440) + 1440) % 1440;
const fmt = m => String(Math.floor(norm(m) / 60)).padStart(2, '0') + String(norm(m) % 60).padStart(2, '0');
const hhmm = m => Math.floor(m / 60) + '.' + String(m % 60).padStart(2, '0');

// HHMM as typed, or null when it is not a time. Anything but four digits, an
// hour past 23 or a minute past 59 is rejected rather than guessed at.
function parseTime(v){
  const d = String(v ?? '');
  if (!/^\d{4}$/.test(d)) return null;
  const h = +d.slice(0, 2), m = +d.slice(2);
  return (h > 23 || m > 59) ? null : h * 60 + m;
}

// Fuel entries are deliberately conservative: the app does not invent an
// aircraft-specific upper limit, but an empty, non-numeric, zero or overlong
// value cannot satisfy an in-flight fuel check.
function validFuelEntry(v){
  const d = String(v ?? '');
  return /^\d{1,5}$/.test(d) && +d > 0;
}

// A difference between two times of day, read the short way round: a flight is
// never twelve hours out from its own plan, so a larger gap is the day rolling
// over rather than the aeroplane being half a day late.
// Arithmetic rather than a loop: a loop never finishes on an infinite input.
const wrapMin = m => ((m + 720) % 1440 + 1440) % 1440 - 720;
const sinceDueAt = (nowMin, target) => wrapMin(nowMin - norm(target));

// The same, once a takeoff time is known to anchor it: both times are placed on
// the flight's own timeline, from six hours before takeoff to eighteen after,
// rather than read the short way round the clock. The short way cannot tell a
// waypoint thirteen hours ahead from one eleven hours behind, so on a sector
// longer than twelve hours the far end of the route read as already passed
// from the moment of takeoff.
const FLIGHT_BEFORE = 360;
function sinceDueFrom(nowMin, target, t0){
  const rel = m => norm(m - t0 + FLIGHT_BEFORE) - FLIGHT_BEFORE;
  return rel(nowMin) - rel(target);
}

/* ---------- the ETO table ----------
   Each waypoint carries its cumulative time from the start of its own section.
   The main route runs from takeoff; the alternate runs from arrival at the
   destination, which is where the diversion would begin. */
function computeResult(plan, t0, withAltn){
  const main = plan.filter(p => p.sec === 1);
  const arr = main.length ? t0 + main[main.length - 1].cum : t0;
  const rows = plan.filter(p => p.sec === 1 || (withAltn && p.sec === 2))
                   .map(p => ({ ...p, t: (p.sec === 1 ? t0 : arr) + p.cum }));
  return { rows, arr };
}

/* ---------- altimeter cross-checks ----------
   The first check is always taken at the top of climb, on every flight — the
   moment the aeroplane actually levels into cruise, rather than wherever the
   hourly grid next happens to fall. Every OFP's own waypoint table carries a
   TOC line. After that, one an hour from takeoff. */
function hourlyChecks(result, t0){
  const main = result.filter(p => p.sec === 1);
  if (!main.length) return [];
  const total = main[main.length - 1].cum, out = [];
  const toc = main.find(p => /^TOC$/i.test(p.wp));
  if (toc) out.push({ mark: toc.cum, wp: toc, due: t0 + toc.cum, label: 'TOC' });
  // A check falling inside the last hour before arrival is not raised — by then the
  // descent is under way and the reading would be taken on approach anyway.
  for (let mark = 60; total - mark >= 60; mark += 60){
    // Already covered by the TOC check above — a climb running past the first
    // hourly mark must not raise a second check for the same stretch of it.
    if (toc && mark <= toc.cum) continue;
    const wp = main.find(p => p.cum >= mark);
    if (!wp || out.some(c => c.wp === wp)) continue;
    out.push({ mark, wp, due: t0 + mark, label: `+${mark / 60}:00` });
  }
  return out;
}

/* ---------- fuel checks ----------
   flown: the main-route waypoints still being overflown, in order.
   hasFuel(p): a fuel figure has been written against this waypoint.
   atTime(p, off): when the aeroplane actually passes it. */

// A Direct-To leaves a visible hole in the original waypoint indexes: two
// consecutive points in `flown` are no longer consecutive in the OFP. If the
// left edge of such a hole falls inside this fuel window, waypoints earlier in
// the same window were already behind the aircraft when the Direct was taken.
// They must not become the newly assigned fuel-check box just because every
// later waypoint before the half-hour mark was skipped.
function fuelGapCut(flown, c, off){
  const at = p => p.cum + off;
  let cut = null;
  for (let i = 1; i < flown.length; i++){
    const left = flown[i - 1], right = flown[i];
    const li = +left.i, ri = +right.i;
    if (!Number.isFinite(li) || !Number.isFinite(ri) || ri <= li + 1) continue;
    const t = at(left);
    if (t > c.from && t <= c.to) cut = cut === null ? t : Math.max(cut, t);
  }
  return cut;
}

// Where a check can be written: the waypoints inside the window, or — when a
// direct has cut them all out — the first one actually overflown after it.
function fuelBox(flown, c, off){
  // A fuel figure entered before a Direct remains a valid completed check. The
  // placement logic below may have moved the unfilled box forward, so fuelChecks
  // records that exceptional completed point on the window itself.
  if (c.doneAt) return [c.doneAt];
  const at = p => p.cum + off;
  const cut = fuelGapCut(flown, c, off);
  const floor = cut === null ? c.from : Math.max(c.from, cut);
  const inw = flown.filter(p => at(p) > floor && at(p) <= c.to);
  if (inw.length) return inw;
  const nxt = flown.find(p => at(p) > c.to);
  return nxt ? [nxt] : [];
}

function fuelChecks(flown, off, hasFuel, atTime){
  if (!flown.length) return [];
  const at = p => p.cum + off;
  const total = flown[flown.length - 1].cum + off, out = [];
  // Each window starts where the last one actually ended — not on a grid fixed to
  // takeoff. A figure entered before its window's own thirty minutes are up is a
  // check made early, and the next thirty minutes run from there: without this the
  // grid stays put regardless, and a check made five minutes into a window still
  // leaves the next one due on the old mark, up to fifty-five minutes later.
  for (let anchor = 0; anchor + 30 <= total; ){
    const c = { from: anchor, to: anchor + 30 };
    // Only past the end of the flight is a window dropped. The half-hour rule runs
    // on the clock, so a direct that empties a window does not excuse its check —
    // fuelBox hands it the next waypoint actually overflown instead.
    const box = fuelBox(flown, c, off);
    if (!box.length) break;
    c.mark = c.to;
    // The check falls due when the aeroplane actually passes the waypoint it sits
    // on, so the time follows the ATOs as they are entered rather than standing on
    // a half-hour grid drawn at takeoff.
    c.due = atTime(box[box.length - 1], off);

    // A Direct may move the still-unfilled box forward past the half-hour mark,
    // but a fuel figure already recorded earlier in this same window still counts.
    // Include both the original in-window points and the post-gap fallback box when
    // looking for the entry that restarts the next thirty minutes.
    const candidates = flown.filter(p => at(p) > c.from && at(p) <= c.to);
    for (const p of box) if (!candidates.includes(p)) candidates.push(p);
    const early = candidates.filter(hasFuel).sort((a, b) => at(a) - at(b))[0];
    if (early && !box.includes(early)) c.doneAt = early;

    out.push(c);
    anchor = early ? at(early) : c.to;
  }
  return out;
}

/* ---------- direct to ----------
   A direct takes waypoints out of the route, not out of the sky: the aeroplane
   still goes past them, so they keep their place on the clock as abeam
   positions. This returns the ones a clearance direct to result[n] cuts out,
   given the last waypoint already passed at index ci. */
function directSkips(result, ci, n, isSkipped){
  const skipped = [];
  for (let k = ci + 1; k < n; k++) if (!isSkipped(result[k].i)) skipped.push(result[k].i);
  return skipped;
}

/* Which of those abeam positions the crew is working on, as indexes into result:
   ci the one being passed now, ni the one still ahead, -1 for neither. It follows
   the times actually written down rather than the clock — a direct cuts a corner,
   so an abeam point is passed earlier than its printed time and the clock would
   go on pointing at one already logged. A point with a time against it is behind
   the aeroplane, so the one to attend to is the first still without one; the
   clock then only says whether that one is being passed now or is still ahead,
   and once any of them has been logged the aeroplane is demonstrably in among
   them. With every one of them written up there is nothing abeam left to watch. */
function abeamAt(result, isSkipped, hasTime, passed){
  let cur = -1, logged = false;
  result.forEach((p, n) => {
    if (!isSkipped(p)) return;
    if (hasTime(p)){ logged = true; return; }
    if (cur < 0) cur = n;
  });
  if (cur < 0) return { ci: -1, ni: -1 };
  return (logged || passed(result[cur])) ? { ci: cur, ni: -1 } : { ci: -1, ni: cur };
}

/* ---------- mandatory reads ----------
   Company documents the crew is meant to have read before dispatch, carried at
   the back of the package as "MAN nnn-yy" attachments. They are read as the PDF
   itself — the app only needs to know which pages they are. Every page of one
   carries the same "MAN nnn-yy / Issue / Revision" head and a "MAN nnn-yy …
   page n of m" foot; only the first carries the MANDATORY READ title and the
   SUBJECT line its card is named by. (Recognition ported from the OFP viewer,
   where it was checked against a real Air Astana package.)

   The lines are taken in the order the page draws them rather than sorted by x:
   these pages are set in a justified, proportional font, where that order is
   the reading order and an x-sort is not. */
function manPage(items, page){
  if (items.length < 30) return null;
  const rows = [];
  let cur = null;
  for (const it of items){
    const y = Math.round(it.y * 2) / 2;
    if (!cur || cur.y !== y){ cur = { y, s: '' }; rows.push(cur); }
    cur.s += it.str;
  }
  rows.sort((a, b) => b.y - a.y);
  // WinAnsi quotes and dashes (0x80–0x9F) arrive as control codes; mapped back
  // so a subject reads as printed. Anything else unprintable is dropped.
  const C1 = ['€','','‚','ƒ','„','…','†','‡','ˆ','‰','Š','‹','Œ','','Ž','',
              '','‘','’','“','”','•','–','—','˜','™','š','›','œ','','ž','Ÿ'];
  const lines = rows.map(r => r.s
      .replace(/[\u0080-\u009f]/g, c => C1[c.charCodeAt(0) - 0x80])
      .replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const hm = (lines[0] || '').match(/^MAN\s+(\d{2,4}-\d{2})$/i);
  if (!hm) return null;
  const man = hm[1];
  if (!lines.some(l => new RegExp('^MAN\\s+' + man + '\\b.*\\bpage\\s*\\d+\\s*of\\s*\\d+', 'i').test(l)))
    return null;

  let issue = null, rev = null, m;
  for (let i = 1; i < lines.length && i < 4; i++){
    if ((m = lines[i].match(/^Issue\s+(\S+)/i))) issue = m[1];
    else if ((m = lines[i].match(/^Revision\s+(\S+)/i))) rev = m[1];
    else break;
  }
  const field = re => { const l = lines.find(x => re.test(x)); return l ? l.replace(re, '').trim() : null; };
  return { man, page, issue, rev,
           first: lines.some(l => /^MANDATORY READ\b/i.test(l)),
           subject: field(/^SUBJECT:\s*/i), applic: field(/^APPLICABILITY:\s*/i) };
}

// The pages of each document, grouped by its MAN number in the order they were
// read. Only a number whose first page carried the MANDATORY READ title counts.
function mandatoryReads(manPages){
  const by = new Map();
  for (const r of manPages){
    if (!by.has(r.man)) by.set(r.man, { man: r.man, first: false, issue: null, rev: null,
                                        subject: null, applic: null, pages: [] });
    const d = by.get(r.man);
    d.first = d.first || r.first;
    for (const k of ['issue', 'rev', 'subject', 'applic']) if (r[k] && !d[k]) d[k] = r[k];
    d.pages.push(r.page);
  }
  return [...by.values()].filter(d => d.first).map(({ first, ...d }) => d);
}

/* ---------- what else the package carries ----------
   A briefing package is the OFP's own numbered pages ("AIR ASTANA BRIEF PAGE 7
   OF 80") and, behind them, whatever else was attached to this flight — an
   operational briefing, an Operations Manual excerpt, a de-icing status table,
   a mandatory read. Nothing in the app may hide any of it: what it does not set
   out itself, it lists, so it is noticed, and opens as printed. These read the
   package's shape, not a fixed list of what it may hold, so a section or an
   attachment the airline adds later is listed the same way. */

// The brief's own page marking, as one text item: "AIR ASTANA BRIEF PAGE 7 OF 80"
// or the plain "PAGE 7 OF 80" it also prints.
const BRIEF_MARK = /^(?:.*\bBRIEF\s+)?PAGE\s+\d+\s+OF\s+\d+$/i;
const briefPage = items => items.some(it => BRIEF_MARK.test(it.str.trim()));

// A title for an attached page: its largest type in the top part of the page,
// taken in the order the page draws it — an attachment set in a proportional
// font does not read in x order — and cleaned of what a symbol font leaves.
function attachmentTitle(items, height){
  const runs = [];
  let cur = null;
  for (const it of items){
    if (!cur || Math.abs(it.y - cur.y) > it.size * 0.6 || Math.abs(it.size - cur.size) > 0.5){
      cur = { y: it.y, size: it.size, s: '' };
      runs.push(cur);
    }
    cur.s += it.str;
  }
  const clean = t => t.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  const top = runs.map(r => ({ ...r, s: clean(r.s) }))
    .filter(r => r.y > height * 0.55 && /[A-Za-z]{3}/.test(r.s))
    .sort((a, b) => b.size - a.size || b.y - a.y)[0];
  return top ? (top.s.length > 90 ? top.s.slice(0, 89) + '…' : top.s) : null;
}

// The attached documents: every page the brief does not mark as its own, apart
// from a mandatory read's, which are listed by subject on their own. Pages run
// together into one document while they follow on and keep the same page size.
function groupAttachments(pages, skip){
  const out = [];
  pages.forEach((pg, n) => {
    if (pg.brief || skip.has(n)) return;
    const last = out[out.length - 1];
    if (last && last.pages[last.pages.length - 1] === n - 1 && last.size === pg.size)
      last.pages.push(n);
    else out.push({ pages: [n], size: pg.size, title: pg.title });
  });
  return out.map(({ size, ...d }) => d);
}

/* The brief's own sections, as a contents list with the page each starts on.
   Its headings are recognised by how the brief sets them, not by name:
   "--- OVERFLIGHT PERMITS", "START OF WIND AND TEMPERATURE SUMMARY …", a
   heading underlined by a single run of dashes, a SIGMET / AIRMET / PIREP
   report or the line saying there is none. The aerodrome reports and NOTAMs,
   the FIR NOTAMs and the company NOTAMs are entered once each, where they
   begin. lines: { page, text } in reading order, brief pages only. */
function briefSections(lines){
  const out = [], seen = new Set();
  const add = (title, page) => { if (!seen.has(title)){ seen.add(title); out.push({ title, page }); } };
  for (let i = 0; i < lines.length; i++){
    const t = lines[i].text.trim(), next = (lines[i + 1] || {}).text || '', page = lines[i].page;
    let m;
    // A heading after the dashes starts with a word; a waypoint row whose
    // frequency is printed as dashes ("------ 28 N2518.5 …") does not.
    if ((m = t.match(/^-{2,}\s*([A-Z][A-Za-z]+\b[A-Za-z0-9 /&().,'-]*?)\s*-*$/))) add(m[1], page);
    else if ((m = t.match(/^START OF (.+)$/))) add(m[1], page);
    // The package-wide report searches only, not each aerodrome's missing TAF.
    else if ((m = t.match(/^NO ([A-Z]+) REPORTS FOUND WITHIN\b/))) add(m[1] + ' — none found', page);
    else if ((m = t.match(/^(SIGMET|AIRMET|PIREP)S?\b/))) add(m[1] + ' reports', page);
    else if (/^(DEPARTURE|ARRIVAL):/.test(t)) add('Aerodrome weather and NOTAMs', page);
    else if (/^Fir:\s*[A-Z]{4}\b/i.test(t)) add('FIR NOTAMs', page);
    else if (/ COMPANY NOTAMS(?::\s*NIL)?$/.test(t)) add('Company NOTAMs', page);
    else if (/^-{5,}$/.test(next.trim()) && /^[A-Z][A-Z0-9 /&().,'-]{5,}$/.test(t) && !/^END OF\b/.test(t))
      add(t, page);
  }
  return out.sort((a, b) => a.page - b.page);
}

/* ---------- stored flight data ----------
   A plan's saved state is keyed by the PDF's own SHA-256, so two files share a
   key only if they are the same file. legacyKeyFor is the name-and-size key
   used before that, kept for the one-time carry-over and for the case where no
   digest is available at all. */
const PLAN_PREFIX = 'etofill:plan:';
const SETTING_KEYS = new Set(['etofill:theme', 'etofill:wxhi', 'etofill:last', 'etofill:view', 'etofill:wt', 'etofill:ntmorder']);
const legacyKeyFor = (name, size) => 'etofill:' + name + ':' + size;
const planKeyFor = (hash, name, size) => hash ? PLAN_PREFIX + hash : legacyKeyFor(name, size);

// Every key this app has ever written a plan's state under, out of a
// localStorage-shaped store: the content-addressed ones and the older
// name-and-size ones, but none of the device-wide settings.
function planKeysIn(store){
  const out = [];
  try {
    for (let i = 0; i < store.length; i++){
      const k = store.key(i);
      if (!k || !k.startsWith('etofill:') || SETTING_KEYS.has(k)) continue;
      out.push(k);
    }
  } catch(e){}
  return out;
}

// Operational data does not sit on a shared tablet for ever: entries age out
// after retainDays, and only the maxPlans most recent survive. Returns the keys
// removed. An entry written before this app kept a clock is stamped on first
// sight, so it ages from here rather than staying for good.
function prunePlans(store, now, retainDays, maxPlans){
  const cutoff = now - retainDays * 86400000, kept = [], dropped = [];
  const drop = k => { dropped.push(k); try { store.removeItem(k); } catch(e){} };
  for (const k of planKeysIn(store)){
    let st = null;
    try { const raw = store.getItem(k); st = raw ? JSON.parse(raw) : null; } catch(e){ st = null; }
    if (!st){ drop(k); continue; }
    if (typeof st.savedAt !== 'number'){
      st.savedAt = now;
      try { store.setItem(k, JSON.stringify(st)); } catch(e){}
    }
    if (st.savedAt < cutoff){ drop(k); continue; }
    kept.push({ k, at: st.savedAt });
  }
  kept.sort((a, b) => b.at - a.at);
  for (const e of kept.slice(maxPlans)) drop(e.k);
  return dropped;
}

/* ---- a navigation aid out of use ----
   What the Q-line would say as subject I (ILS and its parts) or N (VOR, DME,
   NDB, TACAN, locators, DF), with condition AS unserviceable, AU not available,
   AC/AW withdrawn or CT on test — read off the free text, the way the packages
   print it: Doc 8400's own abbreviations for both halves ("DVOR/DME KDR FREQ
   116.0MHZ/107X U/S", "RWY 28 LLZ U/S", "GP 28L NOT AVBL"). Both have to be
   there: a taxiway NOT AVBL is not a navaid, and a VOR named in a procedure
   still in use is not out. LOC alone also means "location" in Doc 8400, so it
   counts only beside a runway, a slash or a DME; an RNAV (GNSS) approach is a
   procedure, not the satellites, so its name is set aside before GNSS is read. */
const RE_NAVAID = new RegExp('\\b(?:' + [
  'D?VOR', 'CVOR', 'VORTAC', 'TACAN', 'DME', 'NDB', 'ILS', 'LLZ', 'LOCALI[SZ]ER',
  'LOC(?=\\s*(?:\\/|RWY|DME|U\\/S|\\d))', 'GP', 'GLIDE\\s*(?:PATH|SLOPE)', 'MLS', 'GBAS', 'GLS',
  'LOCATOR', '(?:OUTER|MIDDLE|INNER)\\s+MARKER', 'DIRECTION\\s+FINDING', 'VDF', 'GNSS', 'GPS', 'NAVAIDS?'
].join('|') + ')\\b');
const RE_OUT_OF_USE = new RegExp([
  '\\bU\\/S\\b', '\\bUNSERVICEABLE\\b', '\\bNOT\\s+(?:AVBL|AVAILABLE)\\b', '\\bUNAVBL\\b',
  '\\bUNAVAILABLE\\b', '\\bOUT\\s+OF\\s+SERVICE\\b', '\\bOTS\\b', '\\bON\\s+TEST\\b', '\\bDO\\s+NOT\\s+USE\\b',
  '\\bWITHDRAWN\\b', '\\bDECOMMISSIONED\\b', '\\bINOP(?:ERATIVE)?\\b'
].join('|'));
function navaidOut(text){
  const t = String(text || '').toUpperCase().replace(/\bRNAV\s*\(\s*GNSS\s*\)/g, 'RNAV');
  return RE_NAVAID.test(t) && RE_OUT_OF_USE.test(t);
}

// In the browser this file is a classic script and these are simply globals.
// Under Node — the test runner — it is a CommonJS module, and this is its export.
if (typeof module !== 'undefined' && module.exports)
  module.exports = { norm, fmt, hhmm, parseTime, validFuelEntry, wrapMin, sinceDueAt, sinceDueFrom, computeResult,
                     hourlyChecks, fuelBox, fuelChecks, directSkips, abeamAt,
                     manPage, mandatoryReads, briefPage, attachmentTitle, groupAttachments, briefSections, navaidOut,
                     PLAN_PREFIX, SETTING_KEYS, legacyKeyFor, planKeyFor, planKeysIn, prunePlans };
