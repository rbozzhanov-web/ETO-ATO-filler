'use strict';
/* ==================================================================== reader
   Enough of a PDF to find the text and where it sits. Taken as it stands from
   the OFP companion, which has read Air Astana's PDFs for a while now: a
   classic cross-reference table, FlateDecode streams, and an object lexer.  */
/* ---------- bytes <-> latin1 string (1:1, index == byte offset) ---------- */
function toStr(u8){
  let s = '', C = 0x8000;
  for (let i = 0; i < u8.length; i += C)
    s += String.fromCharCode.apply(null, u8.subarray(i, i + C));
  return s;
}

/* ---------- export geometry ----------
   Where one filled box's text lands on the page, in PDF points. Kept here, away
   from the DOM, because it is the one piece of the export that has to hold
   whatever the crew has done to the view: the sheet is displayed under a CSS
   transform, so every measured rectangle carries the current pinch-zoom, and
   every ratio taken between two of them cancels it out again. The computed font
   size does not — a transform does not change it — so it is converted straight
   from layout px to points and never divided by a ratio. Anything else and the
   exported PDF comes out sized by how far the crew happened to be zoomed in. */
const PX_TO_PT = 0.75;            // 1 css px = 3/4 pt — a layout constant, never scaled

function exportPlacement(o){
  const ratio = o.sheetRect.width / o.pageW;      // css px per point, zoom and all
  const x0 = (o.rect.left - o.sheetRect.left) / ratio;
  const top = (o.rect.top - o.sheetRect.top) / ratio;
  const width = o.rect.width / ratio, height = o.rect.height / ratio;
  const size = o.fontPx * PX_TO_PT;
  // Boxes are centred by default. The compact Helvetica estimate only chooses
  // the starting point; the PDF itself keeps the issued form intact.
  const textWidth = o.length * size * 0.54;
  const x = o.alignLeft ? x0 + 2 : x0 + Math.max(1, (width - textWidth) / 2);
  const y = o.pageH - top - height / 2 - size * 0.34;
  return { x, y, size };
}

/* ---------- resource limits ----------
   The same bounds the OFP companion's engine keeps: a Journey Log is opened on
   a tablet, and a corrupt or crafted file has to fail with a message rather
   than take the browser down. Nothing a real form contains comes near these. */
const PDF_LIMITS = {
  bytes:       64 * 1024 * 1024,   // whole input file
  pages:       2000,               // pages walked out of the page tree
  rawStream:   64 * 1024 * 1024,   // one stream as stored
  stream:     128 * 1024 * 1024,   // one stream once decompressed
  content:    128 * 1024 * 1024    // all content streams of one page together
};
const pdfTooBig = what => { throw new Error(what + ' exceeds this app\u2019s limit for one document'); };

/* ---------- object parsing ---------- */
const WS = ' \t\r\n\f\0', DELIM = '()<>[]{}/%';
const isWS = c => WS.indexOf(c) >= 0;
const isDelim = c => DELIM.indexOf(c) >= 0;

class Lexer {
  constructor(s, i = 0){ this.s = s; this.i = i; }
  skip(){
    const s = this.s;
    for (;;){
      while (this.i < s.length && isWS(s[this.i])) this.i++;
      if (s[this.i] === '%'){ while (this.i < s.length && s[this.i] !== '\n' && s[this.i] !== '\r') this.i++; }
      else return;
    }
  }
  // reads one object; "N G R" references collapse into {ref:N, gen:G}
  obj(){
    this.skip();
    const s = this.s, c = s[this.i];
    if (c === undefined) return null;
    if (c === '<' && s[this.i + 1] === '<') return this.dict();
    if (c === '<') return this.hexStr();
    if (c === '(') return this.str();
    if (c === '[') return this.arr();
    if (c === '/') return this.name();
    if (c === ']' || c === '>'){ this.i++; return undefined; }
    return this.token();
  }
  name(){
    const s = this.s; this.i++; let r = '';
    while (this.i < s.length && !isWS(s[this.i]) && !isDelim(s[this.i])){
      let ch = s[this.i++];
      if (ch === '#'){ ch = String.fromCharCode(parseInt(s.substr(this.i, 2), 16)); this.i += 2; }
      r += ch;
    }
    return { name: r };
  }
  dict(){
    this.i += 2; const d = {};
    for (;;){
      this.skip();
      if (this.s[this.i] === undefined) break;
      if (this.s[this.i] === '>' && this.s[this.i + 1] === '>'){ this.i += 2; break; }
      if (this.s[this.i] !== '/'){ this.i++; continue; }
      const k = this.name().name;
      d[k] = this.obj();
    }
    return d;
  }
  arr(){
    this.i++; const a = [];
    for (;;){
      this.skip();
      if (this.s[this.i] === undefined) break;
      if (this.s[this.i] === ']'){ this.i++; break; }
      const v = this.obj();
      if (v === undefined) break;
      a.push(v);
    }
    return a;
  }
  str(){
    const s = this.s; this.i++; let depth = 1, r = '';
    while (this.i < s.length){
      let ch = s[this.i++];
      if (ch === '\\'){
        const n = s[this.i++];
        if (n === 'n') r += '\n'; else if (n === 'r') r += '\r';
        else if (n === 't') r += '\t'; else if (n === 'b') r += '\b';
        else if (n === 'f') r += '\f';
        else if (n >= '0' && n <= '7'){
          let o = n;
          for (let k = 0; k < 2 && s[this.i] >= '0' && s[this.i] <= '7'; k++) o += s[this.i++];
          r += String.fromCharCode(parseInt(o, 8));
        }
        else if (n === '\n') { /* line continuation */ }
        else if (n === '\r'){ if (s[this.i] === '\n') this.i++; }
        else r += n;
      }
      else if (ch === '('){ depth++; r += ch; }
      else if (ch === ')'){ if (--depth === 0) break; r += ch; }
      else r += ch;
    }
    return { text: r };
  }
  hexStr(){
    const s = this.s; this.i++; let h = '';
    while (this.i < s.length && s[this.i] !== '>') h += s[this.i++];
    this.i++;
    h = h.replace(/[^0-9a-fA-F]/g, '');
    if (h.length & 1) h += '0';
    let r = '';
    for (let k = 0; k < h.length; k += 2) r += String.fromCharCode(parseInt(h.substr(k, 2), 16));
    return { text: r };
  }
  token(){
    const s = this.s; let t = '';
    while (this.i < s.length && !isWS(s[this.i]) && !isDelim(s[this.i])) t += s[this.i++];
    if (/^[-+.\d]/.test(t)){
      const save = this.i, m = /^\d+$/.test(t);
      if (m){                                   // may be an "N G R" reference
        this.skip();
        const j = this.i; let g = '';
        while (this.i < s.length && /\d/.test(s[this.i])) g += s[this.i++];
        if (g){
          this.skip();
          if (s[this.i] === 'R' && (isWS(s[this.i + 1]) || isDelim(s[this.i + 1]) || s[this.i + 1] === undefined)){
            this.i++; return { ref: parseInt(t, 10), gen: parseInt(g, 10) };
          }
        }
        this.i = save;
      }
      return parseFloat(t);
    }
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    return { op: t || s[this.i++] };
  }
}

/* ---------- document ---------- */
class Doc {
  constructor(u8){
    if (u8.length > PDF_LIMITS.bytes) pdfTooBig('This PDF');
    this.bytes = u8;
    this.s = toStr(u8);
    this.xref = new Map();
    this.trailer = {};
    this.readXref();
  }
  readXref(){
    const m = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(this.s.slice(-2048))
           || /startxref\s+(\d+)/g.exec(this.s.slice(this.s.lastIndexOf('startxref')));
    if (!m) throw new Error('startxref not found');
    let off = parseInt(m[1], 10);
    const seen = new Set();
    while (off !== undefined && !seen.has(off)){
      seen.add(off);
      const lx = new Lexer(this.s, off);
      lx.skip();
      if (this.s.substr(lx.i, 4) !== 'xref')
        throw new Error('only a classic xref table is supported');
      lx.i += 4;
      for (;;){
        lx.skip();
        if (this.s.substr(lx.i, 7) === 'trailer'){ lx.i += 7; break; }
        const start = lx.obj(), count = lx.obj();
        if (typeof start !== 'number' || typeof count !== 'number') break;
        lx.skip();
        for (let k = 0; k < count; k++){
          const e = this.s.substr(lx.i, 20);
          const em = /^(\d{10})\s(\d{5})\s([nf])/.exec(e);
          if (em){
            const num = start + k;
            // Offset and generation both: an object rewritten by the export has
            // to go back out under the generation the document issued it with.
            if (em[3] === 'n' && !this.xref.has(num))
              this.xref.set(num, { off: parseInt(em[1], 10), gen: parseInt(em[2], 10) });
            lx.i += (e[18] === '\r' || e[18] === '\n' || e[18] === ' ') ? 20 : 19;
          } else { lx.i += 20; }
        }
      }
      const tr = new Lexer(this.s, lx.i).obj();
      for (const k in tr) if (!(k in this.trailer)) this.trailer[k] = tr[k];
      off = typeof tr.Prev === 'number' ? tr.Prev : undefined;
    }
  }
  get(o){                                        // dereference
    if (o && typeof o === 'object' && 'ref' in o){
      const e = this.xref.get(o.ref);
      if (e === undefined) return null;
      const lx = new Lexer(this.s, e.off);
      lx.obj(); lx.obj();                        // "N G"
      lx.skip();
      if (this.s.substr(lx.i, 3) === 'obj') lx.i += 3;
      const v = lx.obj();
      lx.skip();
      if (this.s.substr(lx.i, 6) === 'stream'){
        let p = lx.i + 6;
        if (this.s[p] === '\r') p++;
        if (this.s[p] === '\n') p++;
        const len = this.get(v.Length);
        return { dict: v, start: p, length: typeof len === 'number' ? len : 0 };
      }
      return v;
    }
    return o;
  }
  offsetOf(num){ const e = this.xref.get(num); return e === undefined ? undefined : e.off; }
  // The generation an object was issued with; 0 for one this app is adding.
  genOf(num){ const e = this.xref.get(num); return e === undefined ? 0 : e.gen; }
  async stream(obj){                             // decoded stream data
    if (obj.length > PDF_LIMITS.rawStream) pdfTooBig('A stream in this PDF');
    const raw = this.bytes.subarray(obj.start, obj.start + obj.length);
    const f = this.get(obj.dict.Filter);
    const names = (Array.isArray(f) ? f : f ? [f] : []).map(x => x && x.name);
    if (!names.length) return raw;
    if (names.length > 1 || (names[0] !== 'FlateDecode' && names[0] !== 'Fl'))
      throw new Error('unsupported stream filter: ' + names.join(','));
    // Read it in chunks: a stream that inflates without bound has to be stopped
    // while it inflates, not measured once it has already been allocated.
    const rd = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = [];
    let total = 0;
    for (;;){
      const { done, value } = await rd.read();
      if (done) break;
      total += value.length;
      if (total > PDF_LIMITS.stream){
        await rd.cancel().catch(() => {});
        pdfTooBig('A stream in this PDF');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks){ out.set(c, at); at += c.length; }
    return out;
  }
  async content(page){                           // /Contents: a ref or an array of refs
    const c = this.get(page.dict.Contents);
    const list = Array.isArray(c) ? c.map(r => this.get(r)) : [c];
    let s = '';
    for (const o of list){
      if (!o || !o.dict) continue;
      s += toStr(await this.stream(o)) + '\n';
      if (s.length > PDF_LIMITS.content) pdfTooBig('The content of one page of this PDF');
    }
    return s;
  }
  pages(){
    if (this._pages) return this._pages;
    const root = this.get(this.trailer.Root);
    const out = [];
    // A /Kids that points back up its own tree would otherwise recurse until the
    // stack gives out; every node is walked once and no more.
    const seen = new Set();
    const walk = (nodeRef, inherited) => {
      if (nodeRef && typeof nodeRef === 'object' && 'ref' in nodeRef){
        if (seen.has(nodeRef.ref)) return;
        seen.add(nodeRef.ref);
      }
      const n = this.get(nodeRef);
      if (!n) return;
      const inh = {
        Resources: n.Resources !== undefined ? n.Resources : inherited.Resources,
        MediaBox:  n.MediaBox  !== undefined ? n.MediaBox  : inherited.MediaBox
      };
      if (n.Type && n.Type.name === 'Page'){
        if (out.length >= PDF_LIMITS.pages) pdfTooBig('The page count of this PDF');
        out.push({ ref: nodeRef.ref, gen: this.genOf(nodeRef.ref), dict: n,
                   Resources: this.get(inh.Resources), ResourcesRef: inh.Resources,
                   MediaBox: this.get(inh.MediaBox) });
        return;
      }
      const kids = this.get(n.Kids) || [];
      for (const k of kids) walk(k, inh);
    };
    walk(root && root.Pages, {});
    this._pages = out;
    return out;
  }
}

/* --------------------------------------------------------------- PDF writer
   The export keeps the issued Journey Log intact and appends only the values
   entered in this app. An incremental update is small, preserves every page of
   the original file and gives the crew a real PDF rather than a print dialog. */
const toBytes = s => {
  const out = new Uint8Array(s.length);
  for(let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
};
const pdfNumber = n => (Math.round(n * 1000) / 1000).toString();
const pdfLatin = value => {
  const swaps = { '–':'-', '—':'-', '‘':"'", '’':"'", '“':'\"', '”':'\"', '…':'...' };
  let out = '';
  for(const ch of String(value).replace(/[–—‘’“”…]/g, c => swaps[c])){
    const n = ch.codePointAt(0);
    out += n >= 32 && n <= 255 ? String.fromCharCode(n) : '?';
  }
  return out.replace(/([\\()])/g, '\\$1');
};
class PdfOps {
  constructor(){ this.parts = ['q\n']; }
  text(font, size, x, y, value, color){
    this.parts.push(`${color[0]} ${color[1]} ${color[2]} rg\nBT /${font} ${pdfNumber(size)} Tf `
      + `${pdfNumber(x)} ${pdfNumber(y)} Td (${pdfLatin(value)}) Tj ET\n`);
    return this;
  }
  done(){ return this.parts.join('') + 'Q\n'; }
}
function addPdfFont(raw, name, number){
  const at = raw.indexOf('/Font');
  if(at < 0) throw new Error('the Journey Log page has no font resources');
  let p = at + 5;
  while(p < raw.length && isWS(raw[p])) p++;
  if(raw[p] !== '<' || raw[p + 1] !== '<')
    throw new Error('this Journey Log uses unsupported font resources');
  let depth = 0, end = p;
  for(; end < raw.length; end++){
    if(raw[end] === '<' && raw[end + 1] === '<'){ depth++; end++; }
    else if(raw[end] === '>' && raw[end + 1] === '>'){ if(--depth === 0) break; end++; }
  }
  if(depth !== 0) throw new Error('could not update the Journey Log font resources');
  return raw.slice(0, end) + `/${name} ${number} 0 R` + raw.slice(end);
}
function appendPdf(doc, perPage){
  const pages = doc.pages();
  let size = doc.get(doc.trailer.Size);
  if(typeof size !== 'number') size = Math.max(...doc.xref.keys()) + 1;
  let next = size, cursor = doc.s.length;
  // objNum -> { off, gen }: a rewritten object keeps the generation the document
  // issued it with, a new one starts at 0.
  const parts = [], changed = new Map();
  const put = (num, gen) => changed.set(num, { off: cursor, gen });
  if(!/[\r\n]$/.test(doc.s)){ parts.push('\n'); cursor++; }
  const emit = s => { parts.push(s); cursor += s.length; };

  const fontNumber = next++;
  put(fontNumber, 0);
  emit(`${fontNumber} 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>\nendobj\n`);

  const patchedResources = new Set();
  const addFontToResources = page => {
    const ref = (page.dict.Resources && page.dict.Resources.ref && page.dict.Resources)
             || (page.ResourcesRef && page.ResourcesRef.ref && page.ResourcesRef);
    if(!ref) return false;                       // a direct resource dictionary lives in the page object
    if(patchedResources.has(ref.ref)) return true;
    const offset = doc.offsetOf(ref.ref), lx = new Lexer(doc.s, offset);
    lx.obj(); lx.obj(); lx.skip();
    if(doc.s.substr(lx.i, 3) === 'obj') lx.i += 3;
    const start = lx.i; lx.obj();
    const raw = doc.s.slice(start, lx.i);
    const patched = addPdfFont(raw, 'JL', fontNumber);
    const gen = doc.genOf(ref.ref);
    put(ref.ref, gen);
    emit(`${ref.ref} ${gen} obj\n${patched}\nendobj\n`);
    patchedResources.add(ref.ref);
    return true;
  };

  for(const [pi, ops] of perPage){
    const page = pages[pi];
    if(!page || !ops) continue;
    const contentNumber = next++;
    const content = ops.done();
    put(contentNumber, 0);
    emit(`${contentNumber} 0 obj\n<</Length ${content.length}>>\nstream\n${content}endstream\nendobj\n`);

    const offset = doc.offsetOf(page.ref);
    const lx = new Lexer(doc.s, offset);
    lx.obj(); lx.obj(); lx.skip();
    if(doc.s.substr(lx.i, 3) === 'obj') lx.i += 3;
    const start = lx.i; lx.obj();
    const raw = doc.s.slice(start, lx.i);
    const current = page.dict.Contents;
    let patched = Array.isArray(current)
      ? raw.replace(/\/Contents\s*\[([\s\S]*?)\]/, (m, inner) => `/Contents[${inner} ${contentNumber} 0 R]`)
      : raw.replace(/\/Contents\s+(\d+)\s+(\d+)\s+R/, (m, n, g) => `/Contents[${n} ${g} R ${contentNumber} 0 R]`);
    if(patched === raw) throw new Error(`could not add export data to page ${pi + 1}`);
    if(!addFontToResources(page) && !new RegExp('/JL\\s').test(patched))
      patched = addPdfFont(patched, 'JL', fontNumber);
    put(page.ref, page.gen);
    emit(`${page.ref} ${page.gen} obj\n${patched}\nendobj\n`);
  }

  const numbers = [...changed.keys()].sort((a,b) => a - b), runs = [];
  for(const n of numbers){
    const last = runs[runs.length - 1];
    if(last && n === last.start + last.items.length) last.items.push(n);
    else runs.push({ start:n, items:[n] });
  }
  const xref = cursor;
  let tail = 'xref\n';
  for(const run of runs){
    tail += `${run.start} ${run.items.length}\n`;
    for(const n of run.items){
      const e = changed.get(n);
      tail += String(e.off).padStart(10, '0') + ' ' + String(e.gen).padStart(5, '0') + ' n \n';
    }
  }
  const tr = doc.trailer;
  const id = Array.isArray(tr.ID)
    ? '/ID[' + tr.ID.map(v => '<' + [...v.text].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase() + '>').join('') + ']'
    : '';
  const previous = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(doc.s.slice(-2048));
  // The trailer's own references go back out with the generation they were read
  // with, not a flat zero.
  const asRef = r => r.ref + ' ' + (r.gen || 0) + ' R';
  tail += 'trailer\n<</Size ' + next + '/Root ' + asRef(tr.Root)
       + (tr.Info && tr.Info.ref ? '/Info ' + asRef(tr.Info) : '') + id
       + (previous ? '/Prev ' + previous[1] : '') + '>>\nstartxref\n' + xref + '\n%%EOF\n';
  emit(tail);
  const extra = toBytes(parts.join('')), out = new Uint8Array(doc.bytes.length + extra.length);
  out.set(doc.bytes); out.set(extra, doc.bytes.length);
  return out;
}

// In the browser this file is a classic script and these are simply globals.
// Under Node — the test runner — it is a CommonJS module, and this is its export.
if (typeof module !== 'undefined' && module.exports)
  module.exports = { toStr, toBytes, Lexer, Doc, PdfOps, addPdfFont, appendPdf,
                     PDF_LIMITS, PX_TO_PT, exportPlacement };
