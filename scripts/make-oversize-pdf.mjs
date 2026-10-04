// Generates playground/fixtures/oversize-sample.pdf — FR-51's sixth shape: "an over-large page".
//
// Until this file existed, that row was the only one of the six whose assertion was arithmetic rather than
// a measurement. `canvas.test.ts` checks the ceilings against a box typed into the test, which proves the
// formula and proves nothing about what the engine reports for a page that size — the number that has to be
// right for the formula to mean anything. Three pages, each chosen against the shipped ceilings rather than
// rounded for looks:
//
//   1. 612 × 792      — an ordinary letter box. The control: a document with giants in it still reports a
//                       normal page, uncapped.
//   2. 12 000 × 9 000  — 108 Mpx at scale 1. The *area* ceiling is what binds, at ~0.56 device px per CSS px:
//                       §6's "a ceiling beats a crash" half — resolution comes down, the page still paints.
//   3. 200 000 × 600   — a banner plot: 120 Mpx, so area alone would have clamped it to 0.53×, but the *side*
//                       ceiling reaches 0.16× first, below §6.1's 0.25 minimum. This is the one the renderer
//                       must refuse with `RESOURCE_LIMIT` rather than paint a quarter-scale strip.
//
// Page 3 is the reason the fixture has three pages and not two: without it the file would demonstrate the
// degrade half of §6.1 and leave the refusal half — the branch a reader actually notices — resting on a
// hand-written box. No page carries `/Rotate`: both ceilings are symmetric in width and height, so a rotation
// could not change any verdict here, and a fixture whose third page claimed to test that would be testing
// nothing.
//
// The ceilings are read out of `src/lib/canvas.ts`, not copied: a fixture tuned to constants this script
// re-declares would keep producing a page 3 that refuses long after someone raised `MAX_RENDER_SIDE` to a
// value where it no longer does. If a ceiling moves, this script stops, and the file is regenerated on purpose.
//
// Run: node scripts/make-oversize-pdf.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Same reader as `scripts/benchmark.mjs`: a constant that stops being a literal stops this script too. */
function readConstants() {
  const source = readFileSync(join(root, 'src', 'lib', 'canvas.ts'), 'utf8');
  const literal = (name) => {
    const raw = new RegExp(`export const ${name} = ([^;]+);`).exec(source)?.[1]?.trim();
    if (!raw) throw new Error(`${name} is no longer a simple constant in src/lib/canvas.ts`);
    const power = /^(\d+) \*\* (\d+)$/.exec(raw);
    if (power) return Number(power[1]) ** Number(power[2]);
    if (!/^[\d_.]+$/.test(raw)) throw new Error(`cannot read the value of ${name} from "${raw}"`);
    return Number(raw.replace(/_/g, ''));
  };
  return {
    maxPixels: literal('MAX_RENDER_PIXELS'),
    maxSide: literal('MAX_RENDER_SIDE'),
    minScale: literal('MIN_RENDER_SCALE'),
  };
}

const { maxPixels, maxSide, minScale } = readConstants();

/**
 * What `resolveRenderScale` will decide for this box at a requested ratio of 1 — recomputed here so the
 * generator can refuse to emit a page whose verdict is not the one the fixture was written to carry. It is
 * the same arithmetic, on the same constants, and the *test* asserts it against the real function; this is
 * only the generation-time guard that keeps the two from drifting apart silently.
 */
function verdictFor(width, height) {
  const byPixels = Math.sqrt(maxPixels / (width * height));
  const bySide = Math.min(maxSide / width, maxSide / height);
  const ceiling = Math.min(1, byPixels, bySide);
  if (ceiling >= 1) return { verdict: 'uncapped', limitedBy: null, scale: 1 };
  const limitedBy = byPixels <= bySide ? 'pixels' : 'side';
  return {
    verdict: ceiling < minScale ? 'refused' : 'clamped',
    limitedBy,
    scale: Number(ceiling.toFixed(4)),
  };
}

/** page, box, and the verdict this generator insists the box produces. */
const PAGES = [
  { page: 1, width: 612, height: 792, expect: { verdict: 'uncapped', limitedBy: null } },
  { page: 2, width: 12_000, height: 9_000, expect: { verdict: 'clamped', limitedBy: 'pixels' } },
  { page: 3, width: 200_000, height: 600, expect: { verdict: 'refused', limitedBy: 'side' } },
];

for (const p of PAGES) {
  const got = verdictFor(p.width, p.height);
  if (got.verdict !== p.expect.verdict || got.limitedBy !== p.expect.limitedBy) {
    throw new Error(
      `page ${p.page} (${p.width}x${p.height}) now reads as ${got.verdict}${
        got.limitedBy ? ` by ${got.limitedBy}` : ''
      } at the ceilings in src/lib/canvas.ts (${maxPixels} px / ${maxSide} px side / ${minScale} minimum), ` +
        `but this fixture exists to demonstrate ${p.expect.verdict} by ${p.expect.limitedBy}. ` +
        `Pick a box that still does, or move this row on purpose.`,
    );
  }
  // The stored box is not the only one a viewer looks at: a page rotated 90 degrees hands the renderer its
  // width and height the other way round, and the verdict has to survive that too. It does — both ceilings
  // are symmetric in the two sides — which is *why* this fixture carries no `/Rotate`: swapping would test
  // nothing here, and the rotation path is measured by FR-09 and by the rotated row of this same suite.
  const swapped = verdictFor(p.height, p.width);
  if (swapped.verdict !== got.verdict || swapped.scale !== got.scale) {
    throw new Error(
      `page ${p.page} changes verdict when its box is swapped (${got.verdict} → ${swapped.verdict}), ` +
        `so the ceilings in src/lib/canvas.ts are no longer symmetric and this fixture's assumption is stale`,
    );
  }
}

/** A page that is unmistakably painted: a border inset from the edge and one diagonal. */
const contentFor = (width, height) => {
  const inset = Math.max(4, Math.round(Math.min(width, height) / 40));
  const line = Math.max(2, Math.round(Math.min(width, height) / 300));
  return [
    `${line} w`,
    `${inset} ${inset} ${width - 2 * inset} ${height - 2 * inset} re S`,
    `${inset} ${inset} m ${width - inset} ${height - inset} l S`,
    `${inset} ${Math.round(height / 2)} m ${width - inset} ${Math.round(height / 2)} l S`,
  ].join('\n');
};

const CATALOG = 1;
const PAGES_OBJ = 2;
const PAGE_BASE = 3;
const CONTENT_BASE = PAGE_BASE + PAGES.length;
const size = CONTENT_BASE + PAGES.length;

const objects = new Array(size + 1).fill(null);
objects[CATALOG] = `<< /Type /Catalog /Pages ${PAGES_OBJ} 0 R >>`;
objects[PAGES_OBJ] =
  `<< /Type /Pages /Count ${PAGES.length} /Kids [` +
  PAGES.map((p) => `${PAGE_BASE + p.page - 1} 0 R`).join(' ') +
  '] >>';

for (const p of PAGES) {
  const pageNo = PAGE_BASE + p.page - 1;
  const contentNo = CONTENT_BASE + p.page - 1;
  objects[pageNo] =
    `<< /Type /Page /Parent ${PAGES_OBJ} 0 R /MediaBox [0 0 ${p.width} ${p.height}]` +
    ` /Contents ${contentNo} 0 R >>`;
  objects[contentNo] = { stream: contentFor(p.width, p.height) };
}

let pdf = '%PDF-1.4\n';
const offsets = new Array(size + 1).fill(0);
for (let num = 1; num <= size; num++) {
  const obj = objects[num];
  if (!obj) continue;
  offsets[num] = pdf.length;
  if (typeof obj === 'string') {
    pdf += `${num} 0 obj\n${obj}\nendobj\n`;
  } else {
    pdf += `${num} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
  }
}

const xrefStart = pdf.length;
pdf += `xref\n0 ${size + 1}\n0000000000 65535 f \n`;
for (let num = 1; num <= size; num++) {
  pdf += offsets[num] ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
}
pdf += `trailer\n<< /Size ${size + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, 'playground', 'fixtures', 'oversize-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');

console.log(
  `wrote ${out} (${pdf.length} bytes)\n` +
    PAGES.map((p) => {
      const got = verdictFor(p.width, p.height);
      return (
        `  page ${p.page}: ${p.width}x${p.height} -> ${got.verdict}` +
        `${got.limitedBy ? ` by ${got.limitedBy}` : ''}` +
        `${got.limitedBy ? `, scale ${got.scale}x of the ${minScale}x minimum` : ''}`
      );
    }).join('\n'),
);
