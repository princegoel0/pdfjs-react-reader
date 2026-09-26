// Generates playground/fixtures/annotated-sample.pdf — a two-page document whose
// annotations already exist, so `0.6` has something to select, edit and delete
// rather than only something to create:
//   page 1: highlight, underline, strikeout, squiggly (all with /QuadPoints over
//           known text) and a /Text sticky note, each with a /Popup
//   page 2: an /Ink annotation and a /FreeText annotation
//
// Object numbers deliberately do not line up with page order, and the highlight
// sits over a sentence no other fixture contains, so a test that found it by
// counting generic annotations could not tell this document from another.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE1 = 4;
const PAGE2 = 5;
// Popups live far above the annotation numbers: at `num + 50` they land on the
// page content streams (10 -> 60) and the document renders blank.
const POPUP_OFFSET = 100;

const objects = new Map();

/** One line of Helvetica text, positioned by baseline. */
function line(text, x, y, size = 12) {
  return `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
}

const content = (lines) => lines.join('\n');

// A markup annotation over a box. `rect` is the annotation rect; `/QuadPoints`
// is the highlighted text in the order the spec wants — upper-left, upper-right,
// lower-left, lower-right — which is what pdf.js reads to paint the shape, so a
// wrong order silently draws nothing.
function markup(num, page, subtype, rect, quad, colour, extra = '') {
  objects.set(
    num,
    `<< /Type /Annot /Subtype /${subtype} /F 4 /CA 0.4 /Rect [${rect.join(' ')}] ` +
      `/C [${colour.join(' ')}] /QuadPoints [${quad.join(' ')}] /P ${page} 0 R ` +
      `/Popup ${num + POPUP_OFFSET} 0 R ${extra} >>`,
  );
  // The popup is a separate annotation and, as Acrobat writes it, also a member
  // of the page's /Annots array. It must not be `num + 50`: that lands on 60 and
  // 61, which are the page content streams, and the page renders blank while its
  // annotation references dangle.
  objects.set(
    num + POPUP_OFFSET,
    `<< /Type /Annot /Subtype /Popup /Parent ${num} 0 R /Rect [${rect[2] + 8} ${rect[1]} ` +
      `${rect[2] + 168} ${rect[1] + 96}] /X 12 /Y -12 >>`,
  );
}

// ---- catalog, pages, resources ----
objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
objects.set(2, '<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>');
objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

const PAGE1_ANNOTS = [10, 11, 12, 13, 14];
const PAGE2_ANNOTS = [15, 16];
const annotRefs = (nums) =>
  nums.flatMap((n) => [`${n} 0 R`, `${n + POPUP_OFFSET} 0 R`]).join(' ');

objects.set(
  PAGE1,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents 60 0 R /Annots [${annotRefs(PAGE1_ANNOTS)}] >>`,
);
objects.set(
  PAGE2,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents 61 0 R /Annots [${annotRefs(PAGE2_ANNOTS)}] >>`,
);

// ---- page 1: the four text-selection markups over one known sentence ----
// Baseline 700, 12pt Helvetica, from x=72 to x=372. The annotation rect spans the
// glyph box; the quads are the same box in spec order.
const LINE_TOP = 713;
const LINE_BOTTOM = 697;
const QUAD = [72, LINE_TOP, 372, LINE_TOP, 72, LINE_BOTTOM, 372, LINE_BOTTOM];

markup(10, PAGE1, 'Highlight', [72, LINE_BOTTOM, 372, LINE_TOP], QUAD, [1, 1, 0], '/T (Reviewer)');
markup(11, PAGE1, 'Underline', [72, 673, 340, 689], [72, 689, 340, 689, 72, 673, 340, 673], [0, 0, 0]);
markup(12, PAGE1, 'StrikeOut', [72, 649, 356, 665], [72, 665, 356, 665, 72, 649, 356, 649], [1, 0, 0]);
markup(13, PAGE1, 'Squiggly', [72, 625, 388, 641], [72, 641, 388, 641, 72, 625, 388, 625], [0, 0.6, 0]);

// A sticky note: no quads, an icon, and contents for the popup to show.
objects.set(
  14,
  '<< /Type /Annot /Subtype /Text /F 4 /Name /Comment /Rect [520 700 536 716] ' +
    '/C [1 0.8 0.2] /Contents (Check the figures against the 2025 returns) ' +
    `/P ${PAGE1} 0 R /Popup 114 0 R >>`,
);
objects.set(
  114,
  `<< /Type /Annot /Subtype /Popup /Parent 14 0 R /Rect [520 580 700 700] /X 12 /Y -12 /Open true >>`,
);

// ---- page 2: ink and free text ----
// /InkList is an array of point arrays; three strokes of two points each is the
// minimum that still exercises the polyline path in pdf.js's ink renderer.
objects.set(
  15,
  '<< /Type /Annot /Subtype /Ink /F 4 /CA 1 /Rect [72 500 200 560] /C [0 0 0] ' +
    '/Border [0 0 2] /InkList [[76 504 92 552 120 508 150 548 196 512]] ' +
    `/P ${PAGE2} 0 R /Popup 115 0 R >>`,
);
objects.set(
  115,
  `<< /Type /Annot /Subtype /Popup /Parent 15 0 R /Rect [210 480 390 600] /X 12 /Y -12 >>`,
);

// Free text needs a /DA (default appearance) to be editable, and pdf.js will
// regenerate the appearance stream from it.
objects.set(
  16,
  '<< /Type /Annot /Subtype /FreeText /F 4 /Rect [72 430 300 462] /C [0.6 0.6 1] ' +
    '/DA (/F1 12 Tf 0 g) /Contents (Inserted by a reader) /TexColor [0 0 0] ' +
    `/P ${PAGE2} 0 R /Popup 116 0 R >>`,
);
objects.set(
  116,
  `<< /Type /Annot /Subtype /Popup /Parent 16 0 R /Rect [310 410 490 530] /X 12 /Y -12 >>`,
);

objects.set(
  60,
  {
    dict: '/Type /XObject /Subtype /Form /BBox [0 0 612 792]',
    stream: content([
      line('Marked up before you opened this file', 72, 750, 16),
      line('The sentence below carries four text annotations.', 72, 727),
      line('Highlighted, underlined, struck out and squiggled.', 72, 700),
      line('A second line is underlined here for comparison.', 72, 676),
      line('A third line is struck out here instead.', 72, 652),
      line('And a fourth is squiggled to mark uncertainty.', 72, 628),
      line('The note icon at the top right has an open popup.', 72, 596),
    ]),
  },
);

objects.set(
  61,
  {
    dict: '/Type /XObject /Subtype /Form /BBox [0 0 612 792]',
    stream: content([
      line('Page two holds an ink stroke and free text.', 72, 750, 16),
      line('Both were authored by another viewer, not by pdf.js.', 72, 727),
      line('The ink above is one polyline; the box below is editable text.', 72, 480),
    ]),
  },
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

// ---- self-check ----
// A fixture that pdf.js reads as empty is worse than no fixture at all: the
// measurement built on it would report "this editor type does not persist". So
// every reference the pages make is resolved here, and every xref offset is
// pointed at, before a byte is written.
const problems = [];

for (const num of objects.keys()) {
  const body = objects.get(num);
  const text = typeof body === 'string' ? body : `${body.dict} ${body.stream}`;
  for (const ref of text.matchAll(/(\d+) 0 R/g)) {
    if (!objects.has(Number(ref[1]))) problems.push(`object ${num} references missing ${ref[1]} 0 R`);
  }
}

for (const num of [PAGE1, PAGE2]) {
  const contents = /\/Contents (\d+) 0 R/.exec(objects.get(num))[1];
  if (typeof objects.get(Number(contents)) !== 'object') {
    problems.push(`page ${num} content stream ${contents} is not a stream object`);
  }
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

const out = join(root, 'playground', 'fixtures', 'annotated-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);
