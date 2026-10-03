'use strict';
/* A PDF of several pages, each with its own content stream, sharing one
   Courier font (F1) and one proportional font (F2). Like make-pdf.js nothing
   here is a captured file: the tests describe the pages they need. */
const L = s => Buffer.from(s, 'latin1');

function buildPages(contents){
  const n = contents.length;
  // 1 catalog, 2 pages, then per page: content, page; then the two fonts
  const F1 = 3 + 2 * n, F2 = F1 + 1, max = F2;
  const parts = [L('%PDF-1.4\n')];
  let at = parts[0].length;
  const off = {};
  const put = (num, body, stream) => {
    off[num] = at;
    const h = L(`${num} 0 obj\n${body}\n`); parts.push(h); at += h.length;
    if (stream){
      const a = L('stream\n'), e = L('\nendstream\n');
      parts.push(a, stream, e); at += a.length + stream.length + e.length;
    }
    const z = L('endobj\n'); parts.push(z); at += z.length;
  };
  const kids = [];
  contents.forEach((text, p) => {
    const c = L(text), num = 3 + 2 * p;
    put(num, `<</Length ${c.length}>>`, c);
    put(num + 1, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]`
      + `/Resources<</Font<</F1 ${F1} 0 R/F2 ${F2} 0 R>>>>/Contents ${num} 0 R>>`);
    kids.push(`${num + 1} 0 R`);
  });
  put(F1, '<</Type/Font/Subtype/Type1/BaseFont/Courier>>');
  put(F2, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>');
  put(1, '<</Type/Catalog/Pages 2 0 R>>');
  put(2, `<</Type/Pages/Kids[${kids.join(' ')}]/Count ${n}>>`);
  const xref = at;
  let x = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++) x += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  x += `trailer\n<</Size ${max + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(L(x));
  return new Uint8Array(Buffer.concat(parts));
}

/* A mandatory read the way Air Astana sets one: proportional type, a word per
   show operation (so a page holds the dozens of items a real one does), the
   "MAN nnn-yy / Issue / Revision" head and "page n of m" foot on every page,
   the MANDATORY READ title on the first only. Lines are given top to bottom;
   '' is a blank line, drawn as a lone space the way the real ones are. */
const esc = s => s.replace(/([\\()])/g, '\\$1');
function manPageContent(lines){
  let y = 760, t = '';
  for (const line of lines){
    const words = line === '' ? [' '] : line.split(' ');
    let x = 50;
    for (const w of words){
      t += `BT /F2 9.5 Tf 1 0 0 1 ${x} ${y} Tm (${esc(w)} ) Tj ET\n`;
      x += (w.length + 1) * 5;
    }
    y -= 13;
  }
  return t;
}

// A two-page mandatory read with each thing the reader has to cope with: the
// WinAnsi quotes, a symbol-font bullet, a line in a two-byte font, a passage
// pointing at a picture, a heading, a paragraph running over the page, and the
// two-column sign-off.
const PAGE1 = [
  'MAN 123-24', 'Issue 2', 'Revision 1', 'MANDATORY READ',
  'SUBJECT: ACARS LOGON PROCEDURE', 'APPLICABILITY: A320 FLEET', '',
  'Crews shall log on to ACARS before engine start at every station where',
  'the service is available to the operator.', '',
  'The logon is confirmed by the message \x93LOGON ACCEPTED\x94 on the MCDU.', '',
  '\x00x Check the flight number entered in the INIT page',
  '\x00x Check the departure and destination codes', '',
  'The status page should then look as shown at the picture below.', '',
  '\x00A\x00B\x00C\x00D',
  '', 'MAN 123-24 Issue 2 page 1 of 2'
];
const PAGE2 = [
  'MAN 123-24', 'Issue 2', 'Revision 1', '',
  'PROCEDURE', '',
  'If the logon fails twice, report it to the station and continue with voice',
  'clearance as the primary means.', '',
  'Issued By:', 'Flight Operations Director        Chief Pilot',
  '', 'MAN 123-24 Issue 2 page 2 of 2'
];

module.exports = { buildPages, manPageContent, PAGE1, PAGE2 };
