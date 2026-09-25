// Generates playground/fixtures/scripted-sample.pdf: an AcroForm text field with
// JavaScript at document, page and field level. pdf.js never executes it (there
// is no sandbox here), so this is the fixture that proves
// `capabilities.hasJSActions` reports a form whose calculations will not run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const objects = new Array(10).fill(null);
objects[1] =
  '<< /Type /Catalog /Pages 2 0 R /AcroForm 8 0 R /OpenAction 7 0 R ' +
  '/Names << /JavaScript [ (doc-ready) 7 0 R ] >> >>';
objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
objects[3] =
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
  '/Resources << /Font << /F1 5 0 R >> >> /Annots [4 0 R] /AA << /O 9 0 R >> /Contents 6 0 R >>';
objects[4] =
  '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Total) /V (0) /Rect [72 600 260 624] ' +
  '/P 3 0 R /AA << /K 9 0 R >> >>';
objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
objects[7] = '<< /S /JavaScript /JS (app.alert("document opened");) >>';
objects[8] =
  '<< /Fields [4 0 R] /DA (/F1 12 Tf 0 g) /CalcOrder [4 0 R] ' +
  '/XFA [ (template) 10 0 R ] >>';
objects[9] = '<< /S /JavaScript /JS (this.getField("Total").value = 1 + 1;) >>';

const lines = [
  'BT /F1 24 Tf 72 700 Td (Scripted form fixture) Tj ET',
  'BT /F1 12 Tf 72 664 Td (AcroForm field with calculation JavaScript at document, page',
  'BT /F1 12 Tf 72 646 Td (and field level, plus an XFA packet in the AcroForm.) Tj ET',
];
objects[6] = { stream: lines.join('\n') };

// A 1-page XFA packet. Whether a viewer composes pages from it is pdf.js's
// business; the point here is that `AcroForm/XFA` exists and is a stream, which
// is what `formInfo.hasXfa` and `IsXFAPresent` are derived from.
const xfa =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">' +
  '<template xmlns="http://www.xfa.org/schema/xfa-template/3.1/">' +
  '<pageSet><pageArea id="Page1" name="JPX">' +
  '<contentArea x="0pt" y="0pt" w="612pt" h="792pt"/>' +
  '<medium length="612pt" width="792pt"/>' +
  '</pageArea></pageSet>' +
  '<descendant name="form1" access="protected" scriptType="application/x-javascript-formcalc">' +
  '<page name="Page1" h="792pt" w="612pt">' +
  '<field name="Total" h="24pt" w="188pt" x="72pt" y="168pt">' +
  '<ui><text/></ui><value><text>0</text></value>' +
  '</field></page></descendant></template>' +
  '<datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/">' +
  '<form1><Total>0</Total></form1></datasets></xdp:xdp>';
objects[10] = { stream: xfa };

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

const out = join(root, 'playground', 'fixtures', 'scripted-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);
