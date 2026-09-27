// Generates playground/fixtures/xfa-sample.pdf — a *pure* XFA document, which is
// the shape the engine renders through `XfaLayer` rather than through the canvas.
//
// Four conditions have to hold at once for pdf.js to build an XFA factory at all
// (`build/pdf.worker.mjs`, `get xfaFactory`): `enableXfa` on the load task, a
// `/NeedsRendering true` on the *catalog*, `/XFA` in the AcroForm, and no AcroForm
// `/Fields` — a document that has both is treated as an AcroForm with an XFA
// snapshot and never reaches the XFA parser. The form must then survive parsing,
// binding and layout, because `PDFDocumentProxy.isPureXfa` is `!!_htmlForXfa` and
// `_htmlForXfa` only exists once `XFAFactory.getPages()` has laid the template out.
//
// The template's page box is 500x700 while the PDF's own MediaBox is 612x792, on
// purpose: `page._pageInfo.view` reporting 500x700 is what proves the *XFA layout*
// drives the page size rather than the container's box, which is the one behaviour
// of pure-XFA rendering a consumer would notice (their page maths changes).
//
// The page content stream deliberately draws a sentence that must NOT appear once
// the XFA layer is wired in: it is the marker that separates "the canvas painted
// the PDF page" from "the XFA layer painted the template", which is the only honest
// way to read the result. Object numbers are validated before writing, as in
// make-annotated-pdf.mjs: a fixture that silently reads as empty is worse than none.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packetProblems, xfaFullPacket } from './xfa-packet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 4;
const ACROFORM = 30;
const XFA = 31;

/**
 * The packet itself — its shape, and the three details inside it that a failed
 * measurement each taught — lives in `./xfa-packet.mjs`, shared with
 * `make-xfa-array-pdf.mjs` so the two fixtures differ only in their container.
 */
const xfaPacket = xfaFullPacket();

// The PDF side. `NeedsRendering` belongs to the catalog; `/Fields` is absent on
// purpose, and adding it would send the document down the AcroForm path instead.
const objects = new Map();
objects.set(1, `<< /Type /Catalog /Pages 2 0 R /AcroForm ${ACROFORM} 0 R /NeedsRendering true >>`);
objects.set(2, `<< /Type /Pages /Kids [${PAGE} 0 R] /Count 1 >>`);
objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
objects.set(
  PAGE,
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>`,
);
objects.set(
  5,
  {
    dict: '/Type /XObject /Subtype /Form /BBox [0 0 612 792]',
    stream: [
      'BT /F1 16 Tf 72 700 Td (Painted by the PDF canvas, not the XFA layer) Tj ET',
      'BT /F1 11 Tf 72 676 Td (If this line is visible after XfaLayer renders, the page is being painted twice.) Tj ET',
      'BT /F1 11 Tf 72 180 Td (The canvas text sits at the top; the template text is what should show.) Tj ET',
    ].join('\n'),
  },
);
objects.set(ACROFORM, `<< /XFA ${XFA} 0 R /DR << /Font << >> >> >>`);
objects.set(XFA, { dict: '/Type /EmbeddedFile', stream: xfaPacket });

// ---- assembly ----
const maxNum = Math.max(...objects.keys());
let pdf = '%PDF-1.7\n';
const offsets = new Array(maxNum + 1).fill(0);
for (const num of [...objects.keys()].sort((a, b) => a - b)) {
  const obj = objects.get(num);
  offsets[num] = pdf.length;
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
  } else {
    pdf += `${num} 0 obj\n<< ${obj.dict} /Length ${Buffer.byteLength(obj.stream, 'latin1')} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
  }
}

const size = maxNum + 1;
const xrefStart = pdf.length;
pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
for (let num = 1; num < size; num++) {
  pdf += offsets[num]
    ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
    : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

// ---- self-check ----
const problems = [];

for (const num of objects.keys()) {
  const body = objects.get(num);
  const text = typeof body === 'string' ? body : `${body.dict} ${body.stream}`;
  for (const ref of text.matchAll(/(\d+) 0 R/g)) {
    if (!objects.has(Number(ref[1]))) problems.push(`object ${num} references missing ${ref[1]} 0 R`);
  }
}

// The four conditions the worker checks, asserted on the bytes rather than on the
// JavaScript that produced them: a later edit that reintroduces /Fields would make
// this fixture an AcroForm document wearing an XFA hat, and every measurement
// built on it would then be measuring the wrong path.
const catalog = objects.get(1);
if (!/\/NeedsRendering true/.test(catalog)) problems.push('catalog lost /NeedsRendering true');
const acroForm = objects.get(ACROFORM);
if (/\/Fields/.test(acroForm)) problems.push('the AcroForm has /Fields, so isPureXfa can never be true');
if (!/\/XFA \d+ 0 R/.test(acroForm)) problems.push('the AcroForm has no /XFA reference');
// The packet's own assertions are shared with the array fixtures, so a change that
// would break this document breaks those too and says so at generation time.
problems.push(...packetProblems(xfaPacket));

for (let num = 1; num < size; num++) {
  if (!objects.has(num)) continue;
  const offset = offsets[num];
  if (!new RegExp(`^${num} 0 obj\\n`).test(pdf.substr(offset, 12))) {
    problems.push(`xref offset ${offset} for object ${num} does not point at it`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`fixture invalid: ${problem}`);
  process.exit(1);
}

const out = join(root, 'playground', 'fixtures', 'xfa-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes, packet ${xfaPacket.length} bytes)`);
