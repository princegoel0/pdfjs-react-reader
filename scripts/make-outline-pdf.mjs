// Generates playground/fixtures/outline-sample.pdf: 3 pages, an outline whose
// top level has one collapsed child and one named destination, and page object
// numbers deliberately out of order (5, 6, 7 for pages 1..3) so outline
// resolution cannot pass by treating object numbers as page numbers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const objects = new Array(19).fill(null);
objects[1] = '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /Names 18 0 R >>';
objects[2] = '<< /Type /Pages /Kids [5 0 R 6 0 R 7 0 R] /Count 3 >>';
objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
const pageDict = (contents) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`;
objects[5] = pageDict(15);
objects[6] = pageDict(16);
objects[7] = pageDict(17);
// Named destinations live in a NameTree under Catalog.Names/Dests (pdf.js only
// treats that location as a name tree; a bare Catalog.Dests is read as a flat map).
objects[9] = '<< /Names [(concl) [7 0 R /Fit]] >>';
objects[18] = '<< /Dests 9 0 R >>';
objects[10] = '<< /Type /Outlines /First 11 0 R /Last 13 0 R /Count 4 >>';
objects[11] =
  '<< /Title (1. Introduction) /Parent 10 0 R /Next 12 0 R /Dest [5 0 R /XYZ null null null] >>';
objects[12] =
  '<< /Title (2. Sections) /Parent 10 0 R /Prev 11 0 R /Next 13 0 R /First 14 0 R /Last 14 0 R /Count 1 /Dest [6 0 R /Fit] >>';
objects[13] = '<< /Title (3. Conclusion) /Parent 10 0 R /Prev 12 0 R /Dest /concl >>';
objects[14] = '<< /Title (2.1 Deep dive) /Parent 12 0 R /Dest [6 0 R /FitH null] >>';

const streamText = (label) =>
  `BT /F1 28 Tf 72 700 Td (${label}) Tj ET\nBT /F1 14 Tf 72 660 Td (pdfjs-react-reader Phase 4 fixture) Tj ET`;
for (const [num, label] of [
  [15, 'Page 1: Introduction'],
  [16, 'Page 2: Sections'],
  [17, 'Page 3: Conclusion'],
]) {
  const body = streamText(label);
  objects[num] = { stream: body };
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

const out = join(root, 'playground', 'fixtures', 'outline-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);
