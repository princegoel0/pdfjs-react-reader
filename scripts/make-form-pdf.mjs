// Generates playground/fixtures/form-sample.pdf — a 2-page document exercising
// every AcroForm widget type plus an internal link and a highlight annotation:
//   page 1: text, multiline text, checkbox, radio group (3 kids), combo box,
//           list box, push button
//   page 2: text field, internal link annotation, highlight annotation
// Object numbers deliberately do not line up with page order, so any code that
// confuses a page reference with a page index fails loudly.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE1 = 4;
const PAGE2 = 5;
const DA = '/F1 10 Tf 0 g';

const objects = new Map();

function widget(num, page, rect, body) {
  // /F 4 is the PRINT flag. Without it pdf.js's `Annotation.printable` is false
  // and the worker drops every widget from the print operator list, so the
  // fixture would not exercise FR-19 (form values baked into a printout).
  objects.set(
    num,
    `<< /Type /Annot /Subtype /Widget /F 4 /Rect [${rect.join(' ')}] /P ${page} 0 R ${body} >>`,
  );
}

function textField(num, page, rect, name, value, extra = '') {
  widget(num, page, rect, `/FT /Tx /T (${name}) /V (${value}) /DA (${DA}) ${extra}`);
}

// ---- catalog, pages, resources ----
objects.set(1, '<< /Type /Catalog /Pages 2 0 R /AcroForm 30 0 R >>');
objects.set(2, '<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>');
objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
objects.set(
  PAGE1,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 3 0 R >> >> /Contents 60 0 R ' +
    '/Annots [10 0 R 11 0 R 12 0 R 16 0 R 17 0 R 18 0 R 19 0 R 20 0 R 26 0 R] >>',
);
objects.set(
  PAGE2,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 3 0 R >> >> /Contents 61 0 R ' +
    '/Annots [21 0 R 22 0 R 23 0 R] >>',
);

// ---- page 1 fields ----
textField(10, PAGE1, [72, 700, 280, 716], 'fullName', 'Ada Lovelace');
textField(11, PAGE1, [72, 640, 320, 690], 'notes', 'multiline notes', '/Ff 4096');

// Checkbox: /AP /N lists both states so pdf.js derives exportValue = "Yes".
widget(
  12,
  PAGE1,
  [72, 610, 88, 626],
  '/FT /Btn /T (subscribe) /Ff 16384 /V /Off /AS /Off ' + '/AP << /N << /Off 40 0 R /Yes 41 0 R >> >>',
);

// Radio group: one parent field, three widget kids sharing the field name.
// Only the kid matching /V gets a non-/Off appearance state — marking all of
// them would paint every option as selected on the canvas.
objects.set(
  15,
  '<< /FT /Btn /Ff 32768 /T (priority) /V /Medium /Kids [16 0 R 17 0 R 18 0 R] >>',
);
const radioKid = (num, rect, state, selected) =>
  widget(
    num,
    PAGE1,
    rect,
    `/Parent 15 0 R /AP << /N << /Off 40 0 R /${state} 42 0 R >> >> /AS /${selected ? state : 'Off'}`,
  );
radioKid(16, [72, 570, 84, 582], 'Low', false);
radioKid(17, [72, 552, 84, 564], 'Medium', true);
radioKid(18, [72, 534, 84, 546], 'High', false);

// Combo box (drop-down) and list box (multi-select).
widget(
  19,
  PAGE1,
  [72, 500, 200, 516],
  `/FT /Ch /T (country) /Ff 131072 /V (DE) /Opt [(USA) (DE) (FR)] /DA (${DA})`,
);
widget(
  20,
  PAGE1,
  [72, 430, 200, 490],
  `/FT /Ch /T (skills) /Ff 2097152 /V [(PDF)] /Opt [(JS) (PDF) (Rust)] /DA (${DA})`,
);

// Push button with a GoTo action: pdf.js warns about push buttons that carry no
// action dictionary, and this also exercises widget-triggered navigation.
widget(
  26,
  PAGE1,
  [300, 700, 380, 720],
  '/FT /Btn /Ff 65536 /T (submit) /A << /S /GoTo /D [5 0 R /XYZ null null null] >>',
);

// ---- page 2: field, internal link, highlight ----
textField(21, PAGE2, [72, 700, 280, 716], 'signatureNote', '');
objects.set(
  22,
  '<< /Type /Annot /Subtype /Link /Rect [72 640 240 654] /P 5 0 R ' +
    '/Border [0 0 0] /C [0 0 0] /Dest [4 0 R /XYZ null null null] >>',
);
objects.set(
  23,
  '<< /Type /Annot /Subtype /Highlight /Rect [72 596 300 610] /P 5 0 R ' +
    '/QuadPoints [72 610 300 610 72 596 300 596] /C [1 1 0] /CA 0.4 >>',
);

// ---- AcroForm ----
objects.set(
  30,
  '<< /Fields [10 0 R 11 0 R 12 0 R 15 0 R 19 0 R 20 0 R 26 0 R 21 0 R] ' +
    '/DR << /Font << /F1 3 0 R >> >> /DA (/F1 0 Tf 0 g) >>',
);

// ---- appearance streams ----
objects.set(40, {
  dict: '/Type /XObject /Subtype /Form /BBox [0 0 16 16]',
  stream: '',
});
objects.set(41, {
  dict: '/Type /XObject /Subtype /Form /BBox [0 0 16 16]',
  stream: '0 g 3 w 3 8 m 6 4 l 13 12 l S',
});
// Radio "on": a round-capped zero-length stroke reads as a centred dot.
objects.set(42, {
  dict: '/Type /XObject /Subtype /Form /BBox [0 0 16 16]',
  stream: '0 g 1 J 6 w 8 8 m 8 8 l S',
});

// ---- page content ----
const text = (body, x, y, size) => `BT /F1 ${size} Tf ${x} ${y} Td (${body}) Tj ET`;
const stream = (lines) => ({ dict: '', stream: lines.join('\n') });

objects.set(
  60,
  stream([
    text('AcroForm fixture', 72, 760, 16),
    text('Full name:', 72, 720, 10),
    text('Notes:', 72, 694, 10),
    text('Subscribe:', 96, 614, 10),
    text('Low', 90, 573, 10),
    text('Medium', 90, 555, 10),
    text('High', 90, 537, 10),
    text('Country:', 72, 520, 10),
    text('Skills:', 210, 460, 10),
  ]),
);
objects.set(
  61,
  stream([
    text('Page two of the form fixture', 72, 760, 16),
    text('Signature note:', 72, 720, 10),
    text('Highlighted sentence on page two', 72, 600, 12),
    text('Back to page one (link annotation)', 76, 643, 10),
  ]),
);

// ---- assembly ----
const maxNum = Math.max(...objects.keys());
let pdf = '%PDF-1.4\n';
const offsets = new Array(maxNum + 1).fill(0);
for (const num of [...objects.keys()].sort((a, b) => a - b)) {
  const obj = objects.get(num);
  offsets[num] = pdf.length;
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
  } else {
    pdf += `${num} 0 obj\n<< ${obj.dict} /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
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

const out = join(root, 'playground', 'fixtures', 'form-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);
