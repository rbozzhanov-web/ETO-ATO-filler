/* pdfmini — a minimal PDF engine: reads text with coordinates and appends
   an overlay onto pages via an incremental update. No dependencies.
   Targets unencrypted PDFs with a classic xref table and uncompressed
   objects (Air Astana OFP). */

const PDFMini = (() => {

  /* ---------- resource limits ----------
     A document is read on a tablet in flight, and the app must fail with a
     message rather than take the browser down with it. Every allocation this
     engine makes on the document's word — the file itself, the page tree, a
     decompressed stream, an image — is bounded here. The numbers sit an order
     of magnitude above the largest real OFP package (about 6 MB, 60 pages, a
     1800x1451 chart), so nothing legitimate meets them. */
  const LIMITS = {
    bytes:       64 * 1024 * 1024,   // whole input file
    pages:       2000,               // pages walked out of the page tree
    rawStream:   64 * 1024 * 1024,   // one stream as stored
    stream:     128 * 1024 * 1024,   // one stream once decompressed
    content:    128 * 1024 * 1024,   // all content streams of one page together
    imagePixels: 64 * 1000 * 1000    // width x height of one image
  };
  const tooBig = what => { throw new Error(what + ' exceeds this app\u2019s limit for one document'); };

  /* ---------- bytes <-> latin1 string (1:1, index == byte offset) ---------- */
  function toStr(u8){
    let s = '', C = 0x8000;
    for (let i = 0; i < u8.length; i += C)
      s += String.fromCharCode.apply(null, u8.subarray(i, i + C));
    return s;
  }
  function toBytes(s){
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return u;
  }

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
      if (u8.length > LIMITS.bytes) tooBig('This PDF');
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
              // Both halves of the entry are kept: an object rewritten by the
              // incremental update below has to go back out under the very
              // generation it was issued with, or the reader that follows the
              // reference will not accept it as the same object.
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
      if (obj.length > LIMITS.rawStream) tooBig('A stream in this PDF');
      const raw = this.bytes.subarray(obj.start, obj.start + obj.length);
      const f = this.get(obj.dict.Filter);
      const names = (Array.isArray(f) ? f : f ? [f] : []).map(x => x && x.name);
      if (!names.length) return raw;
      if (names.length > 1 || (names[0] !== 'FlateDecode' && names[0] !== 'Fl'))
        throw new Error('unsupported stream filter: ' + names.join(','));
      // Read the decompressed stream in chunks rather than in one go: a stream
      // that inflates without bound has to be stopped while it is inflating,
      // not measured once it has already been allocated.
      const rd = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
      const chunks = [];
      let total = 0;
      for (;;){
        const { done, value } = await rd.read();
        if (done) break;
        total += value.length;
        if (total > LIMITS.stream){
          await rd.cancel().catch(() => {});
          tooBig('A stream in this PDF');
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
        if (s.length > LIMITS.content) tooBig('The content of one page of this PDF');
      }
      return s;
    }
    pages(){
      if (this._pages) return this._pages;
      const root = this.get(this.trailer.Root);
      const out = [];
      // A /Kids that points back up its own tree would otherwise recurse until
      // the stack gives out; every node is walked once and no more.
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
          if (out.length >= LIMITS.pages) tooBig('The page count of this PDF');
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

  /* ---------- text extraction ---------- */
  function textItems(content){
    const lx = new Lexer(content, 0);
    const st = [];
    let size = 0, Tc = 0, Tz = 100, TL = 0;
    let Tm = [1,0,0,1,0,0], Tlm = [1,0,0,1,0,0];
    const out = [];
    const mul = (a, b) => [
      a[0]*b[0] + a[1]*b[2],       a[0]*b[1] + a[1]*b[3],
      a[2]*b[0] + a[3]*b[2],       a[2]*b[1] + a[3]*b[3],
      a[4]*b[0] + a[5]*b[2] + b[4], a[4]*b[1] + a[5]*b[3] + b[5]
    ];
    const nextLine = () => { Tlm = mul([1,0,0,1,0,-TL], Tlm); Tm = Tlm.slice(); };
    const show = t => {
      if (!t) return;
      const sc = Math.hypot(Tm[0], Tm[1]) || 1;
      const cw = size * 0.6 * (Tz / 100) + Tc;     // Courier: 600/1000 em
      out.push({ str: t, x: Tm[4], y: Tm[5], size: size * sc, cw });
      Tm = mul([1,0,0,1, t.length * cw, 0], Tm);
    };
    for (;;){
      const o = lx.obj();
      if (o === null) break;
      if (o === undefined) continue;
      if (typeof o === 'object' && 'op' in o){
        const op = o.op;
        if (op === 'BT'){ Tm = [1,0,0,1,0,0]; Tlm = Tm.slice(); st.length = 0; }
        else if (op === 'Tf'){ size = st[st.length - 1] || 0; }
        else if (op === 'TL'){ TL = st[st.length - 1] || 0; }
        else if (op === 'Tc'){ Tc = st[st.length - 1] || 0; }
        else if (op === 'Tz'){ Tz = st[st.length - 1] || 100; }
        else if (op === 'Td' || op === 'TD'){
          const y = st.pop() || 0, x = st.pop() || 0;
          if (op === 'TD') TL = -y;
          Tlm = mul([1,0,0,1,x,y], Tlm); Tm = Tlm.slice();
        }
        else if (op === 'Tm'){
          const v = st.slice(-6);
          if (v.length === 6){ Tlm = v.slice(); Tm = v.slice(); }
        }
        else if (op === 'T*') nextLine();
        else if (op === 'Tj') show((st[st.length - 1] || {}).text);
        else if (op === "'"){ nextLine(); show((st[st.length - 1] || {}).text); }
        else if (op === '"'){ nextLine(); show((st[st.length - 1] || {}).text); }
        else if (op === 'TJ'){
          const a = st[st.length - 1];
          if (Array.isArray(a)) for (const el of a){
            if (el && el.text !== undefined) show(el.text);
            else if (typeof el === 'number') Tm = mul([1,0,0,1, -el / 1000 * size * (Tz/100), 0], Tm);
          }
        }
        st.length = 0;
      } else st.push(o);
    }
    return out;
  }

  /* ---------- incremental write ---------- */
  const esc = t => String(t).replace(/([\\()])/g, '\\$1');

  // insert "/Name N 0 R" into the page /Font dictionary
  function addFont(raw, name, num){
    const k = raw.indexOf('/Font');
    if (k < 0) throw new Error('page /Resources has no /Font');
    let p = k + 5;
    while (p < raw.length && WS.indexOf(raw[p]) >= 0) p++;
    if (raw[p] !== '<' || raw[p + 1] !== '<')
      throw new Error('/Font given as a reference is not supported');
    let depth = 0, q = p;
    for (; q < raw.length; q++){
      if (raw[q] === '<' && raw[q + 1] === '<'){ depth++; q++; }
      else if (raw[q] === '>' && raw[q + 1] === '>'){ if (--depth === 0) break; q++; }
    }
    if (depth !== 0) throw new Error('could not parse /Font');
    return raw.slice(0, q) + `/${name} ${num} 0 R` + raw.slice(q);
  }

  function append(doc, perPage, opts){
    // perPage: Map(pageIndex -> content operator string)
    // opts.fonts: [{name, dict}] — added to /Resources of modified pages
    const pages = doc.pages();
    let size = doc.get(doc.trailer.Size);
    if (typeof size !== 'number') size = Math.max(...doc.xref.keys()) + 1;
    let next = size;
    const parts = [];
    // objNum -> { off, gen }: a rewritten object keeps the generation the
    // document issued it with, a new one starts at 0.
    const newXref = new Map();
    const put = (num, gen) => newXref.set(num, { off: cursor, gen });
    let base = doc.s.length;
    if (!/[\r\n]$/.test(doc.s)) { parts.push('\n'); base++; }

    let cursor = base;
    const emit = s => { parts.push(s); cursor += s.length; };

    const fonts = (opts && opts.fonts) || [];
    for (const f of fonts){
      f.num = next++;
      put(f.num, 0);
      emit(`${f.num} 0 obj\n${f.dict}\nendobj\n`);
    }

    for (const [pi, ops] of perPage){
      const pg = pages[pi];
      if (!pg || !ops) continue;

      const cnum = next++;
      put(cnum, 0);
      emit(`${cnum} 0 obj\n<</Length ${ops.length}>>\nstream\n${ops}\nendstream\nendobj\n`);

      // page: /Contents X 0 R  ->  /Contents[X 0 R cnum 0 R]
      const off = doc.offsetOf(pg.ref);
      const lx = new Lexer(doc.s, off);
      lx.obj(); lx.obj(); lx.skip();
      if (doc.s.substr(lx.i, 3) === 'obj') lx.i += 3;
      const dstart = lx.i;
      lx.obj();
      let raw = doc.s.slice(dstart, lx.i);
      const cur = pg.dict.Contents;
      let patched;
      if (Array.isArray(cur))
        patched = raw.replace(/\/Contents\s*\[([\s\S]*?)\]/, (m, inner) => `/Contents[${inner} ${cnum} 0 R]`);
      else
        patched = raw.replace(/\/Contents\s+(\d+)\s+(\d+)\s+R/, (m, n, g) => `/Contents[${n} ${g} R ${cnum} 0 R]`);
      if (patched === raw) throw new Error('could not update /Contents of page ' + (pi + 1));
      for (const f of fonts)
        if (!new RegExp('/' + f.name + '[\\s/]').test(patched)) patched = addFont(patched, f.name, f.num);

      put(pg.ref, pg.gen);
      emit(`${pg.ref} ${pg.gen} obj\n${patched}\nendobj\n`);
    }

    // xref table
    const nums = [...newXref.keys()].sort((a, b) => a - b);
    const runs = [];
    for (const n of nums){
      const last = runs[runs.length - 1];
      if (last && n === last.start + last.list.length) last.list.push(n);
      else runs.push({ start: n, list: [n] });
    }
    const xrefPos = cursor;
    let x = 'xref\n';
    for (const r of runs){
      x += `${r.start} ${r.list.length}\n`;
      for (const n of r.list){
        const e = newXref.get(n);
        x += String(e.off).padStart(10, '0') + ' ' + String(e.gen).padStart(5, '0') + ' n \n';
      }
    }
    const tr = doc.trailer;
    const idStr = Array.isArray(tr.ID)
      ? '/ID[' + tr.ID.map(v => '<' + [...v.text].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase() + '>').join('') + ']'
      : '';
    const prev = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(doc.s.slice(-2048));
    // The trailer's own references go back out with the generation they were
    // read with, not a flat zero.
    const asRef = r => r.ref + ' ' + (r.gen || 0) + ' R';
    x += 'trailer\n<</Size ' + next
       + '/Root ' + asRef(tr.Root)
       + (tr.Info && tr.Info.ref ? '/Info ' + asRef(tr.Info) : '')
       + idStr
       + (prev ? '/Prev ' + prev[1] : '')
       + '>>\nstartxref\n' + xrefPos + '\n%%EOF\n';
    emit(x);

    const tail = toBytes(parts.join(''));
    const out = new Uint8Array(doc.bytes.length + tail.length);
    out.set(doc.bytes, 0);
    out.set(tail, doc.bytes.length);
    return out;
  }

  /* ---------- drawing operator builder ---------- */
  class Ops {
    constructor(){ this.b = ['q\n']; }
    rect(x, y, w, h, c){
      this.b.push(`${c[0]} ${c[1]} ${c[2]} rg\n${f(x)} ${f(y)} ${f(w)} ${f(h)} re f\n`);
      return this;
    }
    text(font, size, x, y, str, c){
      this.b.push(`${c[0]} ${c[1]} ${c[2]} rg\nBT /${font} ${f(size)} Tf ${f(x)} ${f(y)} Td (${esc(str)}) Tj ET\n`);
      return this;
    }
    done(){ return this.b.join('') + 'Q\n'; }
  }
  const f = n => (Math.round(n * 1000) / 1000).toString();

  return { Doc, Lexer, textItems, append, Ops, toStr, toBytes, LIMITS };
})();

// In the browser this file is a classic script and PDFMini is simply a global.
// Under Node — the test runner — it is a CommonJS module, and this is its export.
if (typeof module !== 'undefined' && module.exports) module.exports = PDFMini;
