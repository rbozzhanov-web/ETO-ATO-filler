'use strict';
/* Writes the launch images iPadOS shows while it starts the app from cold.

   A home-screen web app that iPadOS has unloaded — which in flight, with the
   EFB apps open, is often — is relaunched behind a launch screen. Without an
   apple-touch-startup-image of exactly the device's size that screen is plain
   white, a flash on a dark cockpit display before the app's own dark page is
   drawn. These are solid images in the app's dark background colour, one per
   iPad screen in each orientation; index.html links them.

   Run:  node scripts/make-splash.js     (writes splash/*.png, prints the links) */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BG = [0x0f, 0x14, 0x19];                   // #0f1419, the page's dark --bg

// iPad screens in CSS pixels, portrait, all at a device pixel ratio of 2.
const SCREENS = [
  [1032, 1376],   // iPad Pro 13" (M4), iPad Air 13"
  [1024, 1366],   // iPad Pro 12.9"
  [834, 1210],    // iPad Pro 11" (M4)
  [834, 1194],    // iPad Pro 11"
  [820, 1180],    // iPad Air 10.9" / 11", iPad 10th gen
  [834, 1112],    // iPad Air 10.5"
  [810, 1080],    // iPad 10.2"
  [768, 1024],    // iPad 9.7", iPad mini 5
  [744, 1133],    // iPad mini 6 / 7
];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function solidPng(w, h){
  const row = Buffer.alloc(1 + w * 3);           // filter byte 0, then RGB
  for (let x = 0; x < w; x++) row.set(BG, 1 + x * 3);
  const raw = Buffer.alloc(row.length * h);
  for (let y = 0; y < h; y++) row.copy(raw, y * row.length);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                      // 8-bit truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = path.join(__dirname, '..', 'splash');
fs.mkdirSync(out, { recursive: true });
const links = [];
for (const [cw, ch] of SCREENS){
  for (const orientation of ['portrait', 'landscape']){
    const [w, h] = orientation === 'portrait' ? [cw * 2, ch * 2] : [ch * 2, cw * 2];
    const name = `${w}x${h}.png`;
    fs.writeFileSync(path.join(out, name), solidPng(w, h));
    links.push(`<link rel="apple-touch-startup-image" href="splash/${name}" media="screen and `
      + `(device-width: ${cw}px) and (device-height: ${ch}px) and `
      + `(-webkit-device-pixel-ratio: 2) and (orientation: ${orientation})">`);
  }
}
console.log(links.join('\n'));
