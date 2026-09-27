// Generates playground/fixtures/long-sample.pdf — one thousand pages, for the
// performance bar `PRD.md:22` states and `0.8` has to measure:
//   * a **nested page tree** (leaves of ten, a level of groups, one root), because
//     that is what a real producer writes for a document this size and what a flat
//     `/Kids` of a thousand entries would let the engine off the hook for —
//     `/Parent` chains, intermediate `/Count`s and tree descent all get exercised
//   * page sizes that vary on a fixed pattern, so no single measured height can be
//     reused for every slot by a virtualizer that caches the first page's box
//   * two lines of text per page, one of them a marker unique to that page, so a
//     whole-document search has to read all thousand streams and can be checked
//     against a known total
//   * nothing else. No outline, no links, no annotations, no form: the question is
//     what a thousand pages cost to open, index and paint, and every extra structure
//     would answer a different question with the same number.
//
// Written by hand for the same reason the other fixtures are — a generator that adds
// structure we did not ask for makes an unexpected measurement impossible to
// interpret. Nothing here is decorative.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNT = 1000;
const LEAF_SIZE = 10;
const CATALOG = 1;
const FONT = 2;
// Object numbers are dense on purpose. The xref table carries one 20-byte entry for
// every number up to the highest one, so a sparse layout — pages at 1000, streams at
// 100 000, nodes at 1 100 000 — cost 22 MB of padding for a 400 kB document.
const PAGE_BASE = FONT + 1;
const CONTENT_BASE = PAGE_BASE + COUNT;
const NODE_BASE = CONTENT_BASE + COUNT;

/** A 1-based page number's object number. */
const pageObj = (page) => PAGE_BASE + page;
const contentObj = (page) => CONTENT_BASE + page;

/**
 * The page boxes cycle through three shapes on a pattern with no factor in common
 * with the leaf size, so a page's box and its position inside its parent node are
 * independent — a virtualizer that assumes "all pages are the height of page 1"
 * cannot be right for a whole document by luck.
 */
function boxFor(page) {
  const shape = page % 3;
  if (shape === 0) return [0, 0, 612, 792];
  if (shape === 1) return [0, 0, 792, 612];
  return [0, 0, 595, 842];
}

const objects = new Map();

function line(text, y, size = 12) {
  const escaped = text.replace(/[\\()]/g, (ch) => `\\${ch}`);
  return `BT /F1 ${size} Tf 1 0 0 1 72 ${y} Tm (${escaped}) Tj ET`;
}

// ---- pages ----
for (let page = 1; page <= COUNT; page++) {
  const box = boxFor(page);
  objects.set(
    pageObj(page),
    `<< /Type /Page /Parent 0 0 R /MediaBox [${box.join(' ')}]` +
      ` /Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${contentObj(page)} 0 R >>`,
  );
  objects.set(contentObj(page), {
    stream: [
      line(`Page ${page} of ${COUNT}`, box[3] - 120, 24),
      line(`LONGMARK-${String(page).padStart(4, '0')} unique to this page`, box[3] - 160, 12),
    ].join('\n'),
  });
}

// ---- the page tree, bottom up ----
// Ten pages per leaf, ten children per group, so a thousand pages sit three levels
// below the root. Every node is written once its own parent is known, because a
// `/Parent` guessed at construction time is how a tree like this ends up lying.
const leaves = [];
for (let start = 1; start <= COUNT; start += LEAF_SIZE) {
  const end = Math.min(start + LEAF_SIZE - 1, COUNT);
  leaves.push({ num: NODE_BASE + leaves.length + 1, from: start, to: end, pages: end - start + 1 });
}

// The leaves first: a group can only rewrite a child's `/Parent` once that child
// exists, and the grouping loop below walks up from here.
for (const leaf of leaves) {
  const pages = [];
  for (let page = leaf.from; page <= leaf.to; page++) pages.push(pageObj(page));
  const kids = pages.map((num) => `${num} 0 R`);
  // `/Parent 0 0 R` is a placeholder the grouping loop replaces.
  objects.set(leaf.num, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${leaf.pages} /Parent 0 0 R >>`);
  for (const page of pages) {
    const body = objects.get(page);
    objects.set(page, body.replace('/Parent 0 0 R', `/Parent ${leaf.num} 0 R`));
  }
}

let nextNode = NODE_BASE + leaves.length + 1;
let level = leaves;
let depth = 0;
let upperNodes = 0;
while (level.length > 1) {
  const groups = [];
  for (let i = 0; i < level.length; i += LEAF_SIZE) {
    const children = level.slice(i, i + LEAF_SIZE);
    groups.push({
      num: nextNode++,
      children,
      pages: children.reduce((total, node) => total + node.pages, 0),
    });
  }
  upperNodes += groups.length;
  for (const group of groups) {
    // The group names itself as its parent until a higher level corrects it, which
    // also covers the topmost group — whose placeholder is stripped below.
    objects.set(
      group.num,
      `<< /Type /Pages /Kids [${group.children.map((c) => `${c.num} 0 R`).join(' ')}]` +
        ` /Count ${group.pages} /Parent ${group.num} 0 R >>`,
    );
    for (const child of group.children) {
      const body = objects.get(child.num);
      objects.set(child.num, body.replace(/\/Parent \d+ 0 R/, `/Parent ${group.num} 0 R`));
    }
  }
  level = groups;
  depth += 1;
}
const ROOT = level[0].num;

// The root has no parent: the catalog's /Pages *is* the root of the tree.
objects.set(ROOT, objects.get(ROOT).replace(/\/Parent \d+ 0 R/, ''));
objects.set(CATALOG, `<< /Type /Catalog /Pages ${ROOT} 0 R >>`);
objects.set(FONT, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

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
    pdf += `${num} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
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
// The rule every fixture obeys: a document pdf.js misreads is worse than none,
// because a measurement taken on it blames the code under test. Here that matters
// more than usual — a broken tree on a thousand pages would look like a slow viewer.
const problems = [];

for (const [num, body] of objects) {
  const text = typeof body === 'string' ? body : `${body.dict ?? ''} ${body.stream}`;
  for (const ref of text.matchAll(/(\d+) 0 R/g)) {
    if (!objects.has(Number(ref[1]))) problems.push(`object ${num} references missing ${ref[1]} 0 R`);
  }
}

/** `/Kids` of one node, as object numbers. */
const kidsOf = (num) => {
  const body = objects.get(num);
  const match = typeof body === 'string' ? /\/Kids \[([^\]]*)\]/.exec(body) : null;
  return [...(match?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
};
const countOf = (num) => Number(/\/Count (\d+)/.exec(objects.get(num))?.[1] ?? NaN);

// Every page is named by exactly one node, and its /Parent names that node back.
const seen = new Map();
for (const leaf of leaves) {
  for (const page of kidsOf(leaf.num)) {
    seen.set(page, (seen.get(page) ?? 0) + 1);
    const body = objects.get(page);
    if (!body.includes(`/Parent ${leaf.num} 0 R`)) problems.push(`page ${page} does not point back at leaf ${leaf.num}`);
    if (!body.includes('/Type /Page ')) problems.push(`object ${page} is not a /Type /Page`);
  }
  if (countOf(leaf.num) !== kidsOf(leaf.num).length) {
    problems.push(`leaf ${leaf.num}: /Count ${countOf(leaf.num)} disagrees with its ${kidsOf(leaf.num).length} children`);
  }
}
if (seen.size !== COUNT) problems.push(`the tree reaches ${seen.size} pages, not ${COUNT}`);
for (const [page, times] of seen) if (times > 1) problems.push(`page ${page} is listed by ${times} nodes`);

// Every node's /Count is the sum of what its children report, and the tree is
// reached from exactly one root. This is the check that matters on a document this
// size: an off-by-one in an intermediate /Count is invisible on 20 pages and is the
// kind of thing a viewer would read as "the document has N pages".
const isNode = (num) => typeof objects.get(num) === 'string' && objects.get(num).includes('/Type /Pages');
const parents = new Map();
for (const num of [...objects.keys()].filter(isNode)) {
  for (const child of kidsOf(num)) {
    parents.set(child, (parents.get(child) ?? []).concat(num));
    if (!objects.get(child).includes(`/Parent ${num} 0 R`)) {
      problems.push(`child ${child} is named by node ${num}, which it does not name as its parent`);
    }
  }
  const total = kidsOf(num).reduce((sum, child) => sum + (isNode(child) ? countOf(child) : 1), 0);
  if (total !== countOf(num)) problems.push(`node ${num}: /Count ${countOf(num)} but its children hold ${total}`);
}
for (const [child, listedBy] of parents) {
  if (listedBy.length > 1) problems.push(`object ${child} is a child of ${listedBy.length} nodes`);
}
if (parents.has(ROOT)) problems.push('the root is itself a child — the tree has a level above it');
if (objects.get(ROOT).includes('/Parent')) problems.push('the root names a parent, but the catalog points straight at it');
if (countOf(ROOT) !== COUNT) problems.push(`the root claims /Count ${countOf(ROOT)}, not ${COUNT}`);
const nodes = [...objects.keys()].filter(isNode);
if (nodes.length !== leaves.length + upperNodes) {
  problems.push(`${nodes.length} /Pages nodes were built, expected ${leaves.length} leaves + ${upperNodes} above them`);
}
if (objects.get(CATALOG).includes(`/Pages ${ROOT} 0 R`) === false) {
  problems.push('the catalog does not point at the root');
}

for (let num = 1; num < size; num++) {
  if (!offsets[num]) continue;
  if (!pdf.startsWith(`${num} 0 obj\n`, offsets[num])) problems.push(`xref offset for ${num} points at the wrong bytes`);
}

const out = join(root, 'playground', 'fixtures', 'long-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
if (problems.length) {
  console.error(`refusing to write ${out}:\n  ${[...new Set(problems)].slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
writeFileSync(out, pdf, 'latin1');
console.log(
  `wrote ${out} (${pdf.length} bytes, ${COUNT} pages, ${leaves.length} leaves + ${depth} upper level(s), root ${ROOT}, depth ${depth + 2})`,
);
