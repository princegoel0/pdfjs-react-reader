// Generates playground/fixtures/vector-sample.pdf — §6's profile C: "architectural or engineering drawing,
// very high operator count per page, repeated paths and clipping".
//
// Profile A is heavy in *pages* and profile B in *decoded pixels*; neither is heavy in the thing this one is
// about, which is how much work a single page asks of the renderer. A drawing sheet of this shape is what a
// reader with a CAD export actually opens, and its cost is not memory but operators: every path segment is a
// call the renderer makes on the main thread, so the profile's target is expressed in main-thread time.
//
// Three properties the fixture has to have, and how it gets them:
//
//   * **a high operator count per page** — each sheet draws several hundred detail cells, and a cell is a
//     clipped group of hatch lines, a polygon and a curve. That is tens of thousands of path operators per
//     page, which is the shape of a real drawing rather than a synthetic blob.
//   * **repeated paths** — the same cell geometry is drawn on a grid, so a renderer that caches a path still
//     has to execute it hundreds of times. Variety comes from the sheet's seed, not from one-off geometry.
//   * **clipping** — every cell is a `q … re W n … Q` group. Clipping is the part of the profile the other
//     fixtures never exercise, and it is the part that makes a canvas renderer slow.
//
// The streams are Flate-compressed, because the *file* is not the cost: an uncompressed drawing of this
// operator count would be a tracked binary of several megabytes for no measurement gain.
//
// Deterministic by construction: a seeded generator, no `Math.random()`, so re-running this file reproduces
// the committed bytes and the fixture hash in `benchmarks/latest.json` stays honest.
//
// Run: node scripts/make-vector-pdf.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A1 portrait in points — the box an engineering sheet is actually distributed at. */
const SHEET = { width: 2384, height: 1684 };
const PAGES = 4;
/** Detail cells across and down the sheet: 24 × 14 = 336 clipped groups per page. */
const COLS = 24;
const ROWS = 14;
/** Hatch lines inside a cell, and the vertices of the polygon and the curves drawn over them. */
const HATCH = 26;
const POLYGON = 10;
const CURVES = 4;
/** Per-page operator floor — the self-check below is what makes "very high count" a claim, not an adjective. */
const MIN_OPERATORS = 15_000;

/** A 32-bit linear congruential generator: same seed, same drawing, on every machine, forever. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const r2 = (value) => value.toFixed(2);

/**
 * One detail cell: a clip, a hatch field, a polygon and a few curve segments.
 *
 * The order is the order a renderer meets them in — state save, clip path, painting, restore — which is why a
 * cell costs a clip setup as well as its strokes.
 */
function cell(x, y, w, h, random) {
  const out = ['q', `${r2(x)} ${r2(y)} ${r2(w)} ${r2(h)} re W n`, '0.45 w'];
  const step = h / HATCH;
  for (let i = 0; i < HATCH; i++) {
    const at = y + i * step;
    out.push(`${r2(x)} ${r2(at)} m ${r2(x + w)} ${r2(at + step / 2)} l S`);
  }
  out.push('0.8 w');
  const points = [];
  for (let i = 0; i < POLYGON; i++) {
    const angle = (i / POLYGON) * Math.PI * 2;
    const radius = (0.18 + random() * 0.14) * Math.min(w, h);
    points.push(`${r2(x + w / 2 + Math.cos(angle) * radius)} ${r2(y + h / 2 + Math.sin(angle) * radius)}`);
  }
  out.push(`${points[0]} m ${points.slice(1).map((p) => `${p} l`).join(' ')} ${points[0]} l S`);
  out.push('0.6 w');
  for (let i = 0; i < CURVES; i++) {
    const bx = x + random() * w;
    const by = y + random() * h;
    out.push(
      `${r2(bx)} ${r2(by)} m ${r2(bx + w * 0.2)} ${r2(by + h * 0.3)} ${r2(bx + w * 0.5)} ${r2(by + h * 0.1)} ` +
        `${r2(bx + w * 0.7)} ${r2(by + h * 0.4)} c S`,
    );
  }
  out.push('Q');
  return out;
}

/** The sheet frame, the border of ticks and a title block: the drawing furniture around the cell grid. */
function frame(page) {
  const { width, height } = SHEET;
  const out = ['1.6 w', `40 40 ${width - 80} ${height - 80} re S`, '0.6 w'];
  for (let x = 40; x < width - 40; x += 60) {
    out.push(`${x} 40 m ${x} 56 l S`, `${x} ${height - 40} m ${x} ${height - 56} l S`);
  }
  for (let y = 40; y < height - 40; y += 60) {
    out.push(`40 ${y} m 56 ${y} l S`, `${width - 40} ${y} m ${width - 56} ${y} l S`);
  }
  const bx = width - 620;
  const by = 60;
  out.push('1.2 w', `${bx} ${by} 560 140 re S`, '0.5 w');
  for (let i = 1; i < 5; i++) out.push(`${bx} ${by + i * 28} m ${bx + 560} ${by + i * 28} l S`);
  out.push(`${bx + 180} ${by} m ${bx + 180} ${by + 140} l S`);
  // ASCII inside the string, and `Td` before each `Tj`: a text operator with no text matrix set draws
  // nothing, and a non-ASCII byte in a latin1 PDF string is a different character per viewer.
  out.push(`BT /F1 22 Tf ${bx + 12} ${by + 108} Td (SHEET ${page} OF ${PAGES} - DETAIL GRID) Tj ET`);
  out.push(`BT /F1 12 Tf ${bx + 12} ${by + 82} Td (pdfjs-react-reader profile C fixture) Tj ET`);
  return out;
}

/** One drawing sheet: the frame, then the grid of clipped detail cells. */
function sheet(page) {
  const random = seeded(0x5eed + page * 7919);
  const margin = 90;
  const cellW = (SHEET.width - 2 * margin) / COLS;
  const cellH = (SHEET.height - 2 * margin) / ROWS;
  const ops = [...frame(page)];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      ops.push(...cell(margin + col * cellW, margin + row * cellH, cellW, cellH, random));
    }
  }
  return ops.join('\n');
}

/**
 * Rough operator count over the text this generator wrote: a path token or a state operator per match. Not a
 * parse, because the number's purpose is "what a renderer is asked to execute per page", and these are the
 * bytes that ask it.
 */
function countOperators(source) {
  return (source.match(/\b(m|l|c|re|W|S|q|Q)\b/g) ?? []).length;
}

const CATALOG = 1;
const PAGES_OBJ = 2;
const FONT = 3;
const PAGE_BASE = 4;
const CONTENT_BASE = PAGE_BASE + PAGES;
const size = CONTENT_BASE + PAGES;

const objects = new Array(size + 1).fill(null);
objects[CATALOG] = `<< /Type /Catalog /Pages ${PAGES_OBJ} 0 R >>`;
objects[PAGES_OBJ] =
  `<< /Type /Pages /Count ${PAGES} /Kids [` +
  Array.from({ length: PAGES }, (_, i) => `${PAGE_BASE + i} 0 R`).join(' ') +
  '] >>';
objects[FONT] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

const counts = [];
for (let page = 1; page <= PAGES; page++) {
  const source = sheet(page);
  const operators = countOperators(source);
  counts.push(operators);
  if (operators < MIN_OPERATORS) {
    throw new Error(
      `sheet ${page} has ${operators} operators, under the ${MIN_OPERATORS} floor that makes this profile C ` +
        `and not a smaller profile A; change the grid rather than the floor`,
    );
  }
  objects[PAGE_BASE + page - 1] =
    `<< /Type /Page /Parent ${PAGES_OBJ} 0 R /MediaBox [0 0 ${SHEET.width} ${SHEET.height}] ` +
    `/Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${CONTENT_BASE + page - 1} 0 R >>`;
  objects[CONTENT_BASE + page - 1] = { bytes: deflateSync(Buffer.from(source, 'latin1'), { level: 9 }) };
}

let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
const offsets = new Array(size + 1).fill(0);
for (let num = 1; num <= size; num++) {
  const obj = objects[num];
  if (!obj) continue;
  offsets[num] = pdf.length;
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
  } else {
    pdf += `${num} 0 obj\n<< /Length ${obj.bytes.length} /Filter /FlateDecode >>\nstream\n`;
    pdf += obj.bytes.toString('latin1');
    pdf += '\nendstream\nendobj\n';
  }
}

const xrefStart = pdf.length;
pdf += `xref\n0 ${size + 1}\n0000000000 65535 f \n`;
for (let num = 1; num <= size; num++) {
  pdf += offsets[num] ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size ${size + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, 'playground', 'fixtures', 'vector-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(
  `wrote ${out} (${pdf.length} bytes, ${PAGES} sheets of ${SHEET.width}x${SHEET.height} pt, ` +
    `${COLS}x${ROWS} clipped cells)\n` +
    counts.map((count, i) => `  sheet ${i + 1}: ${count} operators`).join('\n'),
);
