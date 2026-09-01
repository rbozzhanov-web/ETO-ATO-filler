'use strict';
const VERSION = '2';
const KEY = 'journeylog.v1';


/* ------------------------------------------------------------------ geometry
   Straight off the document, in points. The page is A4 landscape and every
   table is a fixed set of column edges with 16.56pt rows, so a page is
   described by its row counts alone.                                        */
const PAGE_W = 841.89, PAGE_H = 595.28, LW = 0.75, ROW = 16.56;

const LEG_X = [17.28,28.61,71.13,110.81,150.49,190.17,229.85,269.53,309.21,348.89,
               388.57,428.25,467.93,507.61,547.29,586.97,626.65,666.33,706.01,745.69,785.37];
const LEG_HDR = ['','Date','Flight','Ac.Reg','Dep','Arr','STD','STA','ATD','ATA','TKOF',
                 'TDWN','Blk','NtBLK','Flt','TO','LD','MA','FlAlt','DETAIL'];
const LEG_KEY = [null,'date','flight','acreg','dep','arr','std','sta','atd','ata','tkof',
                 'tdwn','blk','ntblk','flt','to','ld','ma','flalt','detail'];
const LEG_PRE  = new Set(['date','flight','acreg','dep','arr','std','sta']);
const LEG_TIME = new Set(['std','sta','atd','ata','tkof','tdwn','blk','ntblk','flt']);

const FUEL_X = [17.28,28.61,68.29,107.97,147.65,187.33,227.01,266.69,306.37,346.05,408.41,470.76];
const FUEL_HDR = ['','Init','UplfW','Calc Ramp','Act Ramp','Stdn','Burn','UplfV','Fuel Disc','Slip 1','Slip 2'];
const FUEL_KEY = [null,'init','uplfw','calcramp','actramp','stdn','burn','uplfv','fueldisc','slip1','slip2'];

const PL_X = [470.76,510.44,550.12,589.80,629.48,669.16,708.84,748.52];
const PL_HDR = ['ADL','CHL','INF','Cargo','Mail','BAG','ZFW'];
const PL_KEY = ['adl','chl','inf','cargo','mail','bag','zfw'];

const CREW_X = [17.28,28.61,68.29,85.30,198.67,238.35,278.03,317.71,357.39,640.82,660.66];
const CREW_HDR = ['','Staff No','POS','Name','DUTY','Duty time','Night duty','Alwd. time','REMARKS',''];
const CREW_KEY = [null,'staff','pos','name','duty','dutytime','night','alwd','remarks','leg'];
const CREW_PRE  = new Set(['staff','pos','name','leg']);
const CREW_TIME = new Set(['dutytime','night','alwd']);   // written as HH:MM, like the rest
const DUP_KEYS = ['duty','dutytime','night','alwd'];   // the same for the whole crew, usually

const LEG_TOP = 42.81;            // top of the leg table
const GAP_FUEL = 5.25;            // leg table bottom to the Fuel / PayLoad title band
const GAP_CREW = 6.00;            // fuel table bottom to the crew table
const IMM_RULES = [28.27,39.52,50.77];   // from the crew table bottom
const REM_BOX = {top:11.24, bot:78.89, x0:491.58, x1:817.42};

/* ================================================================= the form
   The document is read rather than assumed. Every row of every table carries
   a printed row number in its narrow left column, so the tables announce their
   own length; the three header labels below say where each one starts.       */

/* One text item per BT block: the position comes from Tm, and each cell on the
   form is its own block, so no glyph widths are needed to place anything. */
function blockItems(content, fonts){
  const lx = new Lexer(content, 0);
  const st = [];
  const out = [];
  let font = null, cur = null;
  const flush = ()=>{ if(cur && cur.t.trim()) out.push(cur); cur = null; };
  for(;;){
    const o = lx.obj();
    if(o === null) break;
    if(o === undefined) continue;
    if(typeof o === 'object' && 'op' in o){
      const op = o.op;
      if(op === 'BT'){ flush(); font = null; }
      else if(op === 'ET') flush();
      else if(op === 'Tf'){
        const n = st[st.length - 2];
        font = (n && n.name) ? fonts[n.name] : null;
      }
      else if(op === 'Tm'){
        const v = st.slice(-6);
        if(v.length === 6){
          flush();
          cur = { x:v[4], y:v[5], size:Math.abs(v[0]) || Math.abs(v[1]), t:'' };
        }
      }
      else if(op === 'Tj' || op === "'" || op === '"'){
        const s = st[st.length - 1];
        if(cur && s && s.text !== undefined) cur.t += decode(s.text, font);
      }
      else if(op === 'TJ'){
        const a = st[st.length - 1];
        if(cur && Array.isArray(a)) for(const el of a)
          if(el && el.text !== undefined) cur.t += decode(el.text, font);
      }
      st.length = 0;
    } else st.push(o);
  }
  flush();
  return out;
}

/* Identity-H puts two bytes to the glyph; the ToUnicode map says what each one
   stands for. A simple font is its bytes. */
function decode(raw, font){
  if(!font || !font.two){
    let s = '';
    for(let i = 0; i < raw.length; i++) s += raw[i];
    return s;
  }
  let s = '';
  for(let i = 0; i + 1 < raw.length; i += 2){
    const code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
    const u = font.map.get(code);
    s += u === undefined ? ' ' : u;
  }
  return s;
}

const hexToChars = h => {
  let s = '';
  for(let i = 0; i + 3 < h.length; i += 4) s += String.fromCharCode(parseInt(h.substr(i, 4), 16));
  return s;
};
function parseCMap(txt){
  const map = new Map();
  txt.replace(/beginbfchar([\s\S]*?)endbfchar/g, (m, blk)=>{
    blk.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, (m2, a, b)=>{
      map.set(parseInt(a, 16), hexToChars(b)); return '';
    });
    return '';
  });
  txt.replace(/beginbfrange([\s\S]*?)endbfrange/g, (m, blk)=>{
    // <lo><hi><dst>  and  <lo><hi>[<d1><d2>...]
    blk.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g,
      (m2, a, b, whole, single, list)=>{
        const lo = parseInt(a, 16), hi = parseInt(b, 16);
        if(single !== undefined){
          const base = parseInt(single.slice(-4), 16), pre = hexToChars(single).slice(0, -1);
          for(let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, pre + String.fromCharCode(base + c - lo));
        } else {
          let k = 0;
          list.replace(/<([0-9A-Fa-f]+)>/g, (m3, d)=>{ map.set(lo + k++, hexToChars(d)); return ''; });
        }
        return '';
      });
    return '';
  });
  return map;
}

async function pageFonts(pdf, page){
  const res = pdf.get(page.Resources) || {};
  const fd = pdf.get(res.Font) || {};
  const fonts = {};
  for(const name of Object.keys(fd)){
    const f = pdf.get(fd[name]);
    if(!f) continue;
    const two = f.Subtype && f.Subtype.name === 'Type0';
    let map = new Map();
    const tu = pdf.get(f.ToUnicode);
    if(tu && tu.dict){
      try{ map = parseCMap(toStr(await pdf.stream(tu))); }catch(e){}
    }
    fonts[name] = { two, map };
  }
  return fonts;
}

/* Which column an item's left edge falls in. */
function colOf(xs, x){
  for(let i = 0; i < xs.length - 1; i++) if(x >= xs[i] - 1 && x < xs[i + 1] - 1) return i;
  return -1;
}

const LEG_COL  = [null,'date','flight','acreg','dep','arr','std','sta','atd','ata','tkof',
                  'tdwn','blk','ntblk','flt','to','ld','ma','flalt','detail'];
const FUEL_COL = [null,'init','uplfw','calcramp','actramp','stdn','burn','uplfv','fueldisc','slip1','slip2'];
const PL_COL   = ['adl','chl','inf','cargo','mail','bag','zfw'];
const CREW_COL = [null,'staff','pos','name','duty','dutytime','night','alwd','remarks','leg'];

function readPage(items, pageH){
  for(const it of items) it.ty = pageH - it.y;          // baseline, measured from the top
  items.sort((a,b)=> a.ty - b.ty || a.x - b.x);
  const at = t => items.find(i => i.t.trim() === t);

  const legHdr = at('Date'), fuelHdr = at('Init'), crewHdr = at('Staff No');
  if(!legHdr || !fuelHdr || !crewHdr) throw new Error('not a Journey Log — its table headings are missing');

  // Every row prints its number in the narrow left column, blank rows included.
  const nums = items.filter(i => i.x >= 17 && i.x <= 28 && /^\d+$/.test(i.t.trim()));
  const bandOf = (lo, hi) => {
    const ys = [];
    for(const i of nums){
      if(i.ty <= lo + 2 || i.ty >= hi - 2) continue;
      if(!ys.some(y => Math.abs(y - i.ty) < 3)) ys.push(i.ty);
    }
    return ys.sort((a,b)=> a - b);
  };
  const legY  = bandOf(legHdr.ty,  fuelHdr.ty);
  const fuelY = bandOf(fuelHdr.ty, crewHdr.ty);
  const crewY = bandOf(crewHdr.ty, Infinity);
  if(!legY.length || !fuelY.length || !crewY.length) throw new Error('no rows found in the form');

  const fill = (ys, specs) => {
    const rows = ys.map(()=> ({}));
    for(const it of items){
      if(it.x < 17) continue;
      let r = -1;
      for(let k = 0; k < ys.length; k++) if(Math.abs(it.ty - ys[k]) < 3){ r = k; break; }
      if(r < 0) continue;
      for(const [xs, keys] of specs){
        const c = colOf(xs, it.x);
        if(c >= 0 && keys[c]){ rows[r][keys[c]] = it.t.trim(); break; }
      }
    }
    return rows;
  };

  const legs = fill(legY, [[LEG_X, LEG_COL]]);
  const both = fill(fuelY, [[FUEL_X, FUEL_COL], [PL_X, PL_COL]]);
  const crew = fill(crewY, [[CREW_X, CREW_COL]]);
  const pick = (row, keys) => {
    const o = {};
    for(const k of keys) if(k && row[k] !== undefined) o[k] = row[k];
    return o;
  };

  const head = items.filter(i => i.ty < legHdr.ty - 6);
  const near = x => (head.find(i => Math.abs(i.x - x) < 4) || {}).t || '';
  const title = near(325.49);
  const cap = near(233.99);
  const capM = /Captain\/\w+:\s*([\s\S]*?)\s*\/\/FD/.exec(cap);

  return {
    operator: near(53.88).trim(),
    stamp:    near(156.64).trim(),
    docno:    title.replace(/^Journey Log No\.\/\S+(\s+\S+)*?\s{2,}/, '').trim() || title.trim(),
    captain:  capM ? capM[1].trim() : '',
    cat:'', lt:'',
    legs,
    fuel:    both.map(r => pick(r, FUEL_COL)),
    payload: both.map(r => pick(r, PL_COL)),
    crew,
    immigration:['','',''], remarks:['','',''],
  };
}

async function parseJourneyLog(bytes){
  const pdf = new Doc(bytes);
  const pages = pdf.pages();
  if(!pages.length) throw new Error('the PDF has no pages');
  const out = [];
  for(const p of pages){
    const mb = (pdf.get(p.MediaBox) || [0,0,PAGE_W,PAGE_H]).map(v => pdf.get(v));
    const h = Math.abs(mb[3] - mb[1]) || PAGE_H;
    const fonts = await pageFonts(pdf, p);
    out.push(readPage(blockItems(await pdf.content(p), fonts), h));
  }
  return { pages: out, pdf };
}

function emptyDoc(){ return { version: VERSION, manual: {}, pages: [], source: null }; }
const clone = o => JSON.parse(JSON.stringify(o));

/* --------------------------------------------------------------------- state */
let doc = load();
let sourcePdf = null;
let sourceToken = 0;
const inputs = [];                      // in reading order, for Enter-to-next
const derived = new Map();              // path -> element, for Blk / Flt
const clears = [];                      // boxes that must start clear of the label beside them

function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const d = JSON.parse(raw);
      if(d && d.version === VERSION && Array.isArray(d.pages)){ d.manual = d.manual || {}; return d; }
    }
  }catch(e){}
  return emptyDoc();
}
let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    try{
      localStorage.setItem(KEY, JSON.stringify(doc));
    }catch(e){ say('There is no room left on the device to save this.', 'err'); }
  }, 250);
}

function get(path){
  return path.split('.').reduce((o,k)=> o == null ? o : o[k], doc);
}
function set(path, val){
  const parts = path.split('.');
  let o = doc;
  for(let i=0;i<parts.length-1;i++) o = o[parts[i]];
  o[parts[parts.length-1]] = val;
}

/* The form data is small enough for localStorage; the issued PDF belongs in
   IndexedDB. Keeping it there lets Export PDF remain available after the app is
   reopened, without placing a multi-megabyte document into localStorage. */
function sourceDb(){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('journeylog-source', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdf');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function putSource(bytes){
  const db = await sourceDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('pdf', 'readwrite');
    tx.objectStore('pdf').put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'current');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function getSource(){
  const db = await sourceDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('pdf', 'readonly').objectStore('pdf').get('current');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
async function dropSource(){
  try{
    const db = await sourceDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pdf', 'readwrite');
      tx.objectStore('pdf').delete('current');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }catch(e){}
}
async function restoreSource(){
  if(!doc.source) return;
  const token = ++sourceToken;
  try{
    const raw = await getSource();
    if(raw && token === sourceToken) sourcePdf = new Doc(new Uint8Array(raw));
  }catch(e){}
}

/* ------------------------------------------------------------------- helpers */
function pt(v){ return v + 'pt'; }
function box(parent, cls, x, y, w, h){
  const d = document.createElement('div');
  d.className = cls;
  d.style.left = pt(x); d.style.top = pt(y); d.style.width = pt(w); d.style.height = pt(h);
  parent.appendChild(d);
  return d;
}
function label(parent, cls, x, y, w, h, text){
  const d = box(parent, cls, x, y, w, h);
  d.textContent = text;
  return d;
}

/* The form's rules, drawn the way the document draws them: hairlines at every
   column edge, and a doubled weight where two rows meet. */
function grid(parent, xs, yTop, rows, rowH){
  const x0 = xs[0], x1 = xs[xs.length-1], h = rows * rowH;
  xs.forEach((x,i)=> box(parent,'rule', i ? x - LW : x, yTop, LW, h));
  for(let i=0;i<=rows;i++){
    const y = yTop + i*rowH;
    if(i === 0)          box(parent,'rule', x0, y,      x1-x0, LW);
    else if(i === rows)  box(parent,'rule', x0, y - LW, x1-x0, LW);
    else                 box(parent,'rule', x0, y - LW, x1-x0, LW*2);
  }
}

/* A cell you can type in. `pre` cells carry what the document was printed
   with; `fill` cells are the boxes. */
function field(parent, x0, x1, y, h, opt){
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'f ' + (opt.pre ? 'pre' : 'fill') + (opt.left ? ' l' : '');
  inp.style.left = pt(x0 + LW); inp.style.top = pt(y + LW);
  inp.style.width = pt(x1 - x0 - LW*2); inp.style.height = pt(h - LW*2);
  inp.value = opt.value || '';
  inp.dataset.path = opt.path;
  if(opt.numeric){ inp.inputMode = 'none'; inp.classList.add('numkey'); inp.enterKeyHint = 'next'; }
  if(opt.time) inp.dataset.time = '1';
  if(!opt.pre) inp.dataset.upper = '1';
  if(opt.maxlength) inp.maxLength = opt.maxlength;
  parent.appendChild(inp);
  /* Printed cells are locked, and stay out of the run of boxes the return key
     steps through — there is nothing to write in them. */
  if(opt.pre){ inp.readOnly = true; inp.tabIndex = -1; }
  else inputs.push(inp);
  return inp;
}

/* ================= numeric keypad =================
   iOS's own numeric keyboard, deliberately not raised (see the .numkey cells
   above): this bar stands in for it, docked and sliding the same way the system's
   own would, and reusing the page's own Enter-to-next-box handling below rather
   than knowing about it — the action key just replays a real Enter on whatever
   is focused. */
let NP_TARGET = null;
const numpad = document.getElementById('numpad');
// A field gaining focus opens the keypad by default — a tap, Tab, a hardware
// keyboard's own Up/Down between fields, even Safari's own native field-
// navigation chevrons in a text field's accessory bar, none of which raise an
// event this page can see happening first. This page has no autofocus call of
// its own to suppress — no plan is ever loaded straight into a box the way the
// companion's takeoff time is — but the one-shot flag stays here so the two
// pages' keypads keep reading as one implementation, ready if that changes.
let NP_SUPPRESS_NEXT = false;
function npSuppressNext(){ NP_SUPPRESS_NEXT = true; }
// Setting .value from script, unlike real typing, never sets a field's own
// dirty flag — so blurring it afterwards raises no native change event, only
// the input events dispatched below. This page's own HH:MM formatting is keyed
// off change, not input, and would otherwise never run for a box filled from
// this keypad. NP_DIRTY tracks that a flush is owed, and npFlushChange fires
// the change event by hand at the moment the field actually stops being
// edited — see its callers in npShow/npHide.
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
const NP_LABEL = { next: 'Next', go: 'Go', done: 'Done', previous: 'Previous', search: 'Search', send: 'Send' };
// The page's own tab-order array already carries this: Shift+Enter on the first
// field in it has nowhere to go, since the delegated handler below only ever
// steps within it.
function npHasPrev(el){ return inputs.indexOf(el) > 0; }
function npShow(el){
  npFlushChange();
  NP_TARGET = el;
  document.getElementById('numpadDoneLabel').textContent = NP_LABEL[el.enterKeyHint] || 'Done';
  document.getElementById('numpadPrev').disabled = !npHasPrev(el);
  numpad.classList.add('show');
  document.body.style.setProperty('--numpad-h', numpad.offsetHeight + 'px');
  document.body.classList.add('numpad-open');
  setTimeout(() => { if (NP_TARGET === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60);
}
function npHide(){
  npFlushChange();
  NP_TARGET = null;
  numpad.classList.remove('show');
  document.body.classList.remove('numpad-open');
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
numpad.querySelectorAll('[data-k]').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault();
  npClick();
  b.dataset.k === 'del' ? npDelete() : npInsert(b.dataset.k);
}));
document.getElementById('numpadDone').addEventListener('pointerdown', e => {
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
document.getElementById('numpadPrev').addEventListener('pointerdown', e => {
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
document.addEventListener('focusout', e => {
  if (e.target !== NP_TARGET) return;
  setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.matches || !a.matches('.numkey')) npHide();
  }, 0);
});
// Closes on its own, unconditionally — unlike the action key, which plays
// whatever the field's own Enter handler does and may only move on to the next
// box. inputmode="none" keeps Safari's keyboard from ever appearing, so none of
// its own dismiss gestures come with it; both this key and the two listeners
// below stand in for those.
function npHideForce(){
  const el = NP_TARGET;
  npHide();
  if (el) el.blur();
}
document.getElementById('numpadHide').addEventListener('pointerdown', e => { e.preventDefault(); npClick(); npHideForce(); });
// A tap anywhere outside the field and the keypad itself dismisses it, the way
// tapping elsewhere on the page dismisses the system keyboard.
document.addEventListener('pointerdown', e => {
  if (!NP_TARGET || e.target === NP_TARGET || numpad.contains(e.target)) return;
  npHideForce();
});
// A real scroll — one following an actual touch or wheel gesture, not the
// keypad's own scrollIntoView bringing the field above it into view, and not the
// sheet's own pinch-zoom pan — dismisses it too, the way scrolling the content
// behind the system keyboard does.
let NP_GESTURE = false;
addEventListener('touchmove', () => { NP_GESTURE = true; }, { passive: true });
addEventListener('wheel', () => { NP_GESTURE = true; }, { passive: true });
document.addEventListener('scroll', () => {
  if (NP_GESTURE && NP_TARGET) npHideForce();
  NP_GESTURE = false;
}, { passive: true, capture: true });

/* The underlined items across the top of the page size themselves to their
   text, exactly as the printed ones do. */
function editable(parent, cls, path, value){
  const s = document.createElement('span');
  s.className = 'ed ' + cls;
  s.spellcheck = false;
  s.textContent = value || '';
  s.dataset.path = path;
  if(cls === 'pre'){ s.contentEditable = 'false'; return parent.appendChild(s), s; }
  s.contentEditable = 'true';
  s.addEventListener('input', ()=>{ set(path, s.textContent); save(); });
  parent.appendChild(s);
  return s;
}

/* ------------------------------------------------------------------ the page */
/* A cell reads as print only if the document arrived with something in it.
   Anything the document left blank is a box, so a leg or a crew member can be
   written in by hand on a row the form was issued empty. */
function printed(sourceRow, key){
  return !!(sourceRow && sourceRow[key]);
}

function buildPage(p, pi){
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const src = doc.source ? doc.source[pi] : p;   // what the PDF held, before any typing

  const nLeg  = p.legs.length;
  const legB  = LEG_TOP + ROW*(1 + nLeg);
  const fuelT = legB + GAP_FUEL;
  const fuelB = fuelT + ROW*(2 + p.fuel.length);
  const crewT = fuelB + GAP_CREW;
  const crewB = crewT + ROW*(1 + p.crew.length);

  /* ---- head ---- */
  const mkHead = (x, y, w) => {
    const d = box(sheet, 'hd', x, y, w, 9.75);
    d.style.display = 'block'; d.style.whiteSpace = 'pre';
    return d;
  };

  const h1 = mkHead(53.88, 18.74, 240);
  editable(h1, 'pre', `pages.${pi}.operator`, p.operator);
  box(sheet, 'rule', 53.88, 27.36, 49.78, 0.7);

  const h2 = mkHead(156.64, 18.74, 160);
  editable(h2, 'pre', `pages.${pi}.stamp`, p.stamp);
  box(sheet, 'rule', 156.64, 27.36, 79.73, 0.7);

  const h3 = mkHead(325.49, 18.74, 400);
  h3.appendChild(document.createTextNode('Journey Log No./Задание на полет  '));
  editable(h3, 'pre', `pages.${pi}.docno`, p.docno);
  box(sheet, 'rule', 325.49, 27.36, 211.62, 0.7);

  const h4 = mkHead(233.99, 32.14, 560);
  h4.appendChild(document.createTextNode('Captain/KBC:'));
  editable(h4, 'pre', `pages.${pi}.captain`, p.captain);
  h4.appendChild(document.createTextNode(' //FD Crew Minima/Минимум экипажа: CAT '));
  const cat = editable(h4, '', `pages.${pi}.cat`, p.cat);
  cat.style.minWidth = '26pt';
  h4.appendChild(document.createTextNode('  L/T '));
  const lt = editable(h4, '', `pages.${pi}.lt`, p.lt);
  lt.style.minWidth = '26pt';

  /* ---- legs ---- */
  box(sheet, 'band', LEG_X[0], LEG_TOP, LEG_X[20]-LEG_X[0], ROW);
  grid(sheet, LEG_X, LEG_TOP, 1 + nLeg, ROW);
  LEG_HDR.forEach((t,c)=>{
    if(t) label(sheet, 'lbl w', LEG_X[c], LEG_TOP, LEG_X[c+1]-LEG_X[c], ROW, t);
  });
  p.legs.forEach((leg,r)=>{
    const y = LEG_TOP + ROW*(1+r);
    label(sheet, 'lbl', LEG_X[0], y, LEG_X[1]-LEG_X[0], ROW, String(r+1)).style.fontWeight = '400';
    LEG_KEY.forEach((k,c)=>{
      if(!k) return;
      const path = `pages.${pi}.legs.${r}.${k}`;
      const inp = field(sheet, LEG_X[c], LEG_X[c+1], y, ROW, {
        path, value: leg[k], pre: LEG_PRE.has(k) && printed(src && src.legs[r], k),
        time: LEG_TIME.has(k), numeric: LEG_TIME.has(k),
      });
      if(k === 'blk' || k === 'flt') derived.set(path, inp);
    });
  });

  /* ---- fuel and payload ---- */
  const fuelHdrX = FUEL_X.concat(PL_X.slice(1));
  box(sheet, 'band', 17.28, fuelT, 748.52-17.28, ROW);
  grid(sheet, [17.28, 470.76, 748.52], fuelT, 1, ROW);
  label(sheet, 'lbl w', 17.28, fuelT, 470.76-17.28, ROW, 'Fuel/Информация о топливе');
  label(sheet, 'lbl w', 470.76, fuelT, 748.52-470.76, ROW, 'PayLoad / Данные о коммерческой загрузке');

  const subT = fuelT + ROW;
  box(sheet, 'band2', 17.28, subT, 748.52-17.28, ROW);
  grid(sheet, fuelHdrX, subT, 1 + p.fuel.length, ROW);
  FUEL_HDR.forEach((t,c)=>{
    if(t) label(sheet, 'lbl', FUEL_X[c], subT, FUEL_X[c+1]-FUEL_X[c], ROW, t);
  });
  PL_HDR.forEach((t,c)=>{
    label(sheet, 'lbl', PL_X[c], subT, PL_X[c+1]-PL_X[c], ROW, t);
  });
  p.fuel.forEach((row,r)=>{
    const y = subT + ROW*(1+r);
    label(sheet, 'lbl', 17.28, y, 28.61-17.28, ROW, String(r+1)).style.fontWeight = '400';
    FUEL_KEY.forEach((k,c)=>{
      if(!k) return;
      field(sheet, FUEL_X[c], FUEL_X[c+1], y, ROW,
        {path:`pages.${pi}.fuel.${r}.${k}`, value:row[k], numeric:true});
    });
    PL_KEY.forEach((k,c)=>{
      field(sheet, PL_X[c], PL_X[c+1], y, ROW,
        {path:`pages.${pi}.payload.${r}.${k}`, value:p.payload[r][k], numeric:true});
    });
  });

  /* ---- crew ---- */
  box(sheet, 'band', CREW_X[0], crewT, CREW_X[10]-CREW_X[0], ROW);
  grid(sheet, CREW_X, crewT, 1 + p.crew.length, ROW);
  CREW_HDR.forEach((t,c)=>{
    if(t) label(sheet, 'lbl w', CREW_X[c], crewT, CREW_X[c+1]-CREW_X[c], ROW, t);
  });
  p.crew.forEach((m,r)=>{
    const y = crewT + ROW*(1+r);
    label(sheet, 'lbl', CREW_X[0], y, CREW_X[1]-CREW_X[0], ROW, String(r+1)).style.fontWeight = '400';
    CREW_KEY.forEach((k,c)=>{
      if(!k) return;
      field(sheet, CREW_X[c], CREW_X[c+1], y, ROW, {
        path:`pages.${pi}.crew.${r}.${k}`, value:m[k],
        pre: CREW_PRE.has(k) && printed(src && src.crew[r], k),
        left: k === 'remarks', time: CREW_TIME.has(k), numeric: CREW_TIME.has(k),
      });
    });
  });

  /* The duty figures are the same for the whole crew far more often than not,
     so the captain's row carries a button that puts its figure on every row. */
  const cpRow = Math.max(0, p.crew.findIndex(m => (m.pos || '').trim().toUpperCase() === 'CP'));
  if(p.crew.length > 1) DUP_KEYS.forEach(k=>{
    const c = CREW_KEY.indexOf(k);
    const y = crewT + ROW*(1 + cpRow);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dup'; b.textContent = '↓';
    b.tabIndex = -1;
    b.title = 'Put this on every crew member';
    b.style.left = pt(CREW_X[c+1] - 10.5); b.style.top = pt(y + (ROW - 9)/2);
    b.dataset.page = pi; b.dataset.key = k; b.dataset.from = cpRow;
    sheet.appendChild(b);
  });

  /* ---- footnote, immigration, remarks ---- */
  label(sheet, 'txt', 18.78, crewB + 2.56, 400, 7.5,
    'x : Operating Leg    * : Deadheading Leg    - : PAX Leg    . : Crew member not on board A/C');
  const immLbl = label(sheet, 'txt b', 18.78, crewB + 13.81, 0, 7.5,
    'IMMIGRATION CONTROL/Отметки пограничной службы');
  immLbl.style.width = 'auto';

  IMM_RULES.forEach((dy,i)=>{
    const y = crewB + dy;
    box(sheet, 'rule', 17.28, y, 392.23-17.28, 0.72);
    const x0 = i === 0 ? 200.5 : 18.28;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'f fill l';
    inp.style.left = pt(x0); inp.style.top = pt(y - 10);
    inp.style.width = pt(391.5 - x0); inp.style.height = '10pt';
    inp.value = p.immigration[i] || '';
    inp.dataset.path = `pages.${pi}.immigration.${i}`;
    inp.dataset.upper = '1';
    sheet.appendChild(inp); inputs.push(inp);
    if(i === 0) clears.push({label:immLbl, at:18.78, input:inp, right:391.5, min:200.5});
  });

  const rb = REM_BOX, rt = crewB + rb.top, rbot = crewB + rb.bot;
  box(sheet, 'rule', rb.x0, rt, rb.x1-rb.x0, LW);
  box(sheet, 'rule', rb.x0, rbot - LW, rb.x1-rb.x0, LW);
  box(sheet, 'rule', rb.x0, rt, LW, rbot-rt);
  box(sheet, 'rule', rb.x1 - LW, rt, LW, rbot-rt);
  const remLbl = label(sheet, 'txt b', 493.83, crewB + 14.26, 0, 7.5, 'Remarks/Ремарки');
  remLbl.style.width = 'auto';
  IMM_RULES.forEach((dy,i)=>{
    const y = crewB + dy;
    box(sheet, 'rule', 492.33, y, 816.67-492.33, 0.72);
    const x0 = i === 0 ? 556 : 493.5;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'f fill l';
    inp.style.left = pt(x0); inp.style.top = pt(y - 10);
    inp.style.width = pt(816 - x0); inp.style.height = '10pt';
    inp.value = p.remarks[i] || '';
    inp.dataset.path = `pages.${pi}.remarks.${i}`;
    inp.dataset.upper = '1';
    sheet.appendChild(inp); inputs.push(inp);
    if(i === 0) clears.push({label:remLbl, at:493.83, input:inp, right:816, min:556});
  });
  // The signature is put on the paper by hand, so there is nothing to type here.
  label(sheet, 'txt b', 493.83, crewB + 59.63, 0, 7.5, "Captain's Signature").style.width = 'auto';
  label(sheet, 'txt b', 493.83, crewB + 68.78, 0, 7.5, 'Подпись KBC:').style.width = 'auto';

  return sheet;
}

/* --------------------------------------------------------------------- fit
   The document is set in Calibri; whatever the device puts in its place is
   usually wider, and a long name or "Calc Ramp" would then run out of its
   cell. Anything that does not fit is set down a little until it does, so a
   column never loses its last character.                                    */
const BASE_PT = 7.5, MIN_K = 0.6;
function fitOne(el){
  el.style.fontSize = '';
  const need = el.scrollWidth, have = el.clientWidth;
  if(have <= 0 || need <= have + 0.5) return;
  el.style.fontSize = (BASE_PT * Math.max(MIN_K, have/need) * 0.98) + 'pt';
  if(el.scrollWidth > el.clientWidth + 0.5){
    el.style.fontSize = (parseFloat(el.style.fontSize) * 0.93) + 'pt';
  }
}
/* Batched: read every width first, then write, so one layout pass serves all. */
function fitAll(root){
  const els = [...root.querySelectorAll('.lbl,.txt,input.f')];
  els.forEach(e=>{ e.style.fontSize = ''; });
  const jobs = [];
  els.forEach(e=>{
    const need = e.scrollWidth, have = e.clientWidth;
    if(have > 0 && need > have + 0.5) jobs.push([e, Math.max(MIN_K, have/need)]);
  });
  jobs.forEach(([e,k])=>{ e.style.fontSize = (BASE_PT * k * 0.98) + 'pt'; });
  jobs.forEach(([e])=>{
    if(e.scrollWidth > e.clientWidth + 0.5) e.style.fontSize = (parseFloat(e.style.fontSize) * 0.93) + 'pt';
  });
}

/* ------------------------------------------------------------------- render */
const stage = document.getElementById('stage');

function render(){
  stage.textContent = '';
  inputs.length = 0; derived.clear(); clears.length = 0;
  document.body.classList.toggle('loaded', doc.pages.length > 0);
  if(!doc.pages.length) return;
  doc.pages.forEach((p,i)=>{
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.appendChild(buildPage(p,i));
    stage.appendChild(wrap);
  });
  applyZoom();
  refreshDerived();
  fitAll(stage);
  /* Three boxes share a line with a printed label. How wide that label comes
     out depends on the device's font, so each box is told where to start only
     once the label has been laid out. */
  clears.forEach(j=>{
    // offsetWidth is layout px, untouched by the sheet's transform, so this is
    // the same px -> pt conversion the export uses.
    const w = Math.max(j.label.offsetWidth, j.also ? j.also.offsetWidth : 0) * PX_TO_PT;
    const left = Math.max(j.min, j.at + w + 5);
    j.input.style.left = pt(left);
    j.input.style.width = pt(Math.max(24, j.right - left));
  });
}

/* ---------------------------------------------------------------- PDF export
   The geometry itself is in jl-pdf.js, where it is checked by the tests; this
   walks the sheets and hands it each filled box. */
const WRITTEN_RGB = [0.043, 0.31, 0.62];
function exportOps(){
  if(!sourcePdf) throw new Error('the original Journey Log is not available yet');
  const perPage = new Map();
  const ops = pi => {
    if(!perPage.has(pi)) perPage.set(pi, new PdfOps());
    return perPage.get(pi);
  };
  stage.querySelectorAll('.sheet').forEach((sheet, pi) => {
    const sheetRect = sheet.getBoundingClientRect();
    sheet.querySelectorAll('input.fill, .ed:not(.pre)').forEach(el => {
      const value = el.tagName === 'INPUT' ? el.value.trim() : el.textContent.trim();
      if(!value) return;
      const { x, y, size } = exportPlacement({
        rect: el.getBoundingClientRect(), sheetRect,
        fontPx: parseFloat(getComputedStyle(el).fontSize),
        length: value.length, alignLeft: el.classList.contains('l'),
        pageW: PAGE_W, pageH: PAGE_H });
      ops(pi).text('JL', size, x, y, value, WRITTEN_RGB);
    });
  });
  return perPage;
}
function exportName(){
  const no = (doc.pages[0] && doc.pages[0].docno) || 'Journey_Log';
  return no.replace(/[\\/:*?"<>|]+/g, '_').trim() + '_completed.pdf';
}
async function deliverPdf(blob, name){
  const file = new File([blob], name, { type:'application/pdf' });
  if(navigator.canShare && navigator.canShare({ files:[file] })){
    await navigator.share({ files:[file], title:name });
    return;
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportPdf(){
  if(document.activeElement) document.activeElement.blur();
  const button = document.getElementById('export');
  button.disabled = true; button.textContent = 'Exporting…';
  try{
    const bytes = appendPdf(sourcePdf, exportOps());
    await deliverPdf(new Blob([bytes], { type:'application/pdf' }), exportName());
    say('Completed PDF is ready.', 'ok');
  }catch(err){
    if(!(err && err.name === 'AbortError'))
      say('Could not export the PDF: ' + (err && err.message ? err.message : err), 'err');
  }finally{
    button.disabled = false; button.textContent = 'Export PDF';
  }
}

/* --------------------------------------------------------------------- times */
function toMinutes(s){
  const m = /^\s*(\d{1,2}):?(\d{2})\s*$/.exec(s || '');
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
}
/* Blk from the block times, Flt from the wheels, until the cell is written in. */
function refreshDerived(){
  doc.pages.forEach((p,pi)=> p.legs.forEach((leg,r)=>{
    [['blk','atd','ata'], ['flt','tkof','tdwn']].forEach(([k,a,b])=>{
      const path = `pages.${pi}.legs.${r}.${k}`;
      const inp = derived.get(path);
      if(!inp || doc.manual[path]) return;
      const v = span(leg[a], leg[b]);
      leg[k] = v;
      if(inp.value !== v){ inp.value = v; fitOne(inp); }
    });
  }));
}

/* --------------------------------------------------------------------- input */
stage.addEventListener('input', e=>{
  const t = e.target;
  if(t.tagName !== 'INPUT') return;
  if(t.dataset.upper){
    const at = t.selectionStart, up = t.value.toUpperCase();
    if(up !== t.value){ t.value = up; try{ t.setSelectionRange(at, at); }catch(err){} }
  }
  const path = t.dataset.path;
  set(path, t.value);
  if(derived.has(path)){
    if(t.value) doc.manual[path] = 1; else delete doc.manual[path];
  }
  fitOne(t);
  refreshDerived();
  save();
});

stage.addEventListener('change', e=>{
  const t = e.target;
  if(t.tagName !== 'INPUT' || !t.dataset.time) return;
  const m = /^\s*(\d{3,4})\s*$/.exec(t.value);
  if(m){
    const raw = m[1].padStart(4,'0');
    const v = raw.slice(0,2) + ':' + raw.slice(2);
    if(toMinutes(v) != null){
      t.value = v; set(t.dataset.path, v); refreshDerived(); save();
    }
  }
});

/* Carry the captain's duty figure down its column. */
stage.addEventListener('click', e=>{
  const b = e.target.closest('button.dup');
  if(!b) return;
  const pi = +b.dataset.page, key = b.dataset.key, from = +b.dataset.from;
  const crew = doc.pages[pi].crew;
  const v = crew[from][key] || '';
  crew.forEach((m,r)=>{
    if(r === from) return;
    m[key] = v;
    const inp = stage.querySelector(`input[data-path="pages.${pi}.crew.${r}.${key}"]`);
    if(inp){ inp.value = v; fitOne(inp); }
  });
  save();
});

stage.addEventListener('keydown', e=>{
  if(e.key !== 'Enter') return;
  const t = e.target;
  if(t.tagName !== 'INPUT') return;
  e.preventDefault();
  const i = inputs.indexOf(t);
  if(i < 0) return;
  const next = inputs[i + (e.shiftKey ? -1 : 1)];
  if(next){ next.focus(); next.select(); }
});

/* ---------------------------------------------------------------------- zoom
   Pinch the sheets, the way any document is handled. The page itself is held
   at one scale — were the browser to zoom it, a tapped box would jump under
   the finger and the toolbar would sail off — so the gesture is caught here
   and turned into the sheet's own scale.                                     */
const ZOOM_MIN = 0.3, ZOOM_MAX = 4;
let zoom = null;                                   // null = fitted to the window
try{ const z = localStorage.getItem(KEY + '.zoom'); if(z && z !== 'fit') zoom = +z; }catch(e){}

function sheetPx(){ return PAGE_W * 4/3; }         // 1pt = 4/3 css px
/* clientWidth counts the padding, and on a notched screen that padding is the
   safe area — so take it back off before fitting a sheet into what is left. */
function availWidth(){
  const cs = getComputedStyle(stage);
  return Math.max(320, stage.clientWidth
    - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
}
const fitK = ()=> availWidth() / sheetPx();
const scale = ()=> zoom == null ? fitK() : zoom;
const clampK = k => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

function applyZoom(){
  const k = scale();
  document.querySelectorAll('.sheet').forEach(s=> s.style.transform = 'scale(' + k + ')');
  document.querySelectorAll('.wrap').forEach(w=>{
    w.style.width  = (sheetPx() * k) + 'px';
    w.style.height = (PAGE_H * 4/3 * k) + 'px';
  });
}
let zoomSaveTimer = null;
function setZoom(z, anchor){
  const before = scale();
  zoom = z;
  applyZoom();
  if(anchor){
    // hold the point under the fingers still while the scale changes around it
    const k = scale() / before;
    stage.scrollLeft = (stage.scrollLeft + anchor.x) * k - anchor.x;
    stage.scrollTop  = (stage.scrollTop  + anchor.y) * k - anchor.y;
  }
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(()=>{
    try{ localStorage.setItem(KEY + '.zoom', zoom == null ? 'fit' : String(zoom)); }catch(e){}
  }, 250);
}
addEventListener('resize', ()=>{ if(zoom == null) applyZoom(); });

/* ---- the gesture ---- */
const gap = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const anchorOf = t => {
  const r = stage.getBoundingClientRect();
  return { x:(t[0].clientX + t[1].clientX)/2 - r.left,
           y:(t[0].clientY + t[1].clientY)/2 - r.top };
};
let pinch = null;
stage.addEventListener('touchstart', e=>{
  if(e.touches.length !== 2){ pinch = null; return; }
  const t = [e.touches[0], e.touches[1]];
  pinch = { d:gap(t) || 1, k:scale() };
}, {passive:true});
stage.addEventListener('touchmove', e=>{
  if(!pinch || e.touches.length !== 2) return;
  e.preventDefault();                      // ours to handle, not the scroller's
  const t = [e.touches[0], e.touches[1]];
  setZoom(clampK(pinch.k * gap(t) / pinch.d), anchorOf(t));
}, {passive:false});
['touchend','touchcancel'].forEach(ev =>
  stage.addEventListener(ev, ()=>{ pinch = null; }, {passive:true}));

/* A trackpad pinch arrives as a wheel with ctrl held; so does ⌘+scroll. */
stage.addEventListener('wheel', e=>{
  if(!e.ctrlKey) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  setZoom(clampK(scale() * (1 - e.deltaY / 300)),
          { x:e.clientX - r.left, y:e.clientY - r.top });
}, {passive:false});

/* Two taps on the paper put it back to the width of the window — the way back
   from a pinch, without a button standing in the header for it. */
let lastTap = 0;
stage.addEventListener('touchend', e=>{
  if(e.touches.length || e.changedTouches.length !== 1) return;
  if(e.target.closest('input,button')) return;
  const now = Date.now();
  if(now - lastTap < 320){ setZoom(null); lastTap = 0; } else lastTap = now;
}, {passive:true});
stage.addEventListener('dblclick', e=>{
  if(e.target.closest('input,button')) return;
  setZoom(null);
});

/* --------------------------------------------------------------------- chrome */
/* The surround follows whatever the OFP companion is set to — one switch for
   both pages, and it lives over there. */
function applyTheme(){
  let t = null;
  try{ t = localStorage.getItem('etofill:theme'); }catch(e){}
  if(!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]');
  if(m) m.content = t === 'light' ? '#ffffff' : '#1c1f24';
}
applyTheme();
addEventListener('storage', e=>{ if(e.key === 'etofill:theme') applyTheme(); });
// No explicit choice saved yet keeps following the device's own theme live,
// the same way the companion does — flipping the system switch flips this
// page too, whether or not the companion happens to be the one open right now.
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  let saved = null;
  try{ saved = localStorage.getItem('etofill:theme'); }catch(e){}
  if(!saved) applyTheme();
});

/* The companion's header travels with its page, so it is only under this button
   while that page is at the top. Crossing back asks for the top, or the return
   would land wherever the page was last left and the button would be elsewhere. */
document.getElementById('ofp').onclick = ()=>{ location.href = './index.html#top'; };

document.getElementById('export').onclick = exportPdf;

document.getElementById('reset').onclick = ()=>{
  if(!doc.source) return;
  if(!confirm('Clear everything entered and return to the document as issued?')) return;
  doc.pages = clone(doc.source);
  doc.manual = {};
  render();
  save();
};

/* ---------------------------------------------------------- loading the PDF */
const msg = document.getElementById('msg');
const fileInput = document.getElementById('file');
const dropZone = document.getElementById('drop');
function say(text, kind){
  msg.textContent = text || '';
  msg.className = 'msg' + (text ? ' show ' + (kind || '') : '');
}

async function loadPdf(file){
  if(!file) return;
  document.getElementById('fname').textContent = file.name || '';
  say('Reading ' + (file.name || 'the PDF') + '…');
  if(typeof DecompressionStream === 'undefined'){
    say('Browser too old: no DecompressionStream. Safari 16.4+ / iPadOS 16.4+ required.', 'err');
    return;
  }
  // Refused before anything is allocated for it, with a message that says what
  // happened rather than a parse error out of the reader.
  if(file.size > PDF_LIMITS.bytes){
    say(`That file is ${(file.size / 1048576).toFixed(0)} MB. This app reads Journey Logs `
      + `up to ${PDF_LIMITS.bytes / 1048576} MB.`, 'err');
    return;
  }
  try{
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseJourneyLog(bytes);
    doc = emptyDoc();
    doc.source = parsed.pages;
    doc.pages = clone(parsed.pages);
    sourceToken++;
    sourcePdf = parsed.pdf;
    putSource(bytes).catch(()=>{});
    render();
    save();
    say('', '');
    scrollTo(0, 0);
  }catch(err){
    say('Could not read it: ' + (err && err.message ? err.message : err), 'err');
  }
}

/* Taking the log away is the way back to the load screen, so it is the one
   button that stands in for "load another". */
document.getElementById('remove').onclick = ()=>{
  if(!confirm('Remove the Journey Log?\n\nThe loaded document and everything entered on it will be discarded.')) return;
  doc = emptyDoc();
  sourceToken++;
  sourcePdf = null;
  dropSource();
  try{ localStorage.removeItem(KEY); }catch(e){}
  document.getElementById('fname').textContent = '';
  render();
  say('', '');
};

dropZone.onclick = ()=> fileInput.click();
fileInput.onchange = ()=>{ loadPdf(fileInput.files[0]); fileInput.value = ''; };

['dragenter','dragover'].forEach(t => addEventListener(t, e=>{
  e.preventDefault(); dropZone.classList.add('over');
}));
['dragleave','drop'].forEach(t => addEventListener(t, e=>{
  e.preventDefault(); if(t === 'dragleave' && e.relatedTarget) return;
  dropZone.classList.remove('over');
}));
addEventListener('drop', e=>{
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) loadPdf(f);
});

render();
restoreSource();

if('serviceWorker' in navigator){
  addEventListener('load', ()=> navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
