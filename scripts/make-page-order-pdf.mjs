// Generates playground/fixtures/page-order-sample.pdf — twenty pages whose whole
// purpose is to make a page-index bug impossible to hide, for `0.7`'s page editing:
//   * display order and object order are a permutation of each other, so code that
//     treats `pageNum` as an object number, or /Kids index as an object ordering,
//     cannot produce the right answer by luck
//   * every page prints its own 1-based position *and* its object number, so a
//     reorder is read back from the text layer rather than guessed from a thumbnail
//   * four pages are landscape, so the layout math has to re-measure each slot
//     instead of assuming one height for twenty
//   * page 5 carries /Rotate 90, so rotation has to travel with the page
//   * three outline entries and two /Link annotations point at page *objects*, which
//     is what a reordering tool either preserves or silently breaks
//
// Written by hand for the same reason the other fixtures are: a generator that adds
// structure we did not ask for makes an unexpected measurement impossible to
// interpret. Nothing here is decorative.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = 20;
const CATALOG = 1;
const PAGE_TREE = 2;
const FONT = 3;
const OUTLINE = 40;
const OUTLINE_NAMES = 50;
// 7 and 20 are coprime, so this is a bijection onto 0..19: every page gets a
// distinct object number, and none of them is in display order.
const pageObj = (index) => 200 + ((index * 7) % COUNT);
const contentObj = (index) => 400 + index;
const LANDSCAPE = new Set([3, 8, 13, 18]);
const ROTATED = 5;

const objects = new Map();

/** One line of Helvetica text, positioned by baseline. */
function line(text, x, y, size = 12) {
  return `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
}

function escapePdfText(text) {
  return text.replace(/[\\()]/g, (ch) => `\\${ch}`);
}

// ---- catalog, page tree, font ----
const kids = [];
for (let i = 1; i <= COUNT; i++) kids.push(`${pageObj(i)} 0 R`);
objects.set(CATALOG, `<< /Type /Catalog /Pages ${PAGE_TREE} 0 R /Outlines ${OUTLINE} 0 R /Names << /Dests ${OUTLINE_NAMES} 0 R >> >>`);
objects.set(PAGE_TREE, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${COUNT} >>`);
objects.set(FONT, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

// ---- pages ----
// y=500 is inside both boxes (792 tall and 612 tall), so one coordinate serves the
// portrait and the landscape pages alike. The marker string is unique per page,
// which is what a text-layer oracle keys off.
const LINKS = { 1: 20, 10: 2 };
for (let i = 1; i <= COUNT; i++) {
  const box = LANDSCAPE.has(i) ? [0, 0, 792, 612] : [0, 0, 612, 792];
  const annots = i in LINKS ? ` /Annots [${600 + i} 0 R]` : '';
  objects.set(
    pageObj(i),
    `<< /Type /Page /Parent ${PAGE_TREE} 0 R /MediaBox [${box.join(' ')}]` +
      `${i === ROTATED ? ' /Rotate 90' : ''}` +
      ` /Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentObj(i)} 0 R${annots} >>`,
  );
  objects.set(contentObj(i), {
    // A plain content stream, not a Form XObject: `/Type /XObject` on a page's
    // /Contents is legal-looking but off-spec, and a fixture meant to make an
    // unexpected reading interpretable cannot start from one.
    stream: [
      line(`Page ${String(i).padStart(2, '0')} of ${COUNT}`, 72, 540, 28),
      line(`Object ${pageObj(i)} in display slot ${i}`, 72, 500, 14),
      line(`MARKER-${String(i).padStart(2, '0')} is unique to this page`, 72, 470, 14),
      line(`Box ${box[2]} by ${box[3]}`, 72, 440, 12),
      i === 1
        ? line('The next page is reached by a link, and by the outline entry below.', 72, 400, 12)
        : line('This page is reached from an outline entry or a link on another page.', 72, 400, 12),
    ].join('\n'),
  });
}

// ---- links: a /Dest to a page object, not to an index ----
for (const [from, to] of Object.entries(LINKS)) {
  objects.set(
    600 + Number(from),
    `<< /Type /Annot /Subtype /Link /F 4 /Rect [72 380 372 396] /Border [0 0 1] ` +
      `/C [0 0 1] /Dest [${pageObj(to)} 0 R /XYZ null null null] >>`,
  );
}

// ---- outline: three entries, each keyed to a page object ----
// 1 -> 10 -> 20 as a chain, so a reordering tool that rebuilds /Kids has to keep
// /First, /Last, /Prev and /Next pointing at the same pages they did before.
const outlineSlots = [
  { num: OUTLINE + 1, title: '1. Opening (page 01)', target: 1 },
  { num: OUTLINE + 2, title: '2. Middle (page 10)', target: 10 },
  { num: OUTLINE + 3, title: '3. Ending (page 20)', target: 20 },
  // Resolution by name is a different code path from resolution by reference, and
  // the engine may hand the shell a string or an already-resolved array. Which of
  // the two it does decides whether this row is followable at all, so the fixture
  // asks the question rather than assuming the answer.
  { num: OUTLINE + 4, title: '4. Middle again, by name', dest: '/middle' },
];
outlineSlots.forEach((entry, i) => {
  const prev = i > 0 ? `/Prev ${outlineSlots[i - 1].num} 0 R ` : '';
  const next = i < outlineSlots.length - 1 ? `/Next ${outlineSlots[i + 1].num} 0 R ` : '';
  const dest = entry.dest
    ? `/Dest ${entry.dest}`
    : `/Dest [${pageObj(entry.target)} 0 R /XYZ null null null]`;
  objects.set(
    entry.num,
    `<< /Title (${escapePdfText(entry.title)}) /Parent ${OUTLINE} 0 R ${prev}${next}${dest} >>`,
  );
});
objects.set(
  OUTLINE,
  `<< /Type /Outlines /First ${OUTLINE + 1} 0 R /Last ${OUTLINE + outlineSlots.length} 0 R ` +
    `/Count ${outlineSlots.length} >>`,
);
// A named destination too, because resolution by name is a separate code path in
// the library from resolution by direct reference.
objects.set(OUTLINE_NAMES, `<< /Names [(middle) [${pageObj(10)} 0 R /Fit]] >>`);

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
    const head = obj.dict ? `${obj.dict} /Length ${obj.stream.length}` : `/Length ${obj.stream.length}`;
    pdf += `${num} 0 obj\n<< ${head} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
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
pdf += `trailer\n<< /Size ${size} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

// ---- self-check ----
// The same rule as every other fixture here: a document pdf.js misreads is worse
// than none, because a measurement taken on it blames the code under test.
const problems = [];

for (const num of objects.keys()) {
  const body = objects.get(num);
  const text = typeof body === 'string' ? body : `${body.dict ?? ''} ${body.stream}`;
  for (const ref of text.matchAll(/(\d+) 0 R/g)) {
    if (!objects.has(Number(ref[1]))) problems.push(`object ${num} references missing ${ref[1]} 0 R`);
  }
}

for (let i = 1; i <= COUNT; i++) {
  const num = pageObj(i);
  const page = objects.get(num);
  if (!page.includes(`/Parent ${PAGE_TREE} 0 R`)) problems.push(`page ${num} is not a child of the tree`);
  if (!page.includes(`/Contents ${contentObj(i)} 0 R`)) problems.push(`page ${num} points at the wrong stream`);
  if (typeof objects.get(contentObj(i)) !== 'object') problems.push(`page ${num}'s content is not a stream`);
}
const declaredKids = (/\/Kids \[([^\]]*)\]/.exec(objects.get(PAGE_TREE))?.[1] ?? '').match(/\d+ 0 R/g) ?? [];
if (declaredKids.length !== COUNT) problems.push(`/Kids holds ${declaredKids.length} pages, the loop made ${COUNT}`);
if (new Set(declaredKids).size !== COUNT) problems.push('/Kids repeats a page object, so two slots are one page');
if (!objects.get(PAGE_TREE).includes(`/Count ${declaredKids.length} `)) {
  problems.push('/Count disagrees with the /Kids array');
}

for (let num = 1; num < size; num++) {
  if (!offsets[num]) continue;
  if (!pdf.startsWith(`${num} 0 obj\n`, offsets[num])) problems.push(`xref offset for ${num} points at the wrong bytes`);
}

const out = join(root, 'playground', 'fixtures', 'page-order-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
if (problems.length) {
  console.error(`refusing to write ${out}:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes, ${COUNT} pages, objects ${kids.join(', ')})`);
