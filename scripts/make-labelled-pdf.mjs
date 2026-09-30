// Generates playground/fixtures/labelled-sample.pdf: ten pages whose *labels* are not their numbers.
//
// Three ranges, the shape a real front-matter document has:
//
//   pages 1–3   lowercase roman  i, ii, iii
//   pages 4–8   decimal, restarting at 1   1, 2, 3, 4, 5
//   pages 9–10  decimal with a prefix, restarting at 1   A-1, A-2
//
// The point of the third range is the prefix: pdf.js composes `/P` onto each label in the range rather
// than treating it as decoration, and a jump-by-label that only knows `/S` and `/St` gets those two pages
// wrong. Nothing else in `playground/fixtures/` carries a `/PageLabels` dictionary at all, which is why
// `FR-12`'s label clause was untestable before this file existed.
//
// Every page paints the label it expects, so a browser pass reads the mismatch rather than trusting a
// test. The structural checks below refuse to write a file whose ranges do not cover all ten pages,
// because a gap there does not fail loudly — pdf.js simply stops labelling, and the fixture would then
// prove nothing while looking like it did.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FIRST_PAGE = 5;
const RANGES = [
  { from: 0, style: 'r', start: 1, prefix: '', count: 3 },
  { from: 3, style: 'D', start: 1, prefix: '', count: 5 },
  { from: 8, style: 'D', start: 1, prefix: 'A-', count: 2 },
];

const ROMAN = [[1, 'i'], [2, 'ii'], [3, 'iii'], [4, 'iv'], [5, 'v'], [6, 'vi'], [7, 'vii'], [8, 'viii'], [9, 'ix'], [10, 'x']];

/** The label pdf.js is expected to report for a page index, computed the way the spec says. */
function labelAt(index) {
  const range = RANGES.find((r) => index >= r.from && index < r.from + r.count);
  if (!range) throw new Error(`page index ${index} is inside no labelled range`);
  const value = range.start + (index - range.from);
  if (range.style === 'r') {
    const roman = ROMAN.find(([n]) => n === value);
    if (!roman) throw new Error(`the roman range only reaches x, and ${value} was asked for`);
    return range.prefix + roman[1];
  }
  return range.prefix + String(value);
}

const PAGES = RANGES.reduce((total, range) => total + range.count, 0);
const LABELS = Array.from({ length: PAGES }, (_, index) => labelAt(index));

const objects = new Array(FIRST_PAGE + PAGES + 1).fill(null);
objects[1] = `<< /Type /Catalog /Pages 2 0 R /PageLabels ${PAGES + 4} 0 R >>`;
objects[2] = `<< /Type /Pages /Kids [${Array.from({ length: PAGES }, (_, i) => `${FIRST_PAGE + i} 0 R`).join(' ')}] /Count ${PAGES} >>`;
objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

for (let index = 0; index < PAGES; index++) {
  const label = LABELS[index];
  objects[FIRST_PAGE + index] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents ${FIRST_PAGE + PAGES + index} 0 R >>`;
}

const nums = RANGES.map(
  (range) =>
    `${range.from} << /S /${range.style}${range.prefix ? ` /P (${range.prefix})` : ''} /St ${range.start} >>`,
).join('  ');
objects[PAGES + 4] = `<< /Type /PageLabels /Nums [${nums}] >>`;

for (let index = 0; index < PAGES; index++) {
  const label = LABELS[index];
  const body =
    `BT /F1 96 Tf 72 620 Td (${label}) Tj ET\n` +
    `BT /F1 14 Tf 72 580 Td (page ${index + 1} of ${PAGES}, labelled "${label}") Tj ET\n` +
    `BT /F1 14 Tf 72 560 Td (FR-12 fixture - type the label to reach this page) Tj ET`;
  objects[FIRST_PAGE + PAGES + index] = { stream: body };
}

// No gaps and no overlaps: /Nums ranges run until the next pair, so a covered index would silently end
// the label table early and the file would look fine while testing nothing.
const covered = new Set();
for (const range of RANGES) {
  for (let index = range.from; index < range.from + range.count; index++) {
    if (covered.has(index)) throw new Error(`page index ${index} is inside two ranges`);
    covered.add(index);
  }
}
for (let index = 0; index < PAGES; index++) {
  if (!covered.has(index)) throw new Error(`page index ${index} has no range, so pdf.js stops labelling there`);
}

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

const out = join(root, 'playground', 'fixtures', 'labelled-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);
console.log(`labels: ${LABELS.map((l) => `"${l}"`).join(' ')}`);
