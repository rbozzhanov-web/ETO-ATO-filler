'use strict';
/* A PDF small enough to read in one screen and real enough for the engines under
   test: a classic cross-reference table, one page, one Courier font, one content
   stream. Nothing here is a captured file — the fixtures are built from the
   parameters each test needs, so a test can ask for the awkward cases (a page
   issued under a non-zero generation, an array /Contents, a compressed stream)
   without carrying a binary into the repository. */
const zlib = require('node:zlib');

const latin1 = s => Buffer.from(s, 'latin1');

// obj: { num, gen, body } or { num, gen, dict, stream }
function buildPdf(opts = {}){
  const pageGen = opts.pageGen ?? 0;
  const rootGen = opts.rootGen ?? 0;
  const text = opts.text ?? 'BT /F1 10 Tf 100 700 Td (WPT01) Tj ET\n';
  const compress = opts.compress !== false;
  const contentsArray = !!opts.contentsArray;

  const raw = latin1(text);
  const streamBytes = compress ? zlib.deflateSync(raw) : raw;
  const streamFilter = compress ? '/Filter/FlateDecode' : '';

  const objects = [
    { num: 1, gen: rootGen, body: `<</Type/Catalog/Pages 2 0 R>>` },
    { num: 2, gen: 0, body: `<</Type/Pages/Kids[3 ${pageGen} R]/Count 1>>` },
    { num: 3, gen: pageGen, body:
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]`
        + `/Resources<</Font<</F1 5 0 R>>>>`
        + `/Contents ${contentsArray ? '[4 0 R]' : '4 0 R'}>>` },
    { num: 4, gen: 0,
      body: `<</Length ${streamBytes.length}${streamFilter}>>`,
      stream: streamBytes },
    { num: 5, gen: 0, body: `<</Type/Font/Subtype/Type1/BaseFont/Courier>>` }
  ];

  const parts = [latin1('%PDF-1.4\n')];
  let at = parts[0].length;
  const offsets = new Map();
  for (const o of objects){
    offsets.set(o.num, at);
    const head = latin1(`${o.num} ${o.gen} obj\n${o.body}\n`);
    parts.push(head); at += head.length;
    if (o.stream){
      const s = latin1('stream\n');
      parts.push(s); at += s.length;
      parts.push(o.stream); at += o.stream.length;
      const e = latin1('\nendstream\n');
      parts.push(e); at += e.length;
    }
    const tail = latin1('endobj\n');
    parts.push(tail); at += tail.length;
  }

  const xrefAt = at;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of objects)
    xref += String(offsets.get(o.num)).padStart(10, '0') + ' '
          + String(o.gen).padStart(5, '0') + ' n \n';
  xref += `trailer\n<</Size ${objects.length + 1}/Root 1 ${rootGen} R`
        + `/ID[<0102030405060708090A0B0C0D0E0F10><0102030405060708090A0B0C0D0E0F10>]>>\n`
        + `startxref\n${xrefAt}\n%%EOF\n`;
  parts.push(latin1(xref));

  return new Uint8Array(Buffer.concat(parts));
}

// Every "N G obj" header in a document, as [num, gen] pairs.
function objectHeaders(u8){
  const s = Buffer.from(u8).toString('latin1');
  return [...s.matchAll(/(?:^|[\r\n])(\d+) (\d+) obj/g)].map(m => [+m[1], +m[2]]);
}

// Every in-use entry of the LAST cross-reference section, as [offset, gen].
function lastXrefEntries(u8){
  const s = Buffer.from(u8).toString('latin1');
  const at = s.lastIndexOf('\nxref\n');
  const section = s.slice(at, s.indexOf('trailer', at));
  return [...section.matchAll(/(\d{10}) (\d{5}) n/g)].map(m => [+m[1], +m[2]]);
}

module.exports = { buildPdf, objectHeaders, lastXrefEntries };
