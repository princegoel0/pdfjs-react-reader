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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 4;
const ACROFORM = 30;
const XFA = 31;

/**
 * The XFA packet: a template with one page area and four marked objects, plus the
 * datasets island the binder merges field values from. Namespaces are what the
 * parser dispatches on (`XFAParser` keys elements by namespace id), so a wrong one
 * here drops the element rather than raising.
 *
 * Three shapes here are load-bearing and each was found by a failed measurement:
 *  - the page box is on `<medium short long>`, not on `<pageArea w h>`:
 *    `PageArea[$toHTML]()` reads only `this.medium`, and without it the page div is
 *    given no width or height, `XFAFactory.dims` become NaN and the viewport
 *    collapses — which is exactly the blank band the 0.3 attempt produced. pdf.js
 *    warns "XFA - No medium specified in pageArea: please file a bug." when it happens.
 *  - the datasets island needs the `<data>` wrapper: `Binder` reads
 *    `root.datasets.data`, and `DatasetsNamespace` knows only `datasets` and `data`.
 *  - the form root declares its own namespace: an element in the *datasets*
 *    namespace is dispatched through `DatasetsNamespace[name]`, which is a class, so
 *    a node called `name`, `length` or `prototype` resolves to `Function.name` /
 *    `Function.length` and the parser dies with "is not a function". A data node
 *    named `<name>` is common in real forms, which makes that a pdf.js bug; here the
 *    fields are renamed and the island is namespaced, so the fixture stands either way.
 */
const TEMPLATE_NS = 'http://www.xfa.org/schema/xfa-template/3.9/';
const DATA_NS = 'http://www.xfa.org/schema/xfa-data/1.0/';

const xfaPacket = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
<template xmlns="${TEMPLATE_NS}">
  <subform name="form1" w="500pt" h="700pt" x="0pt" y="0pt" placement="block">
    <pageSet>
      <pageArea name="PageArea1" id="Page1">
        <medium short="500pt" long="700pt" orientation="portrait"/>
        <contentArea x="60pt" y="60pt" w="380pt" h="580pt"/>
      </pageArea>
    </pageSet>
    <desc><text>XFA fixture</text></desc>
    <draw name="heading" x="60pt" y="560pt" w="400pt" h="24pt">
      <value><text>Painted by the XFA layer, not the canvas</text></value>
    </draw>
    <field name="applicantName" x="60pt" y="520pt" w="240pt" h="18pt">
      <desc><text>Name</text></desc>
      <ui><textEdit/></ui>
      <value><text>Fallback</text></value>
    </field>
    <field name="applicantCountry" x="60pt" y="490pt" w="240pt" h="18pt">
      <desc><text>Country</text></desc>
      <ui><textEdit/></ui>
      <value><text>Fallback</text></value>
    </field>
    <draw name="footnote" x="60pt" y="110pt" w="400pt" h="18pt">
      <value><text>End of the template</text></value>
    </draw>
  </subform>
</template>
<datasets xmlns="${DATA_NS}">
  <data>
    <form1 xmlns="urn:xfa:fixture">
      <applicantName>Ada Lovelace</applicantName>
      <applicantCountry>United Kingdom</applicantCountry>
    </form1>
  </data>
</datasets>
</xdp:xdp>`;

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
if (!xfaPacket.startsWith('<?xml') || !/<xdp:xdp/.test(xfaPacket)) {
  problems.push('the packet is not an xdp:xdp document');
}
for (const [name, needle] of [
  ['template namespace', `xmlns="${TEMPLATE_NS}"`],
  ['datasets namespace', `xmlns="${DATA_NS}"`],
  ['pageSet', '<pageSet>'],
  ['pageArea', '<pageArea'],
  ['medium (the only thing that gives the page a size)', '<medium short='],
  ['data wrapper', '<data>'],
]) {
  if (!xfaPacket.includes(needle)) problems.push(`the packet has no ${name} (${needle})`);
}

// Only inside the datasets island, because that is the one namespace the parser
// dispatches through a *class*: `DatasetsNamespace[name]`.
const island = xfaPacket.slice(xfaPacket.indexOf('<datasets'), xfaPacket.indexOf('</datasets>'));
const colliding = [...island.matchAll(/<\s*([A-Za-z_][\w:-]*)/g)]
  .map((m) => m[1])
  .filter((name) => ['name', 'length', 'prototype'].includes(name));
if (colliding.length) {
  problems.push(`datasets element(s) named after a Function static: ${colliding.join(', ')}`);
}

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
