// Generates playground/fixtures/cjk-sample.pdf: a Chinese document whose font is
// a predefined CMap encoding (UniGB-UCS2-H) with no embedded glyph file. pdf.js
// has to fetch `cmaps/UniGB-UCS2-H.bcmap` before it can decode a single
// character, which makes this the fixture that proves where support assets are
// being loaded from.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// UCS-2 code points, written as a hexadecimal string because a Type0 font takes
// two-byte codes: 你好世界 and 阅读器.
const lines = [
  { y: 700, codes: '4F60 597D 4E16 754C' },
  { y: 630, codes: '9605 8BFB 5668' },
];

const objects = new Array(8).fill(null);
objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
objects[3] =
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
  '/Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>';
objects[4] =
  '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light-UniGB-UCS2-H ' +
  '/Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>';
objects[5] =
  '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light ' +
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> ' +
  '/DW 1000 /W [ 20000 29000 1000 ] >>';

const content = lines
  .map(({ y, codes }) => `BT /F1 40 Tf 72 ${y} Td <${codes.replace(/ /g, '')}> Tj ET`)
  .join('\n');
objects[6] = { stream: content };

let pdf = '%PDF-1.4\n';
const offsets = new Array(objects.length).fill(0);
for (let num = 1; num < objects.length; num++) {
  const obj = objects[num];
  if (!obj) continue;
  offsets[num] = pdf.length;
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
  } else {
    pdf += `${num} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
  }
}

const size = objects.length;
const xrefStart = pdf.length;
pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
for (let num = 1; num < size; num++) {
  pdf += offsets[num]
    ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
    : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, 'playground', 'fixtures', 'cjk-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);
