// Generates playground/fixtures/attachments-ocg-sample.pdf: three pages carrying
// the two things the rich sidebar needs and no other fixture exercises —
// embedded files in the Catalog's /Names /EmbeddedFiles tree, and three optional
// content groups whose third one starts hidden.
//
// Each layer paints one line of text at a known height and the third starts off, so a
// render that honours /OCProperties leaves a blank band where "Stamp" would be. The
// attribution is what makes that true, and it is checkable without pixels: page 1's
// operator list wraps 29/26/28-glyph showText runs in beginMarkedContentProps for
// 8R/9R/10R, and only 10R reports visible: false.
//
// Page objects are 5/6/7 rather than 3/4/5 so nothing can pass by confusing an
// object reference with a page index, as in outline-sample.pdf.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// `--stamp-on` is for verification only: it flips the third group's default so the
// same page can be rendered twice, from two documents that differ in nothing but an
// /OCProperties flag. A band that is blank in one and inked in the other proves the
// blankness comes from the layer and not from a mistyped rectangle.
const argv = process.argv.slice(2);
const stampOn = argv.includes('--stamp-on');
const outIndex = argv.indexOf('--out');
const outputPath =
  outIndex >= 0 && argv[outIndex + 1]
    ? resolve(argv[outIndex + 1])
    : join(root, 'playground', 'fixtures', 'attachments-ocg-sample.pdf');

/**
 * A dictionary string, or a stream: `{ dict }` for one that needs its own
 * entries (`/Type /EmbeddedFile`, `/Length` is appended), or bare `{ stream }`
 * for a page content stream.
 */
const objects = new Map();

objects.set(
  1,
  `<< /Type /Catalog /Pages 2 0 R
  /Names << /EmbeddedFiles << /Names [(notes.txt) 15 0 R (data.csv) 17 0 R (report.pdf) 19 0 R] >> >>
  /OCProperties <<
    /OCGs [8 0 R 9 0 R 10 0 R]
    /D << /BaseState /ON /ON ${stampOn ? '[8 0 R 9 0 R 10 0 R]' : '[8 0 R 9 0 R]'} /OFF ${
      stampOn ? '[]' : '[10 0 R]'
    } /Order [8 0 R 9 0 R 10 0 R] /RBMode /NotChecked >>
  >> >>`,
);
objects.set(2, '<< /Type /Pages /Kids [5 0 R 6 0 R 7 0 R] /Count 3 >>');
objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

// Marked-content names map to the OCG objects through the page Resources, which
// is the only route pdf.js reads: a /BDC tag whose name is absent from
// /Properties is content that belongs to no layer at all.
const resources =
  '<< /Font << /F1 3 0 R >> /Properties << /MC0 8 0 R /MC1 9 0 R /MC2 10 0 R >> >>';const pageDict = (contents) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${contents} 0 R >>`;
objects.set(5, pageDict(11));
objects.set(6, pageDict(12));
objects.set(7, pageDict(13));

// /Name is what a layers tab shows. /Intent as an array covers the three
// contexts pdf.js filters on, so a group is never hidden from a view that
// expected it. The last one is off in every context, including View.
objects.set(
  8,
  '<< /Type /OCG /Name (Heading layer) /Intent [/View /Design /Print] /Usage << /Print << /PrintState /ON >> >> >>',
);
objects.set(
  9,
  '<< /Type /OCG /Name (Body layer) /Intent [/View /Design /Print] /Usage << /Print << /PrintState /ON >> >> >>',
);
objects.set(
  10,
  '<< /Type /OCG /Name (Stamp layer) /Intent [/View /Design /Print] /Usage << /Print << /PrintState /OFF >> >> >>',
);

const text = (size, y, value) => `BT /F1 ${size} Tf 72 ${y} Td (${value}) Tj ET`;
// `BDC` takes two operands — the marked-content *tag* and the property name — and
// pdf.js only resolves a layer when the tag is exactly `/OC`. With one operand the
// command is skipped outright ("expected 2 args, but received 1"), which leaves the
// content painted but belonging to no group, so the fixture would look fine while a
// layers tab had nothing to toggle.
const layer = (props, body) => `q /OC /${props} BDC\n${body}\nEMC Q`;

objects.set(11, {
  stream: [
    text(20, 740, 'Attachments and optional content groups'),
    layer('MC0', text(16, 700, 'HEADING LAYER - on by default')),
    layer('MC1', text(12, 660, 'BODY LAYER - on by default')),
    layer(
      'MC2',
      `${text(16, 600, 'STAMP LAYER - off by default')}\n0.85 0 0 RG 4 w 72 576 m 330 576 l S`,
    ),
    text(10, 520, 'Three files are attached: notes.txt, data.csv, report.pdf'),
  ].join('\n'),
});

// Page 2 keeps one layer and one plain block, so "a page with fewer groups than
// the document has" is covered rather than assumed.
objects.set(12, {
  stream: [
    text(14, 740, 'Page 2'),
    layer('MC1', text(12, 700, 'BODY LAYER on page 2')),
    text(12, 660, 'Ungrouped text, visible whatever the layers do'),
  ].join('\n'),
});

objects.set(13, { stream: [text(14, 740, 'Page 3'), text(12, 700, 'No layers here.')].join('\n') });

/**
 * A filespec plus its embedded stream. `/Desc` is what pdf.js surfaces as the
 * attachment's description, and the content lives in `/EF /F` — a filespec with
 * only `/UF`, or a stream with no `/EF`, reads as an attachment with nothing in it.
 */
function attachment(filespecNumber, name, mime, body, description) {
  const streamNumber = filespecNumber + 1;
  objects.set(
    filespecNumber,
    `<< /Type /Filespec /F (${name}) /UF (${name}) /Desc (${description}) /EF << /F ${streamNumber} 0 R >> >>`,
  );
  objects.set(streamNumber, {
    dict:
      `<< /Type /EmbeddedFile /Subtype /${mime.replace('/', '#2F')} ` +
      `/Params << /Size ${body.length} >>`,
    stream: body,
  });
}

// A minimal but genuinely structured PDF, so an attachment that is itself a
// document behaves like one where a viewer offers to open it.
const innerPdf = [
  '%PDF-1.4',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
  'trailer << /Size 4 /Root 1 0 R >>',
  'startxref',
  '0',
  '%%EOF',
].join('\n');

attachment(15, 'notes.txt', 'text/plain', 'Attached plain-text note for the fixture.\nSecond line.\n', 'A note about the report');
attachment(17, 'data.csv', 'text/csv', 'quarter,revenue\nQ1,120\nQ2,145\n', 'Two rows of numbers');
attachment(19, 'report.pdf', 'application/pdf', innerPdf, 'A PDF embedded in a PDF');

const highest = Math.max(...objects.keys());
let pdf = '%PDF-1.4\n';
const offsets = new Map();
for (let num = 1; num <= highest; num++) {
  const obj = objects.get(num);
  if (obj === undefined) continue;
  offsets.set(num, pdf.length);
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
    continue;
  }
  // A composed `dict` is left open by the caller and closed here, so /Length
  // always lands inside the same dictionary that names the stream.
  const dict = obj.dict ? `${obj.dict}\n/Length ${obj.stream.length} >>` : `<< /Length ${obj.stream.length} >>`;
  pdf += `${num} 0 obj\n${dict}\nstream\n${obj.stream}\nendstream\nendobj\n`;
}

const xrefStart = pdf.length;
pdf += `xref\n0 ${highest + 1}\n0000000000 65535 f \n`;
for (let num = 1; num <= highest; num++) {
  const offset = offsets.get(num);
  pdf += offset
    ? `${String(offset).padStart(10, '0')} 00000 n \n`
    : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size ${highest + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, pdf, 'latin1');
console.log(`wrote ${outputPath} (${pdf.length} bytes)${stampOn ? ' [stamp layer ON]' : ''}`);
