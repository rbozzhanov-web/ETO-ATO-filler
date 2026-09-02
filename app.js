const $ = s => document.querySelector(s);
let RAW = null, DOC = null, NAME = '', SIZE = 0, HASH = null, KEY = '';
let PLAN = null, HDRS = [], ANCHOR = 0, RESULT = [], FIELDS = [], FPL = null, CHECKS = [], FUEL = [], T0 = null;
const ACT = {}, TXT = {}, ALT = {};

/* fixed print palette */
const C = { eto:'#0033cc', ato:'#00762e', fuel:'#000000', pos:'#00762e', neg:'#cc0000', doc:'#0033cc' };
const BOLD = 'FB';                                   // Courier-Bold resource name
// digits-only fields carry inputMode "none", which keeps Safari's own keyboard
// off — the on-screen numpad wired in below stands in for it, which is what the
// numkey class on each of these fields asks for — and a [0-9]* pattern, which
// keeps a pasted or dictated non-digit out. cellInput() sets both.

const msg = (sel, t, k) => { const e = $(sel); e.className = 'msg show ' + (k || 'ok'); e.textContent = t; };
const hide = sel => { $(sel).className = 'msg'; };

/* ================= DOM helpers =================
   Everything this app displays that came out of a PDF is written as text, never
   as markup: a waypoint name, an aerodrome name, a NOTAM or a document field is
   attacker-controlled the moment a crafted package is opened, and innerHTML
   would hand it the page. These two are the only way nodes are made below. */
function mk(tag, cls, text){
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function clear(n){ while (n.firstChild) n.removeChild(n.firstChild); }

/* ================= numeric keypad =================
   iOS's own numeric keyboard, deliberately not raised (see above): this bar
   stands in for it on every field marked .numkey, docked to the bottom the same
   way and sliding the same way, so swapping it in reads as the system's own
   behaviour rather than a page doing something unusual. */
let NP_TARGET = null;
const numpad = $('#numpad');
// A field gaining focus opens the keypad by default — a tap, Tab, a hardware
// keyboard's own Up/Down between fields, even Safari's own native field-
// navigation chevrons in a text field's accessory bar, none of which raise an
// event this page can see happening first. The one call that must NOT open it
// is the app's own: focusing the takeoff time right after a plan loads, so
// typing can start at once without the keypad shouldering the drop zone out of
// the way. That single call marks this one-shot flag immediately before it;
// nothing else ever needs to.
let NP_SUPPRESS_NEXT = false;
function npSuppressNext(){ NP_SUPPRESS_NEXT = true; }
// Setting .value from script, unlike real typing, never sets a field's own
// dirty flag — so blurring it afterwards raises no native change event, only
// the input events dispatched below. Journey Log's HH:MM formatting (and
// anything else keyed off change rather than input) would otherwise never run
// for a box filled from this keypad. NP_DIRTY tracks that a flush is owed, and
// npFlushChange fires the change event by hand at the moment the field
// actually stops being edited — see its callers in npShow/npHide.
let NP_DIRTY = false;
function npFlushChange(){
  if (NP_TARGET && NP_DIRTY) NP_TARGET.dispatchEvent(new Event('change', { bubbles: true }));
  NP_DIRTY = false;
}
function npInsert(ch){
  const el = NP_TARGET;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + ch + el.value.slice(end);
  el.setSelectionRange(start + ch.length, start + ch.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  NP_DIRTY = true;
}
function npDelete(){
  const el = NP_TARGET;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  const from = start === end ? Math.max(0, start - 1) : start;
  el.value = el.value.slice(0, from) + el.value.slice(end);
  el.setSelectionRange(from, from);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  NP_DIRTY = true;
}
// The action key's own label follows enterkeyhint, the same way the system
// keyboard's would have: Next on a field that has one to jump to, Go on the
// takeoff time, Done everywhere else.
const NP_LABEL = { next: 'Next', go: 'Go', done: 'Done', previous: 'Previous', search: 'Search', send: 'Send' };
// Whether Shift+Enter on this field actually goes anywhere: the table walks its
// own flat list of inputs, the document fields their own run of fd-numbered ids,
// neither the takeoff time nor an altimeter row (which has no Enter handling of
// its own at all, forward or back) ever has a field before it worth returning to.
function npHasPrev(el){
  if (el.matches('#tbl input')){
    const all = [...document.querySelectorAll('#tbl input')];
    return all.indexOf(el) > 0;
  }
  if (el.matches('#altrows input')){
    const all = [...document.querySelectorAll('#altrows input')];
    return all.indexOf(el) > 0;
  }
  const m = el.id.match(/^fd(\d+)$/);
  return m ? +m[1] > 0 : false;
}
function npShow(el){
  npFlushChange();
  NP_TARGET = el;
  $('#numpadDoneLabel').textContent = NP_LABEL[el.enterKeyHint] || 'Done';
  $('#numpadPrev').disabled = !npHasPrev(el);
  numpad.classList.add('show');
  document.body.style.setProperty('--numpad-h', numpad.offsetHeight + 'px');
  document.body.classList.add('numpad-open');
  requestAnimationFrame(() => { if (NP_TARGET === el) el.scrollIntoView({ block: 'center', behavior: 'auto' }); });
}
function npHide({ revealActuals = false } = {}){
  const el = NP_TARGET;
  npFlushChange();
  NP_TARGET = null;
  numpad.classList.remove('show');
  document.body.classList.remove('numpad-open');
  if (revealActuals) revealActualsAfterNumpad(el);
}
// A synthesized tock rather than a fetched sound file, so the page stays
// self-contained. There is no Web API to read the ring/silent switch or the
// system's own "Keyboard Clicks" setting, so this leans on iOS Safari's own
// behaviour of muting exactly this kind of ambient Web Audio output when the
// switch is set to silent — the same way the system keyboard's own clicks go
// quiet, without this code ever having to know the switch's state itself.
// The system's key sound is percussive, not musical: a broadband transient
// that is over almost before it starts. So it is carved out of noise rather
// than played on an oscillator — a tone at any pitch reads as a beep, which
// is the one thing a keyboard never sounds like. The band-pass sets how
// wooden it is, the low-pass takes the hiss off the top, and the whole thing
// decays inside 25ms.
let NP_ACTX = null, NP_NOISE = null;
function npClick(){
  try{
    NP_ACTX = NP_ACTX || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = NP_ACTX;
    if (ctx.state === 'suspended') ctx.resume();
    // Built once and replayed: the buffer is the same every press, only the
    // envelope is redrawn, which is cheaper than regenerating noise per key.
    if (!NP_NOISE){
      const n = Math.ceil(ctx.sampleRate * .03);
      NP_NOISE = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = NP_NOISE.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = NP_NOISE;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = .7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4200;
    const gain = ctx.createGain();
    // exponential ramps cannot touch zero, hence the floor at both ends.
    // .45 at the gain stage, not at the ear: the two filters take roughly 8dB
    // back out of it, landing the sound near .18 peak — present, but well
    // under the alert tones this app already makes.
    gain.gain.setValueAtTime(.0001, t);
    gain.gain.exponentialRampToValueAtTime(.45, t + .001);
    gain.gain.exponentialRampToValueAtTime(.0001, t + .032);
    src.connect(bp).connect(lp).connect(gain).connect(ctx.destination);
    src.start(t); src.stop(t + .03);
  }catch(e){}
}
// pointerdown, not click: click fires after the field below has already blurred
// from the tap landing outside it, by which point NP_TARGET is already gone.
numpad.querySelectorAll('[data-k]').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault();
  npClick();
  b.dataset.k === 'del' ? npDelete() : npInsert(b.dataset.k);
}));
// The action key plays the field's own Enter handler — the table's "next field",
// the document fields', the takeoff time's calculate-and-blur — exactly as the
// system keyboard's own Next/Go/Done key would have. A field with no handler of
// its own (nothing moves focus away) just closes, which is what Done means there.
$('#numpadDone').addEventListener('pointerdown', e => {
  e.preventDefault();
  const el = NP_TARGET;
  if (!el) return;
  npClick();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  if (document.activeElement === el) el.blur();
});
// Previous plays the same field's own handler backwards — Shift+Enter, exactly
// as it would from a keyboard with a Shift key. Disabled rather than wired to
// close anything when there is nowhere to go, so a stray tap on it never does.
$('#numpadPrev').addEventListener('pointerdown', e => {
  e.preventDefault();
  const el = NP_TARGET;
  if (!el || e.currentTarget.disabled) return;
  npClick();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
});
document.addEventListener('focusin', e => {
  const suppress = NP_SUPPRESS_NEXT; NP_SUPPRESS_NEXT = false;
  if (e.target.matches && e.target.matches('.numkey')){
    if (!suppress) npShow(e.target);
  }
  else if (NP_TARGET) npHide();
});
// Blurring to nothing at all — a field's own handler calling only .blur(), the
// way the takeoff time's does — raises no focusin for the empty focusin listener
// above to catch, so it is caught here instead once the blur has settled.
document.addEventListener('focusout', e => {
  if (e.target !== NP_TARGET) return;
  setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.matches || !a.matches('.numkey')) npHide({ revealActuals: true });
  }, 0);
});
// Closes on its own, unconditionally — unlike the action key, which plays
// whatever the field's own Enter handler does and may only move on to the next
// box. inputmode="none" keeps Safari's keyboard from ever appearing, so none of
// its own dismiss gestures come with it; both this key and the two listeners
// below stand in for those.
function revealActualsAfterNumpad(el){
  if (!el || !el.matches('#tbl input')) return;
  // Wait until the panel and the input focus are both gone. Scrolling any sooner
  // competes with WebKit's focus restoration and can leave the section half-hidden.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const card = $('#c2'), table = card?.querySelector('.tblbox');
    if (!card || !table) return;
    table.style.removeProperty('max-height');
    // The table is already its own scroller. If the complete Step 3 card cannot
    // fit after the keypad closes, shorten that inner viewport just enough for the
    // whole card — takeoff time, Actuals, and the table — to remain on screen.
    const room = innerHeight - 32;
    if (card.getBoundingClientRect().height > room){
      const chrome = card.getBoundingClientRect().height - table.getBoundingClientRect().height;
      table.style.maxHeight = Math.max(160, Math.floor(room - chrome)) + 'px';
    }
    const height = card.getBoundingClientRect().height;
    const top = Math.max(0, scrollY + card.getBoundingClientRect().top - Math.max(0, (innerHeight - height) / 2));
    scrollTo({ top, behavior: 'smooth' });
  }));
}
function npHideForce(){
  const el = NP_TARGET;
  npHide({ revealActuals: true });
  if (el) el.blur();
}
addEventListener('orientationchange', () => setTimeout(() => {
  if (!matchMedia('(orientation: portrait)').matches) $('#c3 .tblbox')?.style.removeProperty('max-height');
}, 0));
$('#numpadHide').addEventListener('pointerdown', e => {
  e.preventDefault(); npClick(); npHideForce();
});
// A tap anywhere outside the field and the keypad itself dismisses it, the way
// tapping elsewhere on the page dismisses the system keyboard. Tapping the field
// again, or another .numkey field, is left alone — the second is already a
// focusin the listener above handles by switching the keypad to it.
document.addEventListener('pointerdown', e => {
  if (!NP_TARGET || e.target === NP_TARGET || numpad.contains(e.target)) return;
  npHideForce();
});
// A real scroll — one following an actual touch or wheel gesture, not the
// keypad's own scrollIntoView bringing the field above it into view — dismisses
// it too, the way scrolling the content behind the system keyboard does.
let NP_GESTURE = false;
// The keypad is a control, not a handle for the page behind it. On iPadOS a
// vertical drag on this fixed panel can otherwise begin a document scroll; that
// scroll is then correctly recognised below, but incorrectly dismisses the pad.
// touch-action covers current browsers and preventDefault covers older WebKit.
numpad.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });
const npGestureElsewhere = e => { if (!numpad.contains(e.target)) NP_GESTURE = true; };
addEventListener('touchmove', npGestureElsewhere, { passive: true });
addEventListener('wheel', npGestureElsewhere, { passive: true });
// Capturing: a scroll inside the waypoint table or the NOTAM list is its own
// element and never bubbles, but the capture phase still reaches it on the way
// down, so one listener here covers every scrollable box on the page.
document.addEventListener('scroll', () => {
  if (NP_GESTURE && NP_TARGET) npHideForce();
  NP_GESTURE = false;
}, { passive: true, capture: true });

// Marks a scrollable box while there is more below it, so the crew can see at a
// glance that the list goes on. Idempotent: safe to call again on the same box.
function scrollHint(el){
  const wrap = el && el.parentElement;
  if (!wrap || !wrap.classList.contains('scrollwrap')) return;
  const head = el.querySelector('thead');
  const upd = () => {
    wrap.toggleAttribute('data-more', el.scrollHeight - el.clientHeight - el.scrollTop > 4);
    wrap.toggleAttribute('data-prev', el.scrollTop > 4);
    if (head) wrap.style.setProperty('--stickyh', head.offsetHeight + 'px');
  };
  if (!el.dataset.hinted){
    el.dataset.hinted = '1';
    // The arrows are elements rather than pseudo-content: a pseudo-element cannot be
    // rotated apart from the strip it also carries, and both of the wrap's are spent
    // on the two strips.
    if (!wrap.querySelector('.chev'))
      for (const dir of ['up', 'dn']){
        const chev = mk('i', 'chev ' + dir);
        chev.setAttribute('aria-hidden', 'true');
        wrap.appendChild(chev);
      }
    el.addEventListener('scroll', upd, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(upd).observe(el);
  }
  upd();
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')){
  let reloading = false;
  function offerUpdate(reg){
    const worker = reg.waiting;
    if (!worker) return;
    const box = $('#mUpd');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sm'; btn.textContent = 'Update now';
    btn.onclick = () => {
      btn.disabled = true;
      btn.textContent = 'Updating…';
      worker.postMessage({ type: 'skip-waiting' });
    };
    box.className = 'msg show ok';
    box.replaceChildren('A new version is ready. ', btn);
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // This only follows an explicit tap on Update now. The page is then reloaded
    // under the new worker whether or not an OFP is open; the app already keeps
    // the document and entries locally for that purpose.
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    offerUpdate(reg);                  // an update found before this page loaded
    reg.addEventListener('updatefound', () => {
      const candidate = reg.installing;
      if (!candidate) return;
      candidate.addEventListener('statechange', () => {
        if (candidate.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
      });
    });
  }).catch(() => {});
}

/* ================= theme ================= */
const hex2rgb = h => { const n = parseInt(h.slice(1), 16);
  return { r:(n >> 16 & 255)/255, g:(n >> 8 & 255)/255, b:(n & 255)/255 }; };
const rgbArr = h => { const c = hex2rgb(h); return [+c.r.toFixed(4), +c.g.toFixed(4), +c.b.toFixed(4)]; };

// dark print colours are unreadable on a dark background — lighten for screen only
function onScreen(h){
  if (document.documentElement.dataset.theme === 'light') return h;
  const c = hex2rgb(h), lum = .2126*c.r + .7152*c.g + .0722*c.b;
  if (lum >= .42) return h;
  const k = (.42 - lum) * 1.3, mix = v => Math.round(255 * (v + (1 - v) * k));
  return `rgb(${mix(c.r)},${mix(c.g)},${mix(c.b)})`;
}
// persist defaults to true — every caller except the device-preference sync
// below wants the choice remembered. That one caller passes false: writing a
// system-derived guess to storage would freeze it there, and every later
// launch would read the stale guess back instead of asking the device again.
function applyTheme(t, persist = true){
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-set]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t === 'dark' ? '#0f1419' : '#f2f5f8';
  const s = document.documentElement.style;
  s.setProperty('--c-eto', onScreen(C.eto));
  s.setProperty('--c-ato', onScreen(C.ato));
  s.setProperty('--c-fuel', onScreen(C.fuel));
  RESULT.forEach(p => paint(p.i));
  if (persist) try { localStorage.setItem('etofill:theme', t); } catch(e){}
}
const guide = $('#guide');
const showGuide = on => {
  guide.classList.toggle('hide', !on);
  document.body.style.overflow = on ? 'hidden' : '';
};
$('#guideBtn').onclick = () => showGuide(true);
$('#jlogBtn').onclick = () => { location.href = './journey-log.html'; };

// Coming back from the Journey Log, which asks for #top: Safari would otherwise
// restore wherever this page was last scrolled to, and the header — and the
// button that crosses back — would not be where it was left.
if (location.hash === '#top'){
  history.replaceState(null, '', location.pathname + location.search);
  scrollTo(0, 0);
  addEventListener('load', () => scrollTo(0, 0), { once: true });
}
$('#guideClose').onclick = () => showGuide(false);
guide.onclick = e => { if (e.target === guide) showGuide(false); };
document.addEventListener('keydown', e => {
  const viewing = !$('#charts').classList.contains('hide');
  if (e.key === 'Escape'){ showGuide(false); if (viewing) openCharts(false); return; }
  if (!viewing) return;
  if (e.key === 'ArrowLeft')  $('#chartPrev').click();
  if (e.key === 'ArrowRight') $('#chartNext').click();
});

document.querySelectorAll('[data-theme-set]').forEach(b =>
  b.onclick = () => applyTheme(b.dataset.themeSet));
(() => {
  let t = null;
  try { t = localStorage.getItem('etofill:theme'); } catch(e){}
  if (t){ applyTheme(t, false); return; }        // an explicit choice from a previous launch
  const mq = matchMedia('(prefers-color-scheme: light)');
  applyTheme(mq.matches ? 'light' : 'dark', false);
  // Until the sun/moon button is actually tapped, the theme keeps following
  // the device's own — flipping the system switch flips this page with it,
  // the same launch or not, rather than freezing on whatever it read once.
  mq.addEventListener('change', e => {
    let saved = null;
    try { saved = localStorage.getItem('etofill:theme'); } catch(err){}
    if (!saved) applyTheme(e.matches ? 'light' : 'dark', false);
  });
})();

/* ================= file loading ================= */
const drop = $('#drop');
drop.onclick = () => $('#file').click();
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over');
  if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
$('#file').onchange = e => { if (e.target.files[0]) load(e.target.files[0]); };

/* ---- pasting a PDF ----
   A desktop convenience only. Safari's clipboard hands a page text/plain,
   text/html, text/uri-list, image/png and its own "web " types — never
   application/pdf — and the paste event carries no files on iOS either, so there
   is no route to a pasted PDF on an iPad however the page asks. The button is
   hidden there rather than left to answer "no PDF on the clipboard" to someone
   who has just copied one. Dragging the file in from Files still works, and so
   does the picker. */
const APPLE_TOUCH = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (APPLE_TOUCH) $('#paste').classList.add('hide');
const pdfOf = list => [...(list || [])].find(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
document.addEventListener('paste', e => {
  const f = pdfOf(e.clipboardData && e.clipboardData.files);
  if (!f) return;
  e.preventDefault();
  load(f);
});
$('#paste').onclick = async () => {
  if (!navigator.clipboard || !navigator.clipboard.read){
    msg('#m1', 'This browser cannot read the clipboard. Use the box above to pick the file.', 'warn');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items){
      const type = item.types.find(t => /pdf$/i.test(t));
      if (!type) continue;
      const blob = await item.getType(type);
      return loadBuffer('pasted.pdf', blob.size, await blob.arrayBuffer(), false);
    }
    msg('#m1', 'No PDF was found on the clipboard. Use the box above to pick the file.', 'warn');
  } catch (err){
    console.warn('Clipboard read failed:', err);
    msg('#m1', 'The clipboard could not be read. Use the box above to pick the file instead.', 'warn');
  }
};

async function load(f){
  return loadBuffer(f.name, f.size, await f.arrayBuffer(), false);
}

// Shared by the file picker and by the session resumed out of IndexedDB after
// iPadOS has evicted the app from memory.
async function loadBuffer(name, size, buf, resumed){
  if (typeof DecompressionStream === 'undefined'){
    msg('#m1', 'This browser is not supported. OFP Companion requires Safari/iPadOS 16.4 or later.', 'err');
    return false;
  }
  // Refused before anything is allocated for it, and with a message that says
  // what happened rather than a parse error out of the engine.
  if (size > PDFMini.LIMITS.bytes){
    msg('#m1', `That file is ${(size / 1048576).toFixed(0)} MB. This app reads flight plan `
             + `packages up to ${PDFMini.LIMITS.bytes / 1048576} MB.`, 'err');
    return false;
  }
  NAME = name; SIZE = size;
  // The saved state belongs to this PDF's bytes, not to its name — see the
  // stored-flight-data section below.
  HASH = await digestOf(buf);
  KEY = planKeyFor(HASH, name, size);
  showStoredCount();
  RAW = buf;
  $('#fname').textContent = name + '  ·  ' + (size / 1048576).toFixed(1) + ' MB';
  drop.classList.add('loaded');
  hide('#m1'); hide('#m3');
  $('#c2').classList.remove('hide');
  for (const c of ['#c3','#c4','#c5','#c6','#c7','#c8']) $(c).classList.add('hide');
  for (const k in ACT) delete ACT[k];
  for (const k in TXT) delete TXT[k];
  for (const k in ALT) delete ALT[k];
  DCT.marks = []; syncDct();
  try {
    const r = await parse(RAW);
    PLAN = r.pairs; HDRS = r.headers; ANCHOR = r.anchor; FIELDS = r.fields; FPL = r.fpl;
    showIcao(r.icao);
    showOfp(r.ofp);
    showFigs(r.figs);
    showWx(r.wx);
    showCharts(r.charts);
    const s1 = PLAN.filter(p => p.sec === 1).length;
    msg('#m1', `Found: ${s1} main route waypoints`
             + (PLAN.length - s1 ? `, ${PLAN.length - s1} alternate` : '')
             + (FIELDS.length ? `, ${FIELDS.length} document fields` : ''), 'ok');
    showFpl();
    const st = restore();
    if (st){
      $('#etd').value = st.etd || ''; $('#alt').checked = !!st.alt;
      Object.assign(ACT, st.act || {}); Object.assign(TXT, st.txt || {});
      Object.assign(ALT, st.alt2 || {});
      // Checks already announced before the app was evicted must not beep again.
      alerted.clear(); for (const m of st.alerted || []) alerted.add(m);
      if (st.alarm !== undefined) $('#altAlert').checked = st.alarm;
      DCT.marks = Array.isArray(st.dct) ? st.dct : []; syncDct();
    }
    renderFields();
    if (FIELDS.length) $('#c4').classList.remove('hide');
    $('#c5').classList.remove('hide');
    if (st && st.etd){
      $('#calc').click();
      msg('#m1', resumed
        ? `Continued where you left off — ${name}, saved ${st.at ? fmt(st.at) + 'Z' : 'earlier'}.`
        : 'Restored previously entered data for this file.', 'ok');
    }
    if (!resumed) keepSession(name, size, buf);
    // preventScroll, or focusing this box hauls the page past the header and the
    // whole ICAO plan — on a phone that is well over a thousand pixels. The
    // keypad stays down for it too: the crew hasn't asked for the box yet.
    if (!resumed){ npSuppressNext(); $('#etd').focus({ preventScroll: true }); }
    return true;
  } catch (err){
    console.error('OFP parse failed:', err);
    msg('#m1', 'This PDF could not be read as a supported flight-plan package. Try another OFP PDF.', 'err');
    return false;
  }
}

/* ================= ICAO flight plan ================= */
let ICAO = null;
function showIcao(p){
  ICAO = p;
  const box = $('#fplBox');
  if (!p){ box.classList.add('hide'); $('#disc').classList.remove('hide'); return; }
  $('#disc').classList.add('hide');
  box.classList.remove('hide');
  // Read once to cross-check against the paper; collapsed by default so it
  // doesn't sit between the load box and the fields the crew fills in next.
  box.classList.add('collapsed');
  $('#fplText').textContent = p.lines.join('\n');
  $('#fplSrc').textContent = p.split
    ? `reassembled from pages ${p.pages[0]}\u2013${p.pages[p.pages.length - 1]}`
    : `page ${p.pages[0]}`;
}
$('#fplHead').onclick = () => $('#fplBox').classList.toggle('collapsed');

/* ================= OFP identity ================= */
function showFigs(f){
  const el = $('#ofpFigs');
  if (!f){ el.classList.add('hide'); el.textContent = ''; return; }
  el.textContent = ['TOW','LW','ZFW','PLD','CI'].filter(k => f[k])
    .map(k => k === 'CI' ? f.CI : k + ' ' + f[k]).join('   ·   ');
  el.classList.remove('hide');
}

function showOfp(o){
  const el = $('#ofpNo');
  if (!o){ el.classList.add('hide'); el.textContent = ''; return; }
  el.textContent = [o.route, o.req && 'REQ ' + o.req, o.issued].filter(Boolean).join('  ·  ');
  el.classList.remove('hide');
}

/* ================= weather and NOTAMs ================= */
let WX = null;
// A device-wide preference, not a per-plan one — it says how the crew wants the card
// read, not something the loaded plan has an opinion on, so it lives beside the theme
// rather than in the plan's own saved state.
let WXHI = true;
try { WXHI = localStorage.getItem('etofill:wxhi') !== '0'; } catch(e){}
$('#wxHi').checked = WXHI;
$('#wxHi').onchange = () => {
  WXHI = $('#wxHi').checked;
  try { localStorage.setItem('etofill:wxhi', WXHI ? '1' : '0'); } catch(e){}
  renderWx();
};
// NOTAM validity is DDMMMHHMM, sometimes with a spanning year, or a word such
// as PERM / WIE / UFN.
const stamp = s => {
  const m = String(s).match(/^(\d{2}[A-Z]{3})(\d{4})(?:\s+(\d{4}))?$/);
  return m ? `${m[1]} ${m[2]}Z${m[3] ? ' ' + m[3] : ''}` : s;
};
// The back-of-package bulletin runs the keyword into the code: "SPECIZWYN".
const spaced = s => s.replace(/^(METAR|SPECI|TAF)([A-Z]{4}\s)/, '$1 $2');

const GROUPS = [['flight', 'This flight'], ['fir', 'Areas along the route'], ['other', 'Other aerodromes']];

/* ---- when the flight is at each aerodrome ----
   FPL's own ETD/STD and ETA/STA, against the plan's DOF, are the only clock this app
   has for this. Without a DOF the day is a guess, and a guessed day is worse than
   none — so an undated plan gets no highlighting at all, the same way it gets no
   countdown. */
function flightWindow(){
  const dof = ICAO && ICAO.oneLine.match(/\bDOF\/(\d{6})\b/);
  const dep = FPL ? parseTime(FPL.ETD || FPL.STD) : null;
  if (!dof || dep === null) return null;
  const d = dof[1];
  const depMs = Date.UTC(2000 + +d.slice(0, 2), +d.slice(2, 4) - 1, +d.slice(4, 6)) + dep * 60000;
  const arr = FPL ? parseTime(FPL.ETA || FPL.STA) : null;
  const arrMs = arr === null ? null : depMs + norm(arr - dep) * 60000;
  return { depMs, arrMs, midMs: arrMs === null ? null : depMs + (arrMs - depMs) / 2 };
}
// Departure is read at ETD, destination and every alternate at ETA (a diversion is
// flown close to the arrival it replaces), the en-route alternate at the flight's
// midpoint — the plan gives no better instant for a stop that is only ever a
// contingency. An area along the route, or an aerodrome named for no role of its
// own, gets no instant this app can defend, so it stays unhighlighted rather than
// guessed.
function wxTarget(a, win){
  if (!win) return null;
  if (a.role === 'departure' && win.depMs != null) return { ms: win.depMs, label: 'ETD' };
  if ((a.role === 'destination' || a.role === 'alternate') && win.arrMs != null)
    return { ms: win.arrMs, label: 'ETA' };
  if (a.role === 'en-route alternate' && win.midMs != null) return { ms: win.midMs, label: 'mid' };
  return null;
}
const hhmmZ = ms => { const d = new Date(ms);
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0') + 'Z'; };

/* ---- TAF change-group highlighting ----
   A TAF's own change groups — FM, BECMG, TEMPO, PROB30/PROB40 — carry a day-of-month
   and an hour (FM also a minute) but never a month or year, so each is only ever
   resolved against an instant already known to fall within a day or two of it: the
   flight's own clock, never the device's. ICAO Annex 3's own rules for how each group
   supersedes or overlays the one before it: FM replaces everything before it outright
   and holds until the next FM or BECMG; BECMG is a gradual change occupying its own
   window, in force afterwards until superseded; TEMPO and PROB30/PROB40 are
   fluctuations or probabilities superimposed on whichever of those is in force, valid
   only for the window printed on their own line. */
const RE_TAF_HDR = /\bTAF(?:\s+(?:AMD|COR))?\s+[A-Z]{4}\s+\d{6}Z\s+(\d{2})(\d{2})\/(\d{2})(\d{2})/;
const RE_CHG = /\b(FM(\d{2})(\d{2})(\d{2})|BECMG|TEMPO|PROB(?:30|40))\b/g;
const RE_WIN = /(\d{2})(\d{2})\/(\d{2})(\d{2})/;

// A day-of-month and hour (and, for FM, a minute) with no month of its own, resolved
// to whichever of the month before, the anchor's own month, or the month after puts it
// nearest the anchor — the flight is never sixty days from the plan it flew on.
function resolveDH(d, h, mi, anchorMs){
  const day = h === 24 ? d + 1 : d, hour = h === 24 ? 0 : h;
  const anchor = new Date(anchorMs);
  let best = null, bestDiff = Infinity;
  for (const dm of [-1, 0, 1]){
    const t = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + dm, day, hour, mi);
    const diff = Math.abs(t - anchorMs);
    if (diff < bestDiff){ bestDiff = diff; best = t; }
  }
  return best;
}

// Splits one TAF report into its change groups and marks which ones the flight
// actually flies into at `atMs`: the base group (the header's own conditions, or the
// FM/BECMG that has superseded them) in force at that instant, plus any TEMPO/PROB
// window that also covers it.
function tafChunks(text, atMs){
  const hdr = text.match(RE_TAF_HDR);
  if (!hdr || atMs == null) return null;
  const validFrom = resolveDH(+hdr[1], +hdr[2], 0, atMs);
  const validTo = resolveDH(+hdr[3], +hdr[4], 0, atMs);

  RE_CHG.lastIndex = 0;
  const toks = [];
  let m;
  while ((m = RE_CHG.exec(text))){
    const isFm = m[1].startsWith('FM');
    const tok = { index: m.index, base: isFm || m[1] === 'BECMG', from: null, to: null };
    if (isFm) tok.from = resolveDH(+m[2], +m[3], +m[4], atMs);
    else {
      const w = text.slice(m.index, m.index + 40).match(RE_WIN);
      if (w){ tok.from = resolveDH(+w[1], +w[2], 0, atMs); tok.to = resolveDH(+w[3], +w[4], 0, atMs); }
    }
    toks.push(tok);
  }

  const chunks = [{ text: text.slice(0, toks.length ? toks[0].index : text.length),
                    base: true, from: validFrom, to: null }];
  toks.forEach((t, i) => {
    const end = i + 1 < toks.length ? toks[i + 1].index : text.length;
    chunks.push({ text: text.slice(t.index, end), base: t.base,
                  from: t.from ?? validFrom, to: t.to });
  });

  // Base groups chain from the tail: each is in force until the next base group's own
  // start, or the TAF's end. A TEMPO/PROB keeps the window printed on its own line —
  // it does not split the base group it sits in.
  let nextBase = validTo;
  for (let i = chunks.length - 1; i >= 0; i--){
    const c = chunks[i];
    if (c.base){ c.to = nextBase; nextBase = c.from; }
  }
  for (const c of chunks) c.active = c.from != null && c.to != null && atMs >= c.from && atMs < c.to;
  return chunks;
}

/* ---- NOTAM validity highlighting ----
   Picked out the same way as the TAF change group above, and for the same reason: a
   NOTAM in force when the flight is actually at that aerodrome is worth a glance
   before the rest of the list. The day-and-month here is unambiguous — only the year
   is not, so it is resolved to whichever of the year before, the anchor's own year, or
   the year after lands nearest, which also carries a validity spanning a year-end the
   right way (27DEC in one year through, say, 03JAN in the next). */
const MON3 = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
const RE_NOTAM_DATE = /^(\d{2})([A-Z]{3})(\d{2})(\d{2})$/;
function resolveNotamDate(s, anchorMs){
  const m = s && s.match(RE_NOTAM_DATE);
  if (!m || !(m[2] in MON3)) return null;
  const day = +m[1], mon = MON3[m[2]], hh = +m[3], mi = +m[4];
  const anchor = new Date(anchorMs);
  let best = null, bestDiff = Infinity;
  for (const dy of [-1, 0, 1]){
    const t = Date.UTC(anchor.getUTCFullYear() + dy, mon, day, hh, mi);
    const diff = Math.abs(t - anchorMs);
    if (diff < bestDiff){ bestDiff = diff; best = t; }
  }
  return best;
}
// PERM has no end to resolve; WIE and UFN carry no date of their own either — already
// in effect, or in effect until told otherwise. A validity this app cannot parse gets
// no highlight, the same as an aerodrome with no defensible instant.
function notamActive(n, atMs){
  if (atMs == null) return false;
  const from = n.from === 'WIE' || n.from === 'UFN' ? -Infinity : resolveNotamDate(n.from, atMs);
  const to = n.to === 'PERM' || n.to === 'UFN' ? Infinity : resolveNotamDate(n.to, atMs);
  return from != null && to != null && atMs >= from && atMs < to;
}

/* ---- what a NOTAM is about ----
   Read off its own subject and text, not off any code the plan doesn't carry: these
   packages print NOTAMs as free text, not the ICAO Q-line that would otherwise
   classify them — Doc 8126's own Q-code marks the aerodrome FA, the runway MR, the
   taxiway MT, and CLSD as the condition LC, but that line never survives into the
   briefing. What does survive is Doc 8400's own abbreviations for the same three
   things — RWY, TWY, AD — so matching on those reads a NOTAM the way its Q-line
   would have, plural included: a NOTAM naming more than one runway or taxiway
   prints RWYS or TWYS. The whole aerodrome shut outranks the runway — it is the
   more limiting of the two, and gets its own, louder mark rather than sharing the
   runway's; a NOTAM naming both the runway and the taxiway is coloured for the
   runway. */
const RE_NTM_RWY  = /\bRUNWAYS?\b|\bRWYS?\b/;
const RE_NTM_TWY  = /\bTAXIWAYS?\b|\bTWYS?\b/;
const RE_NTM_CLSD = /\b(?:AD|AERODROME|ARPT|AIRPORT)\s+CLOSED\b|\b(?:AD|AERODROME|ARPT)\s+CLSD\b/;
function notamHazard(n){
  const t = `${n.subject || ''} ${n.text || ''}`.toUpperCase();
  if (RE_NTM_CLSD.test(t)) return 'closed';
  if (RE_NTM_RWY.test(t)) return 'rwy';
  if (RE_NTM_TWY.test(t)) return 'twy';
  return null;
}

function showWx(w){
  WX = w && w.airports.length ? w : null;
  const card = $('#c7'), sel = $('#wxApt');
  if (!WX){ card.classList.add('hide'); clear(sel); clear($('#wxOut')); return; }
  clear(sel);
  for (const [g, label] of GROUPS){
    const items = WX.airports.map((a, n) => [a, n]).filter(([a]) => a.group === g);
    if (!items.length) continue;
    const grp = document.createElement('optgroup');
    grp.label = label;
    for (const [a, n] of items){
      const op = document.createElement('option');
      op.value = String(n);
      op.textContent = a.icao + (a.role ? ' — ' + a.role : a.name ? ' — ' + a.name : '');
      grp.appendChild(op);
    }
    sel.appendChild(grp);
  }
  sel.selectedIndex = 0;
  card.classList.remove('hide');
  renderWx();
}

function renderWx(){
  if (!WX) return;
  const a = WX.airports[+$('#wxApt').value] || WX.airports[0];
  $('#wxMeta').textContent = [[a.metar.length, 'METAR'], [a.taf.length, 'TAF'],
                              [a.notams.length, 'NOTAM'], [a.co.length, 'COMPANY']]
    .filter(([n]) => n).map(([n, s]) => n + ' ' + s).join('  ·  ');
  const tgt = WXHI ? wxTarget(a, flightWindow()) : null;
  const tgtNote = tgt && (tgt.label === 'mid' ? `flight's midpoint · ${hhmmZ(tgt.ms)}`
                                              : `at ${tgt.label} · ${hhmmZ(tgt.ms)}`);
  // A busy aerodrome carries eighty-odd NOTAMs; they scroll inside the card
  // rather than pushing everything else off the screen.
  // Every string below comes out of the PDF, so all of it is written as text
  // through the DOM: nothing read out of a document is ever parsed as markup.
  const block = (title, note, body, scroll) => {
    const box = mk('div', 'fplbox'), head = mk('div', 'fplhead'), sp = mk('span', null, title);
    if (note) sp.appendChild(mk('em', 'wxrole', note));
    head.appendChild(sp);
    box.appendChild(head);
    if (scroll){
      const wrap = mk('div', 'scrollwrap'), inner = mk('div', 'ntms');
      body.forEach(n => inner.appendChild(n));
      wrap.appendChild(inner); box.appendChild(wrap);
    } else body.forEach(n => box.appendChild(n));
    return box;
  };
  const pre = arr => [mk('pre', null, arr.map(t => spaced(t)).join('\n\n'))];
  // The change group the flight actually flies into, picked out in place — nothing
  // about what the TAF says has changed, so this is a tint, never a rewrite.
  const tafPre = arr => {
    const box = mk('pre');
    arr.forEach((t, k) => {
      if (k) box.appendChild(document.createTextNode('\n\n'));
      const disp = spaced(t), chunks = tgt && tafChunks(disp, tgt.ms);
      if (!chunks){ box.appendChild(document.createTextNode(disp)); return; }
      for (const c of chunks)
        box.appendChild(c.active ? mk('mark', 'tafnow', c.text) : document.createTextNode(c.text));
    });
    return [box];
  };
  const item = n => {
    const now = tgt && notamActive(n, tgt.ms);
    const hz = WXHI ? notamHazard(n) : null;
    const d = mk('div', ['ntm', hz, now ? 'now' : ''].filter(Boolean).join(' '));
    d.appendChild(mk('span', 'id', n.id));
    if (n.from)
      d.appendChild(mk('span', 'val',
        `${stamp(n.from)} → ${stamp(n.to || '?')}${n.est ? ' EST' : ''}`));
    if (n.subject) d.appendChild(mk('span', 'subj', n.subject));
    d.appendChild(mk('p', null, n.text));
    return d;
  };
  const out = $('#wxOut');
  clear(out);
  if (a.metar.length) out.appendChild(block('METAR', '', pre(a.metar)));
  if (a.taf.length)   out.appendChild(block('TAF', tgtNote, tafPre(a.taf)));
  if (a.notams.length)
    out.appendChild(block('NOTAM', `${a.notams.length} items${tgtNote ? ' · ' + tgtNote : ''}`,
                          a.notams.map(item), true));
  if (a.co.length) out.appendChild(block('Company NOTAMs', '', a.co.map(item), true));
  if (!out.firstChild) out.appendChild(mk('p', 'disc', 'Nothing recorded for this aerodrome.'));
  document.querySelectorAll('#wxOut .ntms').forEach(scrollHint);
}
$('#wxApt').onchange = renderWx;

/* ================= chart viewer =================
   Decoding a 1800x1451 bitmap is not free, so it happens when the crew asks for
   the page and the object URL is kept for the rest of the session. */
let CHARTS = [], chartAt = 0;
function showCharts(list){
  for (const c of CHARTS) if (c.url) URL.revokeObjectURL(c.url);
  CHARTS = (list || []).map(c => ({ ...c, url: null }));
  chartAt = 0;
  $('#chartInfo').textContent = CHARTS.length
    ? `${CHARTS.length} full-page charts in this package — wind components, tropopause and significant weather.`
    : '';
  $('#c8').classList.toggle('hide', !CHARTS.length);
}

async function paintChart(){
  const c = CHARTS[chartAt];
  if (!c) return;
  $('#chartTitle').textContent = `Chart ${chartAt + 1} of ${CHARTS.length}  ·  page ${c.page + 1}`;
  $('#chartPrev').disabled = chartAt === 0;
  $('#chartNext').disabled = chartAt === CHARTS.length - 1;
  const box = $('#chartBox');
  const only = node => { clear(box); box.appendChild(node); };
  if (!c.url){
    only(mk('p', 'disc', 'Decoding…'));
    try { c.url = await chartUrl(DOC, DOC.pages()[c.page], c.key); }
    catch (e){ only(mk('p', 'disc', 'Could not read this chart: ' + e.message)); return; }
    if (CHARTS[chartAt] !== c) return;              // paged on while decoding
  }
  const img = document.createElement('img');
  img.src = c.url;                                  // a blob: URL this app made itself
  img.alt = `Chart on page ${c.page + 1}`;
  only(img);
  box.classList.remove('zoom');
  img.onload = () => scrollHint(box);
  $('#chartZoom').textContent = 'Zoom';
  box.scrollTop = box.scrollLeft = 0;
}
const openCharts = on => {
  $('#charts').classList.toggle('hide', !on);
  document.body.style.overflow = on ? 'hidden' : '';
  if (on) paintChart();
};
$('#chartOpen').onclick = () => openCharts(true);
$('#chartClose').onclick = () => openCharts(false);
$('#charts').onclick = e => { if (e.target === $('#charts')) openCharts(false); };
$('#chartPrev').onclick = () => { if (chartAt > 0){ chartAt--; paintChart(); } };
$('#chartNext').onclick = () => { if (chartAt < CHARTS.length - 1){ chartAt++; paintChart(); } };
$('#chartZoom').onclick = () => {
  const on = $('#chartBox').classList.toggle('zoom');
  $('#chartZoom').textContent = on ? 'Fit' : 'Zoom';
  scrollHint($('#chartBox'));
};

$('#fplCopy').onclick = async e => {
  e.stopPropagation();   // sits inside the header the click also toggles
  if (!ICAO) return;
  const btn = $('#fplCopy'), txt = ICAO.oneLine;
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch(e){}
  if (!ok) try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    ok = document.execCommand('copy'); ta.remove();
  } catch(e){}
  btn.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
};

/* ================= PDF parsing ================= */
function courierName(doc, page){
  const fonts = doc.get(page.Resources && page.Resources.Font);
  if (!fonts) return null;
  for (const k in fonts){
    const fd = doc.get(fonts[k]);
    if (fd && fd.BaseFont && /^Courier$/i.test(fd.BaseFont.name)) return k;
  }
  return null;
}
function tokenize(chars, cw){
  const t = []; let cur = '', prev = null;
  for (const c of chars){
    if (prev !== null && c.x - prev > cw * 1.5){ if (cur) t.push(cur); cur = ''; }
    cur += c.ch; prev = c.x;
  }
  if (cur) t.push(cur);
  return t;
}
function tokensX(chars, cw){
  const t = []; let cur = '', x0 = 0, prev = null;
  for (const c of chars){
    if (prev !== null && c.x - prev > cw * 1.5){ if (cur) t.push({ t: cur, x: x0, x1: prev + cw }); cur = ''; }
    if (!cur) x0 = c.x;
    cur += c.ch; prev = c.x;
  }
  if (cur) t.push({ t: cur, x: x0, x1: prev + cw });
  return t;
}
// field label: words before the dots, numbers dropped, after the last colon
function labelOf(tokens){
  const out = [];
  for (let i = tokens.length - 1; i >= 0 && out.length < 4; i--){
    if (/^[\d.,%/+-]+$/.test(tokens[i])) break;
    out.unshift(tokens[i]);
  }
  let ci = -1;
  out.forEach((s, k) => { if (/:$/.test(s)) ci = k; });
  const tail = (ci >= 0 && ci < out.length - 1) ? out.slice(ci + 1) : out;
  return tail.join(' ').replace(/[:\-]+$/, '').trim();
}
// blank document fields: runs of 5+ consecutive dots
function dotFields(chars, cw){
  const out = []; let i = 0, lastEnd = 0;
  while (i < chars.length){
    if (chars[i].ch !== '.'){ i++; continue; }
    let j = i;
    while (j + 1 < chars.length && chars[j + 1].ch === '.' &&
           Math.abs(chars[j + 1].x - chars[j].x - cw) < 0.6) j++;
    const n = j - i + 1;
    if (n >= 5){
      const tk = tokenize(chars.slice(lastEnd, i), cw);
      out.push({ x: chars[i].x, n, label: labelOf(tk), pre: tk });
      lastEnd = j + 1;
    }
    i = j + 1;
  }
  if (out.length > 1 && out[0].pre.length > 1) out.rowLabel = labelOf(out[0].pre.slice(0, -1));
  return out;
}

// spread a value across the segments of one field, breaking on spaces
function layout(value, segs){
  const out = []; let rest = value;
  segs.forEach((s, k) => {
    if (!rest){ out.push(''); return; }
    if (rest.length <= s.n || k === segs.length - 1){ out.push(rest.slice(0, s.n)); rest = rest.slice(s.n); return; }
    let cut = s.n;
    const sp = rest.lastIndexOf(' ', s.n);
    if (sp > s.n * 0.4) cut = sp;
    out.push(rest.slice(0, cut).replace(/\s+$/, ''));
    rest = rest.slice(cut).replace(/^\s+/, '');
  });
  return out;
}

/* Free-text blanks are often shorter than the room actually available: give them
   whatever is empty to the right, and a second line below when that is free too. */
function growFields(fields, raw, page0){
  if (!fields.length || !page0.length) return;
  const cw = raw[0].cw;
  const RIGHT = Math.max(...raw.map(r => r.x + r.n * cw));        // right edge the form itself uses
  const bases = [...new Set(page0.map(l => l.base))].sort((a, b) => b - a);
  let lineH = 12.05;
  for (let i = 1; i < bases.length; i++){
    const d = bases[i - 1] - bases[i];
    if (d > 6 && d < lineH + 0.01) lineH = d;
  }
  const lineAt = y => page0.find(l => Math.abs(l.base - y) < 1);
  const busy = new Set(raw.map(r => Math.round(r.base)));         // lines already holding blanks
  const snap = x => 30 + Math.ceil((x - 30) / cw - 0.001) * cw;

  for (const f of fields){
    if (f.n < 12) continue;                                       // leave short numeric boxes alone
    const seg = f.segs[f.segs.length - 1];
    const line = lineAt(seg.base);

    // 1) nothing to the right on its own line -> take that room
    const end = seg.x + seg.n * cw;
    if (line && end >= line.maxX - 0.5){
      const grow = Math.floor((RIGHT - end) / cw + 0.001);
      if (grow > 0){ seg.n += grow; f.n += grow; }
    }
    // 2) the line below is free -> continue there
    const nb = seg.base - lineH;
    if (busy.has(Math.round(nb))) continue;
    const bl = lineAt(nb);
    const startX = snap(bl ? bl.maxX + 2 * cw : 30);
    const room = Math.floor((RIGHT - startX) / cw + 0.001);
    if (room < 12) continue;
    f.segs.push({ page: seg.page, base: nb, x: startX, n: room,
                  size: seg.size, cw, font: seg.font });
    f.n += room;
    busy.add(Math.round(nb));
  }
}

/* The ICAO plan is printed between two markers and often breaks across a page,
   with headers and footers landing in the middle. Stitch it back into one text. */
function icaoPlan(lines){
  const s = lines.findIndex(l => /START OF ICAO FLIGHT PLAN/i.test(l.text));
  const e = lines.findIndex(l => /END OF ICAO FLIGHT PLAN/i.test(l.text));
  if (s < 0 || e <= s) return null;
  const slice = lines.slice(s + 1, e);
  const pages = [...new Set(slice.map(l => l.page + 1))];
  const body = slice.map(l => l.text.trim())
    .filter(t => t && !/^AIR ASTANA BRIEF/i.test(t) && !/^PAGE \d+ OF \d+$/i.test(t));
  if (!body.length) return null;
  const fieldsOut = [];                       // a line starting with '-' opens a new ICAO field
  for (const t of body){
    if (fieldsOut.length && !t.startsWith('-')) fieldsOut[fieldsOut.length - 1] += ' ' + t;
    else fieldsOut.push(t);
  }
  return { lines: fieldsOut, oneLine: fieldsOut.join(''), pages,
           split: pages.length > 1 };
}

/* ---- chart pages -------------------------------------------------------------
   The wind-component and significant-weather charts are the only pages in the
   package whose whole content is a single large picture: no body text, one image
   XObject. Scanned paperwork at the back carries three layers and is left out. */
function chartPage(doc, page, i, textCount, out){
  if (textCount > 4) return;                       // more than a header and footer
  const res = page.Resources;
  if (!res) return;
  const xo = doc.get(res.XObject);
  if (!xo) return;
  const keys = Object.keys(xo);
  if (keys.length !== 1) return;
  const o = doc.get(xo[keys[0]]);
  const d = o && o.dict;
  if (!d || (doc.get(d.Subtype) || {}).name !== 'Image') return;
  const w = doc.get(d.Width), h = doc.get(d.Height);
  if (!(w >= 600 && h >= 400)) return;             // not a logo or a rule
  // A chart is decoded into a canvas of w x h pixels — four bytes each, twice
  // over while the ImageData is copied in. Past the cap it is not offered at
  // all, rather than offered and then failing on the tablet that opened it.
  if (!chartFits(w, h)) return;
  out.push({ page: i, key: keys[0], w, h });
}

// What this app is willing to decode into a canvas. 8000 x 8000 is well past
// any briefing chart and still inside every mobile browser's own canvas cap.
const CHART_MAX_SIDE = 8000, CHART_MAX_PIXELS = 40e6;
const chartFits = (w, h) =>
  Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  && w <= CHART_MAX_SIDE && h <= CHART_MAX_SIDE && w * h <= CHART_MAX_PIXELS;

// Decode one chart to a blob URL. Handles the two encodings these packages use:
// a raw RGB or palette bitmap under FlateDecode, and a plain JPEG under DCTDecode.
async function chartUrl(doc, page, key){
  const o = doc.get(doc.get(page.Resources.XObject)[key]), d = o.dict;
  const f = doc.get(d.Filter), fn = (Array.isArray(f) ? f[0] : f) || {};
  const w = doc.get(d.Width), h = doc.get(d.Height);
  if (!chartFits(w, h)) throw new Error(`chart is too large to decode (${w}\u00d7${h})`);
  if (fn.name === 'DCTDecode')
    return URL.createObjectURL(new Blob([doc.bytes.subarray(o.start, o.start + o.length)],
                                        { type: 'image/jpeg' }));
  if (fn.name !== 'FlateDecode' && fn.name !== 'Fl')
    throw new Error('unsupported chart encoding: ' + fn.name);

  const data = await doc.stream(o);
  const cs = doc.get(d.ColorSpace);
  const indexed = Array.isArray(cs) && cs[0] && cs[0].name === 'Indexed';
  let pal = null;
  if (indexed){
    const lut = cs[3];
    pal = lut && typeof lut.text === 'string'
        ? Uint8Array.from(lut.text, c => c.charCodeAt(0) & 255)
        : await doc.stream(doc.get(lut));
  } else if (!(cs && cs.name === 'DeviceRGB')){
    throw new Error('unsupported chart colour space');
  }
  // A stream shorter than the bitmap it claims to be would otherwise read as
  // undefined and paint the remainder of the chart black without saying so.
  const need = indexed ? w * h : w * h * 3;
  if (data.length < need)
    throw new Error('chart data is short: ' + data.length + ' of ' + need + ' bytes');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h);
  for (let i = 0, n = w * h; i < n; i++){
    const s = indexed ? data[i] * 3 : i * 3;
    const src = indexed ? pal : data;
    img.data[i * 4] = src[s]; img.data[i * 4 + 1] = src[s + 1];
    img.data[i * 4 + 2] = src[s + 2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  cv.width = cv.height = 0;                        // release the backing store
  return URL.createObjectURL(blob);
}

/* ---- OFP identity and briefing sections ---- */
const CHROME = t => /^AIR ASTANA BRIEF/i.test(t) || /^PAGE \d+ OF \d+$/i.test(t);

// Aerodromes and areas named by the ICAO flight plan: field 13 is departure,
// field 16 destination + alternates, field 18 carries EET/ (the FIRs crossed)
// and RALT/ (en-route alternates).
function routeAirports(icao){
  const role = new Map(), fir = new Set();
  if (!icao) return { role, fir };
  const dep = icao.lines.find(l => /^-[A-Z]{4}\d{4}$/.test(l.trim()));
  if (dep) role.set(dep.trim().slice(1, 5), 'departure');
  const dst = icao.lines.find(l => /^-[A-Z]{4}\d{4}(\s+[A-Z]{4})*\s*$/.test(l) && l !== dep);
  if (dst){
    const codes = dst.trim().slice(1).split(/\s+/);
    role.set(codes[0].slice(0, 4), 'destination');
    for (const c of codes.slice(1)) if (/^[A-Z]{4}$/.test(c) && !role.has(c)) role.set(c, 'alternate');
  }
  const all = icao.lines.join(' ');
  const eet = all.match(/\bEET\/((?:[A-Z]{4}\d{4}\s*)+)/);
  if (eet) for (const m of eet[1].matchAll(/([A-Z]{4})\d{4}/g)) fir.add(m[1]);
  const ralt = all.match(/\bRALT\/([A-Z]{4}(?:\s+[A-Z]{4})*)/);
  if (ralt) for (const c of ralt[1].split(/\s+/)) if (!role.has(c)) role.set(c, 'en-route alternate');
  return { role, fir };
}

// OFP identity, read from the first page. Air Astana prints it as
// "ROUTE ID: ALAICN01  GENERATED: 13/08/2026 15:26 GMT  --- REQUEST # 83104 ---".
function ofpIdent(lines){
  const page1 = lines.filter(l => l.page === 0 && !CHROME(l.text)).map(l => l.text.trim());
  let route = null, req = null, issued = null;
  const FALLBACK = [
    /\bOFP\s*(?:NO|NR|NUM(?:BER)?|#)?\.?\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{0,14})\b/i,
    /\bFLIGHT\s+PLAN\s+(?:NO|NR|NUMBER)\.?\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{0,14})\b/i,
  ];
  for (const t of page1){
    let m;
    if (!route && (m = t.match(/\bROUTE\s*ID\s*:\s*(\S+)/i))) route = m[1];
    if (!req   && (m = t.match(/\bREQUEST\s*#?\s*(\d+)/i))) req = m[1];
    if (!issued && (m = t.match(/\bGENERATED\s*:\s*(\S+)\s+(\d{1,2}:\d{2})/i)))
      issued = m[1] + ' ' + m[2] + 'Z';
    if (!req) for (const re of FALLBACK){ const f = t.match(re); if (f){ req = f[1]; break; } }
  }
  return (route || req || issued) ? { route, req, issued } : null;
}

// The weights the crew checks at a glance, from page 1:
// "TOW 145979 LW 122928 ZFW 116632 PLD 22500 BLKF 29647 DOI 46.59",
// plus the cost index printed in the SPEED column of the flight row.
// Each label is anchored to a word boundary so MTOW, MLW and MPLD on the line
// above cannot be mistaken for the planned figures.
function keyFigures(lines){
  const page1 = lines.filter(l => l.page === 0 && !CHROME(l.text)).map(l => l.text.trim());
  const out = {};
  for (const t of page1){
    for (const k of ['TOW', 'LW', 'ZFW', 'PLD']){
      if (out[k]) continue;
      const m = t.match(new RegExp('(?:^|\\s)' + k + '\\s+(\\d{3,7})(?:\\s|$)'));
      if (m) out[k] = m[1];
    }
    if (!out.CI){ const m = t.match(/\bCI(\d{2,3})\b/); if (m) out.CI = 'CI' + m[1]; }
  }
  return Object.keys(out).length ? out : null;
}

/* ---- METAR / TAF / NOTAM ----------------------------------------------------
   Every report and NOTAM item in this package names its own aerodrome, so the
   grouping keys off the item lines themselves and never off the page headings.
   Headings are used only to end the item above them and to label the aerodrome. */
// The raw bulletin at the back of the package runs the keyword into the code
// ("SPECIZLIC"), exactly as it does for NOTAMs, hence \s* rather than \s+.
const RE_METAR  = /^(?:METAR|SPECI)(?:\s+(?:COR|AMD))?\s*([A-Z]{4})\s+\d{6}Z/;
const RE_TAF    = /^TAF(?:\s+(?:AMD|COR))?\s*([A-Z]{4})\s+\d{6}Z/;
// "- UAAA A3725/26 30JUN0500-30SEP0500" and the run-together "NOTAMUAAA A4947/26 ...".
// The validity that follows comes in half a dozen shapes — PERM, a trailing EST,
// and a spanning year that may sit against either date — so it is captured whole
// and split on its first hyphen rather than enumerated.
const RE_NTM    = /^(?:-\s*|NOTAM)([A-Z]{4})\s+([A-Z]\d{3,4}\/\d{2})\s+((?:\d{2}[A-Z]{3}\d{4}|WIE)\b[^]*?)\s*$/;

function validity(s){
  const i = s.indexOf('-');
  if (i < 0) return null;
  const cut = t => ({ est: /\bEST\b/.test(t), t: t.replace(/\s*\bEST\b/g, '').trim() });
  const a = cut(s.slice(0, i)), b = cut(s.slice(i + 1));
  return { from: a.t, to: b.t, est: a.est || b.est };
}
// "UAAA-00001 Oper: Y 28MAY25/0432" and the route form "UAAA-RKSI-00002 Oper: ..."
const RE_CONTM  = /^([A-Z]{4})(?:-([A-Z]{4}))?-(\d{4,6})\s+Oper:/;
const RE_VALID  = /^VALID FROM:\s*(\S+)\s+TO:\s*(\S+)/;
const RE_APT    = /^([A-Z]{4})\s+([A-Z]{3})\s+RWY/;          // "UAAA ALA RWY05L 4500M ..."
const RE_ROLE   = /^(DEPARTURE|ARRIVAL|OTHER):\s*(.+)$/;
const RE_CONHD  = /\bCOMPANY NOTAMS\b/;

function weatherNotams(lines, icao){
  const { role, fir } = routeAirports(icao);
  const by = new Map(), named = new Set();
  const at = code => {
    if (!by.has(code)) by.set(code, { icao: code, iata: null, name: null,
                                      role: role.get(code) || null,
                                      metar: [], taf: [], notams: [], co: [] });
    return by.get(code);
  };
  const src = lines.filter(l => l.text.trim() && !CHROME(l.text.trim())).map(l => l.text.trim());

  let open = null, pending = null, subject = null;
  const close = () => {
    if (!open) return;
    const body = open.buf.join(' ').replace(/\s+/g, ' ').trim();
    if (body || open.kind === 'notams' || open.kind === 'co'){
      if (open.kind === 'notams')
        for (const c of open.codes)
          at(c).notams.push({ id: open.id, from: open.from, to: open.to, est: open.est,
                              subject: open.subject, text: body });
      else if (open.kind === 'co')
        for (const c of open.codes)
          at(c).co.push({ id: open.id, from: open.from, to: open.to, text: body });
      else at(open.code)[open.kind].push(body.replace(/\s*=$/, ''));   // bulletin terminator
    }
    open = null;
  };

  for (let i = 0; i < src.length; i++){
    const t = src[i];
    let m;

    // Headings: they close whatever is open and never become part of it.
    if ((m = t.match(RE_ROLE))){
      close(); subject = null;
      // "OTHER:" names an aerodrome without giving it a part in this flight.
      pending = { role: m[1] === 'OTHER' ? null : m[1].toLowerCase(), name: m[2].trim() };
      continue;
    }
    if ((m = t.match(RE_APT))){
      close(); subject = null;
      const a = at(m[1]);
      a.iata = m[2]; named.add(m[1]);
      if (pending){ a.name = pending.name; if (!a.role) a.role = pending.role; pending = null; }
      continue;
    }
    if (RE_CONHD.test(t)){ close(); subject = null; continue; }

    if ((m = t.match(RE_METAR))){ close(); open = { kind: 'metar', code: m[1], buf: [t] }; continue; }
    if ((m = t.match(RE_TAF)))  { close(); open = { kind: 'taf',   code: m[1], buf: [t] }; continue; }

    if ((m = t.match(RE_NTM))){
      const v = validity(m[3]);
      if (v){
        close();
        open = { kind: 'notams', codes: [m[1]], id: m[2], ...v, subject, buf: [] };
        continue;
      }
    }
    if ((m = t.match(RE_CONTM))){
      close();
      // A route company NOTAM (UAAA-RKSI-00002) belongs to both ends of the leg.
      const codes = m[2] ? [m[1], m[2]] : [m[1]];
      open = { kind: 'co', codes, id: m[0].split(/\s+/)[0], from: null, to: null, buf: [] };
      continue;
    }
    if (open && open.kind === 'co' && !open.buf.length && (m = t.match(RE_VALID))){
      open.from = m[1]; open.to = m[2]; continue;
    }

    // A bare short line directly above a NOTAM item is that item's subject
    // ("ILS III", "APCH LGT"), not a continuation of the item above it.
    if (t.length <= 40 && !/[.,:]$/.test(t) && RE_NTM.test(src[i + 1] || '')){
      close(); subject = t; continue;
    }
    if (open) open.buf.push(t);
  }
  close();

  const rank = { departure: 0, arrival: 1, destination: 1, alternate: 2, 'en-route alternate': 3 };
  // "Areas" are the FIRs the plan crosses that are not aerodromes in their own right.
  const group = a => a.role ? 'flight'
                   : (fir.has(a.icao) && !named.has(a.icao)) ? 'fir'
                   : 'other';
  const airports = [...by.values()]
    .filter(a => a.metar.length || a.taf.length || a.notams.length || a.co.length)
    .map(a => ({ ...a, group: group(a) }))
    .sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.icao.localeCompare(b.icao));
  return { airports };
}

async function parse(buf){
  const doc = new PDFMini.Doc(new Uint8Array(buf));
  DOC = doc;
  const pages = doc.pages();
  const dotRows = [], headers = [], rawFields = [], page0 = [], allLines = [], charts = [];
  let anchor = 0, fpl = null;

  for (let p = 0; p < pages.length; p++){
    const items = PDFMini.textItems(await doc.content(pages[p]));
    const font = courierName(doc, pages[p]);
    chartPage(doc, pages[p], p, items.length, charts);
    const byLine = new Map();
    for (const it of items){
      if (it.size < 9 || it.size > 13) continue;
      const key = Math.round(it.y * 2) / 2;
      if (!byLine.has(key)) byLine.set(key, []);
      const arr = byLine.get(key);
      for (let i = 0; i < it.str.length; i++){
        const ch = it.str[i];
        if (ch === ' ') continue;
        arr.push({ ch, x: it.x + i * it.cw, base: it.y, size: it.size, cw: it.cw });
      }
    }
    for (const [, chars] of byLine){
      chars.sort((a, b) => a.x - b.x);
      const last = chars[chars.length - 1];
      if (!last) continue;
      const cw = last.cw;

      if (p === 0){
        page0.push({ base: last.base, chars, cw, maxX: last.x + cw,
                     size: last.size, dots: chars.some(c => c.ch === '.') });
        const runs = dotFields(chars, cw);
        runs.forEach((f, k) => rawFields.push({ page: p, base: last.base, size: last.size, cw, font,
          x: f.x, n: f.n, label: f.label, rowLabel: k === 0 ? (runs.rowLabel || '') : '',
          // The form prints the planned block fuel just left of the PIC BLOCK blank
          // ("BLOCK FUEL 06.49 29647 PIC BLOCK: ......"). Kept for reference only.
          // The whole-number test skips the block time, which carries a dot.
          ref: /^PIC BLOCK$/i.test(f.label)
             ? (f.pre.filter(t => /^\d{3,6}$/.test(t)).pop() || null) : null }));
      }
      const tk = tokenize(chars, cw);
      allLines.push({ page: p, base: last.base, text: tk.join(' ') });
      if (tk[tk.length - 1] === 'ATO' && last.x > 460 && last.x < 540){
        headers.push({ page: p, base: last.base, size: last.size, cw, font });
        continue;
      }
      const dots = chars.filter(c => c.ch === '.' && c.x > 440 && c.x < 540);
      if (dots.length !== 4) continue;
      let ok = true;
      for (let i = 1; i < 4; i++) if (Math.abs(dots[i].x - dots[0].x - cw * i) > 0.8) ok = false;
      if (!ok) continue;
      anchor = Math.max(anchor, dots[0].x + 4 * cw);
      dotRows.push({ page: p, base: dots[0].base, size: dots[0].size, cw, x: dots[0].x, font,
                     tok: tokenize(chars.filter(c => c.x < dots[0].x - 3), cw) });
    }
  }

  // a run without its own label continues the previous field
  rawFields.sort((a, b) => b.base - a.base || a.x - b.x);
  const fields = [];
  for (const r of rawFields){
    const prev = fields[fields.length - 1];
    if (!r.label && prev){ prev.segs.push(r); prev.n += r.n; continue; }
    fields.push({ i: fields.length, label: r.label, rowLabel: r.rowLabel, n: r.n,
                  ref: r.ref, segs: [r] });
  }
  growFields(fields, rawFields, page0);

  // flight header: STD ETD STA ETA and the row of values
  page0.sort((a, b) => b.base - a.base);
  for (let i = 0; i < page0.length && !fpl; i++){
    const head = tokensX(page0[i].chars, page0[i].cw), cols = {};
    for (const t of head) if (['STD','ETD','STA','ETA'].includes(t.t)) cols[t.t] = (t.x + t.x1) / 2;
    if (Object.keys(cols).length < 4) continue;
    for (let j = i + 1; j < Math.min(i + 4, page0.length); j++){
      const row = tokensX(page0[j].chars, page0[j].cw);
      const pick = cx => {
        let best = null, bd = 1e9;
        for (const t of row){
          const d = Math.abs((t.x + t.x1) / 2 - cx);
          if (/^\d{4}$/.test(t.t) && d < bd){ bd = d; best = t.t; }
        }
        return bd < 24 ? best : null;
      };
      const v = { STD: pick(cols.STD), ETD: pick(cols.ETD), STA: pick(cols.STA), ETA: pick(cols.ETA) };
      if (v.ETD){ fpl = v; break; }
    }
  }
  // Trip time, from the fuel block a few lines down: "TRIP 05.10 23051".
  if (fpl) for (const l of page0){
    const t = tokenize(l.chars, l.cw);
    if (t[0] === 'TRIP' && /^\d{1,2}\.\d{2}$/.test(t[1])){ fpl.TRIP = t[1]; break; }
  }

  dotRows.sort((a, b) => a.page - b.page || b.base - a.base);
  const pairs = [];
  const reTT = /^\d+\.\d\d$/, reET = /^\d+$/;
  let cum = 0, prev = -1, sec = 1;

  for (let i = 0; i < dotRows.length; i++){
    const a = dotRows[i], b = dotRows[i + 1];
    if (!b || b.page !== a.page || Math.abs(a.base - b.base - 12) > 2) continue;
    if (a.tok.length < 3 || b.tok.length < 3) continue;
    const et = a.tok[a.tok.length - 2], tt = b.tok[b.tok.length - 2], rem = b.tok[b.tok.length - 1];
    if (!reET.test(et) || !reTT.test(tt)) continue;
    const ttm = +tt.split('.')[0] * 60 + +tt.split('.')[1];
    if (ttm < prev){ sec++; cum = 0; }
    prev = ttm; cum += +et;
    pairs.push({ i: pairs.length, wp: a.tok[0], et: +et, cum, sec, page: a.page,
                 ex: a.x, ey: a.base, ax: b.x, ay: b.base, size: a.size, cw: a.cw, font: a.font,
                 rem: /^\d+$/.test(rem) ? +rem : null, drift: cum !== ttm });
    i++;
  }
  if (!pairs.length) throw new Error('ETO column not found — unexpected plan format');
  if (pairs.some(p => !p.font)) throw new Error('no Courier font on the page');
  allLines.sort((a, b) => a.page - b.page || b.base - a.base);
  const icao = icaoPlan(allLines);
  return { pairs, headers, anchor, fields, fpl, icao, charts,
           ofp: ofpIdent(allLines), figs: keyFigures(allLines),
           wx: weatherNotams(allLines, icao) };
}

/* ================= calculation =================
   parseTime, norm, fmt, hhmm, wrapMin, computeResult, hourlyChecks, fuelBox,
   fuelChecks and directSkips all live in ofp-core.js, loaded before this file.
   They take no page state, and the test suite checks them there. */

function showFpl(){
  const el0 = $('#fpl');
  if (!FPL){ el0.className = 'hint hide'; return; }
  el0.className = 'hint';
  clear(el0);
  el0.appendChild(document.createTextNode('From document: '));
  const parts = [['STD', FPL.STD || '—'], ['ETD', FPL.ETD], ['STA', FPL.STA || '—'],
                 ['ETA', FPL.ETA || '—']];
  if (FPL.TRIP) parts.push(['TRIP', FPL.TRIP]);
  parts.forEach(([k, v], i) => {
    el0.appendChild(document.createTextNode((i ? ' · ' : '') + k + ' '));
    el0.appendChild(mk('b', null, v));
  });
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pill'; b.textContent = 'Use ' + FPL.ETD;
  b.onclick = () => { $('#etd').value = FPL.ETD; $('#calc').click(); };
  el0.appendChild(b);
  const n = document.createElement('span');
  n.style.fontSize = '12px';
  n.textContent = 'ETD is off-block time — takeoff is normally later';
  el0.appendChild(n);
  $('#etd').placeholder = FPL.ETD;
}

$('#etd').oninput = e => { e.target.value = e.target.value.replace(/[^\d:]/g, ''); };
$('#etd').oninput = () => {
  const v = $('#etd').value, bad = v.length > 0 && parseTime(v) === null;
  $('#etd').classList.toggle('bad', bad);
  $('#etd').setAttribute('aria-invalid', bad ? 'true' : 'false');
};
$('#etd').onkeydown = e => { if (e.key === 'Enter'){ e.target.blur(); $('#calc').click(); } };
$('#alt').onchange = () => { if (RESULT.length) $('#calc').click(); };

$('#calc').onclick = () => {
  const firstRun = $('#c3').classList.contains('hide');
  const t0 = parseTime($('#etd').value);
  if (t0 === null){
    $('#etd').classList.add('bad'); $('#etd').setAttribute('aria-invalid', 'true');
    msg('#m2', 'Enter the time as HHMM, for example 0210', 'err'); return;
  }
  $('#etd').classList.remove('bad'); $('#etd').setAttribute('aria-invalid', 'false');
  if (!PLAN){ msg('#m2', 'Load a PDF first', 'err'); return; }
  T0 = t0;
  const { rows, arr } = computeResult(PLAN, t0, $('#alt').checked);
  RESULT = rows;
  const drift = RESULT.filter(p => p.drift).length;
  drift ? msg('#m2', `Warning: at ${drift} waypoints the ET sum did not match T/T.`, 'warn') : hide('#m2');
  render(t0, arr);
  renderAlt();
  renderFuel();
  $('#c3').classList.remove('hide');
  if (CHECKS.length) $('#c6').classList.remove('hide');
  // Filling the fields is done on the ground; the first Calculate — the move
  // into cruise — folds the card to its one-line summary. A later recalculation
  // (the ALTN box, a corrected time) leaves it wherever the crew put it.
  if (firstRun) $('#c4').classList.add('collapsed');
  save();
};

/* ---- the clock ----
   Ticks once a second on its own. The heavier refreshes below run every 15 s,
   which is fine for due times but would make a wall clock lie by a quarter minute. */
const pad2 = n => String(n).padStart(2, '0');
function clockTick(){
  const d = new Date();
  const t = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
  const s = $('#stUtc'); if (s) s.textContent = t;
  const u = $('#utc');   if (u) u.textContent = 'UTC now ' + t;
}
setInterval(clockTick, 1000);
clockTick();

/* ---- due-time monitoring ---- */
const nowUtc = () => { const d = new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
// minutes past the due time, wrapped to ±12 h
const sinceDue = target => sinceDueAt(nowUtc(), target);
const chkState = c => {
  const v = ALT[c.mark] || {};
  const n = ['a1','sb','a2'].filter(k => v[k]).length;
  if (n === 3) return 'done';
  if (n > 0) return 'part';
  const d = sinceDue(c.due);
  return d >= 0 ? 'late' : d >= -10 ? 'soon' : 'wait';
};

let AC = null, alerted = new Set();
function beep(){
  const Ctx = (typeof AudioContext !== 'undefined' && AudioContext)
           || (typeof webkitAudioContext !== 'undefined' && webkitAudioContext);
  if (!Ctx) return;
  try {
    AC = AC || new Ctx();
    if (AC.state === 'suspended') AC.resume();
    for (let i = 0; i < 2; i++){
      const o = AC.createOscillator(), g = AC.createGain();
      o.connect(g); g.connect(AC.destination);
      o.type = 'sine'; o.frequency.value = 880;
      const t = AC.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    }
  } catch(e){}
}

function refreshAlt(){
  if (!CHECKS.length){ hide('#m4'); return; }
  let late = 0, fresh = false;
  for (const c of CHECKS){
    const st = chkState(c), row = document.getElementById('altrow' + c.mark),
          tag = document.getElementById('altst' + c.mark);
    if (st === 'late'){
      late++;
      if (!alerted.has(c.mark)){ alerted.add(c.mark); fresh = true; }
    } else if (st === 'done' || st === 'part') alerted.delete(c.mark);
    if (row) row.classList.toggle('late', st === 'late');
    if (tag){
      const d = sinceDue(c.due);
      tag.className = 'st ' + st;
      tag.textContent = st === 'done' ? 'recorded'
        : st === 'part' ? 'incomplete — finish this entry'
        : st === 'late' ? `overdue by ${d} min — due at ${fmt(c.due)}`
        : st === 'soon' ? `due at ${fmt(c.due)}, in ${-d} min`
        : `due at ${fmt(c.due)}`;
    }
  }
  late ? msg('#m4', late === 1
          ? 'One altimeter cross-check is due and not recorded.'
          : `${late} altimeter cross-checks are due and not recorded.`, 'err')
       : hide('#m4');
  if (fresh && $('#altAlert').checked) beep();
}
$('#altAlert').onchange = save;
/* ---- Direct To ----------------------------------------------------------------
   ATC shortcuts the route and the paper form no longer matches what is being
   flown. Nothing here reaches the PDF and no ETO is rewritten: the point is only
   that the highlight should stop pointing at waypoints the aircraft will not
   cross. Each direct remembers the rows it cut out, so undoing one restores
   exactly those and leaves any other direct alone. */
let DCT = { marks: [] }, DCTSKIP = new Set(), dctPick = false;
const syncDct = () => { DCTSKIP = new Set(DCT.marks.flatMap(m => m.skipped)); };
const isSkipped = i => DCTSKIP.has(+i);

// How far the flight is actually running from the plan, from the most recent
// waypoint with an ATO entered. Applied to the comparison times only.
function currentOffset(){
  for (let n = RESULT.length - 1; n >= 0; n--){
    const p = RESULT[n];
    if (isSkipped(p.i)) continue;
    const a = ACT[p.i];
    if (!a || !a.ato) continue;
    const t = parseTime(a.ato);
    if (t !== null) return wrapMin(t - norm(p.t));
  }
  return 0;
}

// The last point whose time has come and the first whose has not, over whichever
// rows are asked for — the flown route, or the ones a direct has put abeam.
function scanIdx(want, off){
  let ci = -1, ni = -1;
  RESULT.forEach((p, n) => {
    if (!want(p)) return;
    if (sinceDue(p.t + off) >= 0) ci = n;
    else if (ni < 0) ni = n;
  });
  return { ci, ni };
}

function progressIdx(){
  const off = currentOffset();
  const { ci, ni } = scanIdx(p => !isSkipped(p.i), off);
  return { ci, ni, off };
}
// A direct takes waypoints out of the route, not out of the sky: the aeroplane
// still goes past them, so they keep their place on the clock as abeam positions.
const abeamIdx = off => scanIdx(p => isSkipped(p.i), off);

function paintDct(i){
  const tr = rowOf(i);
  if (!tr) return;
  tr.classList.toggle('skipped', isSkipped(i));
  const cell = tr.cells[0], want = DCT.marks.some(m => m.to === +i);
  const badge = cell.querySelector('.dctbadge');
  if (want && !badge){
    const b = document.createElement('span');
    b.className = 'dctbadge'; b.textContent = 'DCT';
    cell.appendChild(b);
  } else if (!want && badge) badge.remove();
}

function renderDctChips(){
  const box = $('#dctChips');
  if (!box) return;
  clear(box);
  DCT.marks.forEach((m, k) => {
    const p = RESULT.find(x => x.i === m.to);
    const chip = mk('span', 'dctchip', `DIRECT → ${p ? p.wp : '?'} `);
    const x = mk('b', null, '✕');
    x.title = 'Undo';
    x.onclick = () => undoDirect(k);
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

function setPick(on){
  dctPick = on && RESULT.length > 0;
  const box = document.querySelector('.tblbox');
  if (box) box.classList.toggle('picking', dctPick);
  $('#dctBtn').textContent = dctPick ? 'Cancel' : 'Direct to…';
  dctPick ? msg('#m7', 'Tap the waypoint you have been cleared direct to.', 'warn') : hide('#m7');
}

function applyDirect(target){
  const n = RESULT.findIndex(p => p.i === +target);
  const { ci } = progressIdx();
  if (n < 0) return;
  if (n <= ci){ msg('#m7', 'That waypoint is not ahead of you.', 'err'); return; }
  DCT.marks.push({ to: RESULT[n].i, skipped: directSkips(RESULT, ci, n, isSkipped) });
  syncDct();
  setPick(false);
  afterDct();
}

function undoDirect(k){
  DCT.marks.splice(k, 1);
  syncDct();
  afterDct();
}

function afterDct(){
  RESULT.forEach(p => paintDct(p.i));
  renderDctChips();
  lastNext = null;
  refreshProgress();
  renderAlt(true);                 // checks follow the waypoints a direct removed
  renderFuel();                    // windows follow the waypoints a direct removed
  refreshInputValidity();          // fuel-trend warnings follow the flown route too
  save();
}

$('#dctBtn').onclick = () => setPick(!dctPick);

/* ---- where the flight has got to ----
   Kept out of refreshAlt because that one returns early when the plan is shorter
   than an hour and has no checks — the table still needs its highlight. */
let scrolledAt = 0, typedAt = 0, autoTarget = null, autoT = null, lastNext = null;

// Centring is done on the box's own scrollTop rather than with scrollIntoView,
// which walks every scrollable ancestor and used to drag the whole page with it.
// The sticky column headings cover the top of the box, so the row is centred in
// what they leave visible: a half-heading was being added where it had to be
// taken off, which put every centred row 34px high.
function centreRow(row){
  const box = document.querySelector('.tblbox');
  if (!box || !row) return;
  const head = box.querySelector('thead');
  const headH = head ? head.offsetHeight : 0;
  const rel = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const top = rel - headH - (box.clientHeight - headH - row.offsetHeight) / 2;
  const want = Math.round(Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight)));
  if (Math.abs(want - box.scrollTop) < 2) return;
  // Marked by target rather than by a stopwatch: a smooth scroll takes as long as
  // it takes, and its tail used to be read back as the crew's own scroll.
  autoTarget = want;
  clearTimeout(autoT);
  autoT = setTimeout(() => { autoTarget = null; }, 3000);
  box.scrollTo({ top: want, behavior: 'smooth' });
}

function markAbeam(row, want){
  const cell = row.cells[0], badge = cell.querySelector('.abbadge');
  if (want && !badge){
    const s = document.createElement('span');
    s.className = 'abbadge'; s.textContent = 'ABEAM';
    cell.appendChild(s);
  } else if (!want && badge) badge.remove();
}

function refreshProgress(){
  if (!RESULT.length) return;
  const { ci, ni, off } = progressIdx();
  const ab = abeamIdx(off);
  const next = ni >= 0 ? RESULT[ni] : null;
  RESULT.forEach((p, n) => {
    const row = rowOf(p.i);
    if (!row) return;
    const skipped = isSkipped(p.i);
    row.classList.toggle('past', !skipped && n < ci);
    row.classList.toggle('now', !skipped && n === ci);
    row.classList.toggle('next', !skipped && n === ni);
    // The cut-out ones keep their own highlight so the table still says where the
    // aeroplane is against them; quieter than the live route, and labelled, so the
    // two can never be read for each other.
    row.classList.toggle('abeam-now', skipped && n === ab.ci);
    row.classList.toggle('abeam-next', skipped && n === ab.ni);
    markAbeam(row, skipped && n === ab.ci);
  });
  const st = $('#stNext');
  if (st){
    const mins = next ? -sinceDue(next.t + off) : null;
    st.querySelector('b').textContent = next ? next.wp : '—';
    st.querySelector('span').textContent = next
      ? `Next · ${fmt(next.t)} · in ${mins} min` + (off ? ` · ${off > 0 ? '+' : ''}${off} on plan` : '')
      : 'All waypoints passed';
  }
  // Follow the flight, but never fight the hands: only on a change of target row,
  // and not within twenty seconds of the crew scrolling the box or typing in it.
  // Focus itself is no test — Enter steps to the next field, so a box stays focused
  // for the rest of the flight and the table would never follow again.
  const box = document.querySelector('.tblbox');
  if (next && next.i !== lastNext
      && Date.now() - scrolledAt > 20000 && Date.now() - typedAt > 20000){
    lastNext = next.i;
    centreRow(rowOf(next.i));
  }
}
{
  const box = document.querySelector('.tblbox');
  box.addEventListener('scroll', () => {
    if (autoTarget !== null && Math.abs(box.scrollTop - autoTarget) > 2) return;   // still ours
    autoTarget = null;
    scrolledAt = Date.now();
  }, { passive: true });
  for (const ev of ['keydown', 'input'])
    box.addEventListener(ev, () => { typedAt = Date.now(); }, { passive: true });
}

const tick = () => {
  // Updating a hidden standalone app forces WebKit to redraw several fixed and
  // blurred layers just as it is being frozen. Leave the screen untouched until
  // it is visible again; the resume hook below catches the UI up in one frame.
  if (document.hidden) return;
  refreshProgress(); refreshAlt(); refreshFuel();
};
setInterval(tick, 15000);
let resumeFrame = 0;
function settleAfterResume(){
  if (document.hidden) return;
  const root = document.documentElement;
  root.classList.add('app-resuming');
  if (resumeFrame) cancelAnimationFrame(resumeFrame);
  // Give Safari one frame to restore its surfaces, then update the time-based
  // statuses with transitions held off for that paint. The next frame restores
  // normal motion before the crew can interact with the page.
  resumeFrame = requestAnimationFrame(() => {
    resumeFrame = requestAnimationFrame(() => {
      tick();
      root.classList.remove('app-resuming');
      resumeFrame = 0;
    });
  });
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) settleAfterResume();
});
addEventListener('pageshow', e => { if (e.persisted) settleAfterResume(); });

// waypoints reached at each full hour after takeoff
function renderAlt(preserveAlerts = false){
  const announced = preserveAlerts ? new Set(alerted) : null;
  CHECKS = hourlyChecks(flown(), T0);
  $('#c6').classList.toggle('hide', !CHECKS.length);
  const box = $('#altrows'); clear(box);
  for (const c of CHECKS){
    const row = document.createElement('div'); row.className = 'altrow'; row.id = 'altrow' + c.mark;
    const tag = document.createElement('div'); tag.className = 'tag';
    // The TOC fallback's own waypoint is named TOC too — "at TOC" alongside a
    // TOC label would just repeat itself, so it's dropped for that row only.
    tag.appendChild(document.createTextNode(c.label + ' \u00a0 '));
    tag.appendChild(mk('b', null, fmt(c.wp.t)));
    if (c.wp.wp !== c.label) tag.appendChild(document.createTextNode(' \u00a0 at ' + c.wp.wp));
    tag.appendChild(document.createElement('br'));
    const st = mk('span', 'st wait');
    st.id = 'altst' + c.mark;
    tag.appendChild(st);
    row.appendChild(tag);
    for (const [key, cap] of [['a1','ALTM1'],['sb','STBY'],['a2','ALTM2']]){
      const cell = document.createElement('div'); cell.className = 'cell';
      const s = document.createElement('small'); s.textContent = cap;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 5; inp.inputMode = 'none'; inp.pattern = '[0-9]*';
      inp.className = 'numkey';
      inp.autocomplete = 'off'; inp.spellcheck = false; inp.enterKeyHint = 'next';
      inp.setAttribute('autocorrect', 'off');
      inp.placeholder = '....';
      inp.value = (ALT[c.mark] || {})[key] || '';
      inp.oninput = () => {
        inp.value = inp.value.replace(/\D/g, '').slice(0, 5);
        ALT[c.mark] = ALT[c.mark] || {};
        ALT[c.mark][key] = inp.value;
        if (!ALT[c.mark].a1 && !ALT[c.mark].sb && !ALT[c.mark].a2) delete ALT[c.mark];
        refreshAlt(); save();
      };
      inp.onfocus = () => inp.select();
      inp.onkeydown = e => { if (e.key === 'Enter'){
        e.preventDefault();
        const all = [...box.querySelectorAll('input')];
        const next = all[all.indexOf(inp) + (e.shiftKey ? -1 : 1)];
        if (next){ next.focus(); next.select(); }
        else if (!e.shiftKey) inp.blur();
      } };
      cell.append(s, inp);
      row.appendChild(cell);
    }
    box.appendChild(row);
  }
  const altInputs = [...box.querySelectorAll('input')];
  altInputs.forEach((inp, i) => { inp.enterKeyHint = i === altInputs.length - 1 ? 'done' : 'next'; });
  alerted.clear();
  if (announced)
    for (const mark of announced) if (CHECKS.some(c => c.mark === mark)) alerted.add(mark);
  refreshAlt();
}

/* ---- fuel checks ----
   "A fuel check must be done when overflying the waypoint or at least every 30
   minutes." The record already exists: the fuel column of the waypoint table. So
   these rows only watch the clock and read that column — nothing to type twice. */
// Minutes from takeoff at which a waypoint is actually reached: the plan's own
// figure, moved by however far the flight is running from it. A direct is the
// case that matters — it brings every later waypoint forward, and windows matched
// on the planned figure then point at waypoints the aeroplane never flew.
const flown = () => RESULT.filter(p => p.sec === 1 && !isSkipped(p.i));

// When a waypoint is actually passed: its own ATO once that has been entered,
// otherwise the plan's time carried by however far the flight is running from it.
const atTime = (p, off) => {
  const a = ACT[p.i] && ACT[p.i].ato ? parseTime(ACT[p.i].ato) : null;
  return a === null ? p.t + off : a;
};

const hasFuel = p => validFuelEntry((ACT[p.i] || {}).fuel);
const checksFor = off => fuelChecks(flown(), off, hasFuel, atTime);
const boxFor = (c, off) => fuelBox(flown(), c, off);
// The waypoint the check falls on: the last one before the half-hour mark, so the
// reading is taken at the mark rather than anywhere inside the window. A figure
// entered at any point in the window still satisfies it — only the ring narrows.
const fuelPoint = (c, off) => { const w = boxFor(c, off); return w.length ? w[w.length - 1] : null; };
const fuelState = (c, off) => {
  if (boxFor(c, off).some(hasFuel)) return 'done';
  const d = sinceDue(c.due);
  return d >= 0 ? 'late' : d >= -10 ? 'soon' : 'wait';
};

const renderFuel = () => refreshFuel();   // the windows are rebuilt on every refresh

/* The windows are no longer listed: they are derived entirely from the fuel column
   of the table above, so they are shown on it. One tile carries the state, the
   banner carries an overdue one, and the fuel boxes of the window that is due are
   ringed — which is where the figure has to go. */
function refreshFuel(){
  // Rebuilt here rather than only on render: which waypoints a window covers moves
  // with the offset, and the offset changes every time an ATO is entered.
  const off = RESULT.length ? currentOffset() : 0;
  FUEL = checksFor(off);
  document.querySelectorAll('#tbl td.fu.due').forEach(td => td.classList.remove('due', 'late'));
  const tile = $('#stFuel');
  if (!FUEL.length){
    hide('#m6');
    if (tile){ tile.querySelector('b').textContent = '—'; tile.querySelector('span').textContent = 'Fuel check'; }
    return;
  }
  const late = FUEL.filter(c => fuelState(c, off) === 'late');
  // The one to act on: the earliest overdue window, or failing that the next due.
  const open = late[0] || FUEL.find(c => fuelState(c, off) !== 'done');

  if (tile){
    const st = open ? fuelState(open, off) : 'done';
    const d = open ? sinceDue(open.due) : 0;
    tile.className = 'stat ' + (st === 'late' ? 'bad' : st === 'soon' ? 'warn' : '');
    tile.querySelector('b').textContent = open ? fmt(open.due) : 'done';
    tile.querySelector('span').textContent =
      !open ? 'All fuel checks recorded'
      : st === 'late' ? `Fuel check · overdue by ${d} min`
      : `Fuel check · in ${-d} min`;
  }

  if (open && fuelState(open, off) !== 'done'){
    const p = fuelPoint(open, off), row = p && rowOf(p.i);
    const td = row && row.querySelector('td.fu');
    if (td){ td.classList.add('due'); td.classList.toggle('late', fuelState(open, off) === 'late'); }
  }

  late.length ? msg('#m6', late.length === 1
          ? `Fuel check due at ${fmt(late[0].due)} with no fuel recorded — the box is ringed in the table.`
          : `${late.length} fuel checks are due with no fuel recorded.`, 'err')
       : hide('#m6');
}

// One table cell holding one of the two entry boxes. Its attributes are set as
// properties rather than interpolated into markup, so no row is ever parsed.
function cellInput(cls, i, len, placeholder, value, tdCls){
  const td = mk('td', tdCls || null), inp = document.createElement('input');
  inp.className = cls;
  inp.dataset.i = i;
  inp.maxLength = len;
  inp.type = 'text';
  inp.inputMode = 'none'; inp.pattern = '[0-9]*';
  inp.autocomplete = 'off'; inp.spellcheck = false; inp.enterKeyHint = 'next';
  inp.setAttribute('autocorrect', 'off');
  inp.placeholder = String(placeholder);
  inp.value = String(value);
  td.appendChild(inp);
  return td;
}

function render(t0, arr){
  const last = RESULT.filter(p => p.sec === 1).slice(-1)[0];
  const stats = $('#stats');
  clear(stats);
  for (const [id, value, caption] of [
        [null,       fmt(t0),                      'Takeoff'],
        [null,       last ? fmt(arr) : '—',        'Arrival (ETO)'],
        [null,       last ? hhmm(last.cum) : '—',  'Time en route'],
        [null,       RESULT.length,                'Waypoints'],
        ['stFilled', 0,                            'Actuals entered'],
        ['stNext',   '—',                          'Next waypoint'],
        ['stFuel',   '—',                          'Fuel check']]){
    const d = mk('div', 'stat');
    if (id) d.id = id;
    d.appendChild(mk('b', null, value));
    d.appendChild(mk('span', null, caption));
    stats.appendChild(d);
  }
  clockTick();

  const tb = $('#tbl tbody'); clear(tb);
  let lastSec = 0;
  for (const p of RESULT){
    if (p.sec !== lastSec){
      lastSec = p.sec;
      const h = tb.insertRow(); h.className = 'hdr';
      const td = mk('td', null, p.sec === 1 ? 'Main route' : 'Alternate route (ALTN)');
      td.colSpan = 9;
      h.appendChild(td);
    }
    const a = ACT[p.i] || {};
    const r = tb.insertRow(); r.dataset.i = p.i;
    // The waypoint name is document text — written as text, never as markup.
    r.appendChild(mk('td', null, p.wp));
    r.appendChild(mk('td', 'num', p.et));
    r.appendChild(mk('td', 'num', hhmm(p.cum)));
    r.appendChild(mk('td', 'eto', fmt(p.t)));
    r.appendChild(cellInput('ato numkey', p.i, 4, fmt(p.t), a.ato || ''));
    r.appendChild(mk('td', 'num', p.rem ?? '—'));
    r.appendChild(cellInput('fuel numkey', p.i, 5, p.rem ?? '', a.fuel || '', 'fu'));
    const diff = mk('td', 'diff');
    diff.dataset.d = p.i;
    r.appendChild(diff);
    r.appendChild(mk('td', 'num', p.page + 1));
    paint(p.i);
    paintDct(p.i);
  }
  bindInputs(); countFilled(); lastNext = null;
  tb.onclick = e => {
    if (!dctPick) return;
    const tr = e.target.closest('tr[data-i]');
    if (tr) applyDirect(tr.dataset.i);
  };
  renderDctChips(); refreshProgress();
  scrollHint(document.querySelector('.tblbox'));
}

const rowOf = i => $(`#tbl tbody tr[data-i="${i}"]`);
const planOf = i => RESULT.find(p => p.i === +i);

function paint(i){
  const p = planOf(i), a = ACT[i] || {}, td = $(`td.diff[data-d="${i}"]`);
  if (!td || !p) return;
  const f = validFuelEntry(a.fuel) ? +a.fuel : null;
  if (f === null || p.rem === null){ td.textContent = '—'; td.style.color = 'var(--fld)'; }
  else {
    const d = f - p.rem;
    td.textContent = (d > 0 ? '+' : '') + d;
    td.style.color = onScreen(d === 0 ? C.fuel : d > 0 ? C.pos : C.neg);
  }
  const tr = rowOf(i);
  if (tr) tr.classList.toggle('filled', !!(a.ato || a.fuel));
}
function countFilled(){
  const n = RESULT.filter(p => { const a = ACT[p.i]; return a && (a.ato || a.fuel); }).length;
  const el = $('#stFilled'); if (el) el.querySelector('b').textContent = n;
}
function refreshInputValidity(){
  let previousFuel = null;
  for (const inp of document.querySelectorAll('#tbl input')){
    const isAto = inp.classList.contains('ato'), value = inp.value;
    const bad = value.length > 0 && (isAto ? parseTime(value) === null : !validFuelEntry(value));
    inp.classList.toggle('bad', bad);
    inp.setAttribute('aria-invalid', bad ? 'true' : 'false');
    inp.classList.remove('suspect');
    inp.removeAttribute('title');
    if (bad){
      inp.title = isAto ? 'Enter a valid UTC time as HHMM.' : 'Fuel must be a positive number.';
      continue;
    }
    if (!isAto && validFuelEntry(value) && !isSkipped(inp.dataset.i)){
      const fuel = +value;
      if (previousFuel !== null && fuel > previousFuel){
        inp.classList.add('suspect');
        inp.title = 'Fuel is higher than the previous entered value — check the entry.';
      }
      previousFuel = fuel;
    }
  }
}

function bindInputs(){
  const inputs = [...document.querySelectorAll('#tbl input')];
  inputs.forEach((inp, idx) => {
    inp.oninput = () => {
      const i = inp.dataset.i, isAto = inp.classList.contains('ato');
      inp.value = inp.value.replace(/\D/g, '').slice(0, isAto ? 4 : 5);
      ACT[i] = ACT[i] || {};
      ACT[i][isAto ? 'ato' : 'fuel'] = inp.value;
      if (!ACT[i].ato && !ACT[i].fuel) delete ACT[i];
      refreshInputValidity();
      paint(i); countFilled(); refreshFuel(); refreshProgress(); save();
    };
    inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault();
      const nx = inputs[idx + (e.shiftKey ? -1 : 1)];
      if (nx){ nx.focus(); nx.select(); } else if (!e.shiftKey) inp.blur(); } };
    inp.onfocus = () => inp.select();
  });
  refreshInputValidity();
}

/* ================= document fields ================= */
function renderFields(){
  const box = $('#fields'); clear(box);
  const groups = [];
  for (const f of FIELDS){
    const s = f.segs[0], key = s.page + ':' + s.base, g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(f); else groups.push({ key, items: [f] });
  }

  const mkInput = f => {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.id = 'fd' + f.i; inp.maxLength = f.n; inp.value = TXT[f.i] || '';
    inp.placeholder = '.'.repeat(Math.min(f.n, 40));
    inp.autocapitalize = 'characters'; inp.spellcheck = false; inp.enterKeyHint = 'next';
    inp.autocomplete = 'off'; inp.setAttribute('autocorrect', 'off');
    if (/^(ALTM\d|STBY|QNH|PIC BLOCK)$/i.test(f.label)){   // digits-only fields
      inp.inputMode = 'none'; inp.pattern = '[0-9]*'; inp.classList.add('numkey');
    }
    inp.oninput = () => {
      inp.value = inp.value.toUpperCase().slice(0, f.n);
      TXT[f.i] = inp.value;
      if (!inp.value) delete TXT[f.i];
      fieldsSummary();
      const c = document.getElementById('cnt' + f.i);
      if (c) c.textContent = inp.value.length + ' / ' + f.n;
      save();
    };
    inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault();
      const nx = document.getElementById('fd' + (f.i + (e.shiftKey ? -1 : 1)));
      if (nx) nx.focus(); else if (!e.shiftKey) inp.blur(); } };
    return inp;
  };

  for (const g of groups){
    // Each field's label/input/counter travels together, so a landscape row can
    // hold two of them side by side without a field's own counter drifting under
    // its neighbour's input.
    const fgrp = document.createElement('div');
    fgrp.className = 'fgrp';
    if (g.items.length === 1){
      const f = g.items[0];
      const lab = document.createElement('label');
      lab.htmlFor = 'fd' + f.i; lab.textContent = f.label || 'field ' + (f.i + 1);
      const inp = mkInput(f);
      const cnt = document.createElement('div');
      cnt.className = 'cnt'; cnt.id = 'cnt' + f.i;
      cnt.textContent = inp.value.length + ' / ' + f.n;
      if (f.ref){
        // Pinned inside the box rather than used as the placeholder: it is wanted
        // most at the moment of typing, which is when a placeholder disappears.
        const cell = document.createElement('div');
        cell.className = 'withref';
        const ref = document.createElement('span');
        ref.className = 'ref';
        ref.textContent = 'PLANNED BLKF (' + f.ref + ')';
        cell.append(inp, ref);
        fgrp.append(lab, cell, cnt);
      } else fgrp.append(lab, inp, cnt);
    } else {
      // Already three inputs wide — takes the row to itself rather than pairing
      // with a neighbour.
      fgrp.classList.add('wide');
      const lab = document.createElement('label');
      lab.textContent = g.items[0].rowLabel || g.items.map(f => f.label).join(' / ');
      const wrap = document.createElement('div');
      wrap.className = 'multi';
      for (const f of g.items){
        const cell = document.createElement('div');
        const cap = document.createElement('small');
        cap.textContent = f.label || 'field ' + (f.i + 1);
        cell.append(cap, mkInput(f));
        wrap.appendChild(cell);
      }
      fgrp.append(lab, wrap);
    }
    box.appendChild(fgrp);
  }
  fieldsSummary();
}
// What the collapsed card shows in place of the grid — read at a glance rather
// than reopened just to check whether anything was missed.
function fieldsSummary(){
  const el = $('#fldSum'); if (!el) return;
  const n = FIELDS.filter(f => TXT[f.i]).length;
  el.textContent = n + ' of ' + FIELDS.length + ' filled';
}
$('#c4Head').onclick = () => $('#c4').classList.toggle('collapsed');

$('#clearAct').onclick = () => {
  if (!confirm('Clear all entered ATO and fuel values?')) return;
  for (const k in ACT) delete ACT[k];
  document.querySelectorAll('#tbl input').forEach(i => {
    i.value = ''; i.classList.remove('bad', 'suspect'); i.setAttribute('aria-invalid', 'false'); i.removeAttribute('title');
  });
  RESULT.forEach(p => paint(p.i)); countFilled(); refreshFuel(); save();
};

/* ================= stored flight data =================
   What the crew enters is kept on this device against the plan it was entered
   for. A plan used to be identified by its file name and byte length, which two
   different packages can share — one flight's takeoff time, ATO, fuel,
   altimeter readings and directs would then be handed to another. The identity
   is the PDF's own SHA-256 instead: two files carry the same state only if they
   are the same file, byte for byte.

   Nothing here leaves the device, and nothing here is kept forever: entries age
   out after RETAIN_DAYS and only the MAX_PLANS most recent are kept, so a
   shared tablet does not accumulate other people's flights. */
// PLAN_PREFIX, legacyKeyFor, planKeyFor, planKeysIn and prunePlans are in
// ofp-core.js; only the device-side wiring is here.
const RETAIN_DAYS = 30, MAX_PLANS = 20;

const digestOf = OFPStorage.digestOf;

const storedPlanKeys = () => planKeysIn(localStorage);
function readPlan(key){
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch(e){ return null; }
}
function dropPlan(key){ try { localStorage.removeItem(key); } catch(e){} }

const pruneStoredPlans = () => prunePlans(localStorage, Date.now(), RETAIN_DAYS, MAX_PLANS);

function showStoredCount(){}

// The plan that is open stays: a crew clearing the device's history part-way
// through a flight must not lose the flight they are flying. Everything else —
// and the resume copy of the PDF itself — goes.
async function clearStoredPlans(keep){
  for (const k of storedPlanKeys()) if (k !== keep) dropPlan(k);
  if (!keep) await dropSession();
  showStoredCount();
}

/* ================= autosave ================= */
let saveT = null;
function writeState(){
  if (!KEY) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      etd: $('#etd').value, alt: $('#alt').checked, act: ACT, txt: TXT, alt2: ALT,
      alerted: [...alerted], alarm: $('#altAlert').checked, dct: DCT.marks,
      at: nowUtc(), savedAt: Date.now() }));
    const d = new Date();
    $('#saved').textContent = 'saved ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    showStoredCount();
  } catch(e){ $('#saved').textContent = 'storage unavailable'; }
}
function save(){
  if (!KEY) return;
  clearTimeout(saveT);
  saveT = setTimeout(writeState, 250);
}
function flushSave(){ if (saveT){ clearTimeout(saveT); saveT = null; writeState(); } }
function restore(){
  const st = readPlan(KEY);
  if (st || !HASH) return st;
  // One-time carry-over from the name-and-size key this file would have used
  // before: a crew part-way through a flight must not lose what they entered
  // to an app update. The old entry is then dropped, and this plan is content
  // -addressed from here on.
  const legacy = legacyKeyFor(NAME, SIZE);
  const old = readPlan(legacy);
  if (!old) return null;
  dropPlan(legacy);
  try { localStorage.setItem(KEY, JSON.stringify({ ...old, savedAt: Date.now() })); } catch(e){}
  return old;
}
// iPadOS evicts backgrounded tabs without warning, and the 250 ms debounce would
// swallow the last keystrokes. Both events fire before the app is frozen.
addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

/* ================= session survival =================
   The form state fits in localStorage, the PDF does not — it goes to IndexedDB so
   a cold start can pick the flight up where it stopped instead of showing an empty
   drop zone. Every failure here is non-fatal: the app just loses the resume. */
async function keepSession(name, size, buf){
  return OFPStorage.keepSession(name, size, HASH, buf);
}
async function dropSession(){ return OFPStorage.dropSession(); }
async function resumeSession(){
  const rec = await OFPStorage.resumeRecord();
  if (rec) await loadBuffer(rec.name, rec.size, rec.buf, true);
}
pruneStoredPlans();
showStoredCount();
resumeSession();

/* ================= PDF generation ================= */
function build(){
  const per = new Map();
  const ops = pi => { if (!per.has(pi)) per.set(pi, new PDFMini.Ops()); return per.get(pi); };
  const WHITE = [1, 1, 1];
  const C_ETO = rgbArr(C.eto), C_ATO = rgbArr(C.ato), C_FUEL = rgbArr(C.fuel), C_DOC = rgbArr(C.doc);
  const right = (x, cw, w, t) => x + (w - t.length) * cw;

  const fuelPages = new Set(RESULT.filter(p => ACT[p.i] && ACT[p.i].fuel).map(p => p.page));
  for (const h of HDRS){
    if (!fuelPages.has(h.page)) continue;
    const o = ops(h.page), A = ANCHOR + h.cw;
    o.text(BOLD, h.size, right(A, h.cw, 5, 'DIFF'), h.base + 12, 'DIFF', C_FUEL);
    o.text(BOLD, h.size, right(A, h.cw, 5, 'FUEL'), h.base, 'FUEL', C_FUEL);
    o.text(BOLD, h.size, A, h.base - 12, '-----', C_FUEL);
  }

  for (const p of RESULT){
    const o = ops(p.page), cw = p.cw, a = ACT[p.i] || {};
    o.rect(p.ex - 1, p.ey - 2.6, cw * 4 + 1.5, p.size + .5, WHITE);
    o.text(BOLD, p.size, p.ex, p.ey, fmt(p.t), C_ETO);

    if (parseTime(a.ato) !== null){
      o.rect(p.ax - 1, p.ay - 2.6, cw * 4 + 1.5, p.size + .5, WHITE);
      o.text(BOLD, p.size, p.ax, p.ay, a.ato, C_ATO);
    }
    if (validFuelEntry(a.fuel)){
      const A = ANCHOR + cw;
      o.text(BOLD, p.size, right(A, cw, 5, a.fuel), p.ay, a.fuel, C_FUEL);
      if (p.rem !== null){
        const d = +a.fuel - p.rem, t = (d > 0 ? '+' : '') + d;
        o.text(BOLD, p.size, right(A, cw, 5, t), p.ey, t,
               rgbArr(d === 0 ? C.fuel : d > 0 ? C.pos : C.neg));
      }
    }
  }

  const PGS = DOC.pages();
  for (const c of CHECKS){
    const v = ALT[c.mark];
    if (!v || (!v.a1 && !v.sb && !v.a2)) continue;
    const p = c.wp, o = ops(p.page), cw = p.cw, lh = p.ey - p.ay;
    const pad = s => (s || '....').padStart(4, ' ');
    const line = 'ALTM CHK   ALTM1 ' + pad(v.a1) + '   STBY ' + pad(v.sb) + '   ALTM2 ' + pad(v.a2);
    const mb = (PGS[p.page] && PGS[p.page].MediaBox) || [0, 0, 612, 792];
    const x = mb[0] + ((mb[2] - mb[0]) - line.length * cw) / 2;   // centred on the page
    o.rect(x - 1, p.ay - lh - 2.6, cw * line.length + 2, p.size + .5, WHITE);
    o.text(BOLD, p.size, x, p.ay - lh, line, C_DOC);
  }

  for (const f of FIELDS){
    const v = TXT[f.i] || '';
    if (!v) continue;
    layout(v, f.segs).forEach((part, k) => {
      if (!part) return;
      const s = f.segs[k], o = ops(s.page);
      o.rect(s.x - 1, s.base - 2.6, s.cw * s.n + 1.5, s.size + .5, WHITE);
      o.text(BOLD, s.size, s.x, s.base, part, C_DOC);
    });
  }

  const map = new Map([...per].map(([k, v]) => [k, v.done()]));
  const fonts = [{ name: BOLD,
    dict: '<</Type/Font/BaseFont/Courier-Bold/Encoding/StandardEncoding/Subtype/Type1>>' }];
  return new Blob([PDFMini.append(DOC, map, { fonts })], { type: 'application/pdf' });
}
const outName = () => NAME.replace(/\.pdf$/i, '') + '_ETO.pdf';

$('#dl').onclick = async () => {
  const missing = CHECKS.filter(c => ['late','part','soon','wait'].includes(chkState(c)));
  const noFuel = FUEL.filter(c => fuelState(c, currentOffset()) === 'late');
  const warn = [];
  if (missing.length) warn.push(
    `${missing.length} altimeter cross-check${missing.length > 1 ? 's are' : ' is'} not recorded `
    + `(${missing.map(c => '+' + c.mark / 60 + 'h').join(', ')}).`);
  if (noFuel.length) warn.push(
    `${noFuel.length} fuel check${noFuel.length > 1 ? 's are' : ' is'} overdue with no fuel recorded.`);
  if (warn.length && !confirm(warn.join('\n') + '\n\nSave anyway?')) return;
  const b = $('#dl'); b.disabled = true; b.textContent = 'Building…';
  // Both the share-succeeded and the share-cancelled paths return from inside the
  // try, so the button has to be restored in a finally or it stays dead.
  try {
    const blob = build(), name = outName();
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })){
      try { await navigator.share({ files: [file], title: name });
            msg('#m3', 'Ready — choose “Save to Files” in the share sheet.', 'ok'); return; }
      catch (e){ if (e.name === 'AbortError'){ hide('#m3'); return; } }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    msg('#m3', 'Saved: ' + name, 'ok');
  } catch (e){
    console.error('OFP PDF save failed:', e);
    msg('#m3', 'The completed OFP PDF could not be saved. Try Save PDF again.', 'err');
  }
  finally { b.disabled = false; b.textContent = 'Save PDF'; }
};

$('#open').onclick = () => {
  try {
    const url = URL.createObjectURL(build());
    const w = window.open(url, '_blank');
    if (!w) msg('#m3', 'The browser blocked the preview tab — use “Save PDF” instead.', 'warn');
    else hide('#m3');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e){
    console.error('OFP PDF preview failed:', e);
    msg('#m3', 'The PDF preview could not be opened. Use Save PDF instead.', 'err');
  }
};


$('#reset').onclick = () => {
  if (!confirm('Reset everything?\n\nThe loaded plan and all entered data will be discarded.')) return;
  if (KEY) dropPlan(KEY);
  clearTimeout(saveT); saveT = null;
  dropSession();
  RAW = null; DOC = null; PLAN = null; RESULT = []; FIELDS = []; FPL = null;
  NAME = ''; SIZE = 0; HASH = null; KEY = '';
  showStoredCount();
  alerted.clear();
  DCT.marks = []; syncDct(); setPick(false); renderDctChips();
  for (const k in ACT) delete ACT[k];
  for (const k in TXT) delete TXT[k];
  for (const k in ALT) delete ALT[k];
  showIcao(null); showOfp(null); showFigs(null); showWx(null); showCharts(null); openCharts(false);
  $('#file').value = ''; $('#etd').value = ''; $('#etd').placeholder = '----';
  $('#fname').textContent = ''; $('#saved').textContent = '';
  drop.classList.remove('loaded');
  $('#c4').classList.remove('collapsed'); $('#fplBox').classList.remove('collapsed');
  for (const c of ['#c2','#c3','#c4','#c5','#c6','#c7','#c8']) $(c).classList.add('hide');
  $('#fpl').className = 'hint hide';
  hide('#m1'); hide('#m2'); hide('#m3');
};
