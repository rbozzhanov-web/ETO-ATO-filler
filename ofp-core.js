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
const wrapMin = m => { while (m < -720) m += 1440; while (m >= 720) m -= 1440; return m; };
const sinceDueAt = (nowMin, target) => wrapMin(nowMin - norm(target));

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
   One an hour from takeoff. */
function hourlyChecks(result, t0){
  const main = result.filter(p => p.sec === 1);
  if (!main.length) return [];
  const total = main[main.length - 1].cum, out = [];
  // A check falling inside the last hour before arrival is not raised — by then the
  // descent is under way and the reading would be taken on approach anyway.
  for (let mark = 60; total - mark >= 60; mark += 60){
    const wp = main.find(p => p.cum >= mark);
    if (!wp || out.some(c => c.wp === wp)) continue;
    out.push({ mark, wp, due: t0 + mark, label: `+${mark / 60}:00` });
  }
  // Under two hours the grid above never fires, yet a check is still owed — the
  // OFP's own waypoint table always carries a TOC line, and that is the natural
  // point of levelling into cruise the hourly grid is standing in for anyway.
  if (!out.length){
    const toc = main.find(p => /^TOC$/i.test(p.wp));
    if (toc) out.push({ mark: toc.cum, wp: toc, due: t0 + toc.cum, label: 'TOC' });
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

/* ---------- stored flight data ----------
   A plan's saved state is keyed by the PDF's own SHA-256, so two files share a
   key only if they are the same file. legacyKeyFor is the name-and-size key
   used before that, kept for the one-time carry-over and for the case where no
   digest is available at all. */
const PLAN_PREFIX = 'etofill:plan:';
const SETTING_KEYS = new Set(['etofill:theme', 'etofill:wxhi', 'etofill:last']);
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

// In the browser this file is a classic script and these are simply globals.
// Under Node — the test runner — it is a CommonJS module, and this is its export.
if (typeof module !== 'undefined' && module.exports)
  module.exports = { norm, fmt, hhmm, parseTime, validFuelEntry, wrapMin, sinceDueAt, computeResult,
                     hourlyChecks, fuelBox, fuelChecks, directSkips,
                     PLAN_PREFIX, SETTING_KEYS, legacyKeyFor, planKeyFor, planKeysIn, prunePlans };
