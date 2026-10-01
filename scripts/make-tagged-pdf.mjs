// Generates playground/fixtures/tagged-sample.pdf: two pages whose content is *marked*, with a
// `/StructTreeRoot` that maps each mark back to a role.
//
// This exists because `FR-43` could not otherwise be measured. `page.getStructTree()` answers `null` for
// every other fixture in the directory — none declares `/MarkInfo`, a structure tree, or one marked content
// section — so every claim about what the structure layer costs or adds would be a claim about an empty
// tree. Same shape as `FR-12` before `make-labelled-pdf.mjs`: the missing artifact, not the missing code,
// is what blocks the assertion.
//
// The roles are the ones a screen reader actually announces, not a survey of the spec: a heading, a
// paragraph, a list with items, a table with a header row and body cells, a figure carrying `/Alt`, and a
// link whose words are bound to the annotation they are drawn under. The last is the one `FR-43`'s
// annotation clause needs: pdf.js's annotation layer asks the structure tree for the `aria-owns` or
// `aria-label` of the element it just built, keyed by the annotation's own id, and there is no such
// question to ask of a file with no annotation in its tree.
//
// The checks at the bottom refuse to write a file whose marks and tree disagree, because each of the four
// ways this goes wrong is silent in a reader rather than loud: an integer kid with no entry at that index
// in the page's `/ParentTree` array just loses its text; a `/StructParents` missing from the number tree
// loses the whole page; a `/P` that does not point back at its parent orphans an element that a walk
// starting at the root never reaches; and a `BDC` written with one operand instead of two is skipped by
// pdf.js altogether, which leaves a tree that reads back complete and a text layer with nothing in it to
// bind to. That last one is not hypothetical — it is how the first version of this file was written, and
// the only thing that caught it was a browser pass, because every assertion above it still passed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The document. `mcid` is the marked-content id a leaf is drawn with; the grouping roles (`L`, `Table`,
 * `TR`) carry no mark of their own, exactly as a real producer writes them.
 */
const DOCUMENT = [
  {
    blocks: [
      { role: 'H1', mcid: 0, text: 'Quarterly report', size: 24, font: 'F2' },
      { role: 'P', mcid: 1, text: 'Revenue rose twelve per cent across three regions.', size: 12, font: 'F1' },
      {
        role: 'L',
        children: [
          { role: 'LI', mcid: 2, text: '- North: 1,204', size: 12, font: 'F1' },
          { role: 'LI', mcid: 3, text: '- South: 902', size: 12, font: 'F1' },
          { role: 'LI', mcid: 4, text: '- East: 655', size: 12, font: 'F1' },
        ],
      },
      // The link half. A `/Link` structure element whose kids are both the annotation and the words it is
      // drawn over is what pdf.js's annotation layer asks the tree about: it hands `getAriaAttributes` the
      // id of the `<a>` it just built and takes back `aria-owns` (the words) or `aria-label` (an `/Alt`).
      // Without an annotation in the tree there is no such thing to ask, which is why this file had none.
      {
        role: 'P',
        children: [
          {
            role: 'Link',
            mcid: 5,
            text: 'See the annual statement',
            size: 12,
            font: 'F1',
            link: 'https://example.com/annual-statement',
          },
        ],
      },
    ],
  },
  {
    blocks: [
      {
        role: 'Figure',
        mcid: 0,
        alt: 'A bar chart of revenue by region, north highest',
        text: '[chart: north 1,204 / south 902 / east 655]',
        size: 12,
        font: 'F1',
      },
      {
        role: 'Table',
        children: [
          {
            role: 'TR',
            children: [
              { role: 'TH', mcid: 1, text: 'Region', size: 12, font: 'F2', x: 72 },
              { role: 'TH', mcid: 2, text: 'Revenue', size: 12, font: 'F2', x: 252 },
            ],
          },
          {
            role: 'TR',
            children: [
              { role: 'TD', mcid: 3, text: 'North', size: 12, font: 'F1', x: 72 },
              { role: 'TD', mcid: 4, text: '1,204', size: 12, font: 'F1', x: 252 },
            ],
          },
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Object allocation. `alloc` reserves a slot and returns its number, so a parent can be numbered before
 * its children exist and still be named by them.
 * ------------------------------------------------------------------ */

const objects = [];
const alloc = (body) => {
  objects.push(body);
  return objects.length;
};

const escapeText = (text) => text.replace(/([\\()])/g, '\\$1');
const leaves = (nodes) => nodes.flatMap((node) => (node.children ? leaves(node.children) : [node]));

/** Running `/StructParent` key for link annotations, which must not collide with a page's own key. */
let linkParentsSeen = 0;

const CATALOG = alloc(null);
const PAGES_DICT = alloc(null);
const FONT_REGULAR = alloc(
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
);
const FONT_BOLD = alloc(
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
);
const DOCUMENT_ELEMENT = alloc(null);

/**
 * Draw one leaf, wrapped in the marked content that binds it to its element.
 *
 * The property list is written inline, and not as the `/MC0` name key into the page's `/Properties` that a
 * real producer also supplies: measured against the installed engine, the name-key form reaches
 * `getTextContent` unresolved, so the marked-content item carries no `id`, and the tree's `aria-owns` then
 * points at a span that was never written. `BMC` (no property list at all) is the third legal spelling and
 * the one with no `MCID` to bind by. Writing the file is the easy half; the spelling is the whole test.
 */
function markFor(leaf) {
  const x = leaf.x ?? 72;
  return (
    `BX /MC${leaf.mcid} << /MCID ${leaf.mcid} >> BDC\n` +
    `BT /${leaf.font} ${leaf.size} Tf ${x} ${leaf.y} Td (${escapeText(leaf.text)}) Tj ET\n` +
    'EMC'
  );
}

/** Lay a page out top to bottom, then flatten the tree the same blocks describe. */
const pages = DOCUMENT.map((page, pageIndex) => {
  let y = 720;
  for (const block of page.blocks) {
    for (const leaf of leaves([block])) {
      leaf.y = y;
      y -= leaf.size + 10;
    }
    y -= 10;
  }

  const marked = leaves(page.blocks);
  const properties = marked.map((leaf) => alloc(`<< /MCID ${leaf.mcid} >>`));
  marked.forEach((leaf, index) => {
    leaf.propertyRef = properties[index];
  });

  /*
   * One link annotation per linked leaf, allocated before the page so `/Annots` can name it.
   *
   * `/StructParent` is the number-tree key the annotation's own structure element lives at, and it has to
   * be a key the *page* does not use — `/StructParents` already owns 0 and 1 here, and a page's array is
   * walked first, so an element reachable only through a shared key would be consumed by that walk and
   * never retyped into an annotation kid.
   */
  const links = marked.filter((leaf) => leaf.link);
  links.forEach((leaf, index) => {
    leaf.structParent = DOCUMENT.length + linkParentsSeen++;
    const x = leaf.x ?? 72;
    const width = leaf.text.length * leaf.size * 0.5;
    leaf.annotRef = alloc(
      `<< /Type /Annot /Subtype /Link /Rect [${x} ${leaf.y - 3} ${x + width} ${leaf.y + 12}] ` +
        `/Border [0 0 0] /StructParent ${leaf.structParent} ` +
        `/A << /S /URI /URI (${leaf.link}) >> >>`,
    );
  });

  const content = alloc({ stream: marked.map(markFor).join('\n') });
  const pageRef = alloc(
    `<< /Type /Page /Parent ${PAGES_DICT} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${FONT_REGULAR} 0 R /F2 ${FONT_BOLD} 0 R >> >> ` +
      `/Properties << ${marked.map((leaf) => `/MC${leaf.mcid} ${leaf.propertyRef} 0 R`).join(' ')} >> ` +
      (links.length
        ? `/Annots [${links.map((leaf) => `${leaf.annotRef} 0 R`).join(' ')}] `
        : '') +
      `/StructParents ${pageIndex} /Contents ${content} 0 R >>`,
  );
  return { pageIndex, pageRef, content, blocks: page.blocks, marked, links };
});

/** Every leaf's structure element is recorded on the leaf itself, as `elementRef`. */

/**
 * Emit one `/StructElem`, reserving its number first so children can name it as their `/P`. Returns the
 * object number; `mcidToRef` collects the leaf bindings this page needs in `/ParentTree`.
 *
 * A leaf carries `/Pg` as well as its integer kid. The spec lets a reader infer the page from
 * `/ParentTree`, and pdf.js does not: `parseKid` returns null for an integer kid when the element's own
 * `/Pg` is not the page it is walking, so without it every mark is dropped — silently, with the roles all
 * still reading back correctly, which is the failure this generator exists to make impossible.
 */
function emitElement(node, parentRef, pageRef) {
  const ref = alloc(null);
  if (node.children) {
    const kids = node.children.map((child) => emitElement(child, ref, pageRef));
    objects[ref - 1] = `<< /Type /StructElem /S /${node.role} /P ${parentRef} 0 R ` +
      `/K [${kids.map((kid) => `${kid} 0 R`).join(' ')}] >>`;
  } else if (node.link) {
    // An annotation kid is an `/OBJR` naming the annotation, beside the `/MCR` naming the words. pdf.js
    // retypes the OBJR into an annotation only when the ref matches one collected from the page's `/Annots`,
    // so both halves have to be here: the OBJR alone binds no text, and the MCR alone is a mark with no
    // link, which is the shape the annotation layer would find nothing to ask about.
    node.elementRef = ref;
    objects[ref - 1] = `<< /Type /StructElem /S /Link /P ${parentRef} 0 R /Pg ${pageRef} 0 R ` +
      `/K [<< /Type /OBJR /Obj ${node.annotRef} 0 R /Pg ${pageRef} 0 R >> ` +
      `<< /Type /MCR /MCID ${node.mcid} /Pg ${pageRef} 0 R >>] >>`;
  } else {
    node.elementRef = ref;
    objects[ref - 1] = `<< /Type /StructElem /S /${node.role} /P ${parentRef} 0 R ` +
      `/Pg ${pageRef} 0 R${node.alt ? ` /Alt (${escapeText(node.alt)})` : ''} /K [${node.mcid}] >>`;
  }
  return ref;
}

const documentKids = pages.flatMap((page) =>
  page.blocks.map((block) => emitElement(block, DOCUMENT_ELEMENT, page.pageRef)),
);
objects[DOCUMENT_ELEMENT - 1] =
  `<< /Type /StructElem /S /Document /K [${documentKids.map((ref) => `${ref} 0 R`).join(' ')}] >>`;

/*
 * The page entries carry only the elements reached by marked content. A link element is reached by its
 * annotation's `/StructParent` instead, and putting it in both places loses the annotation binding: the
 * page walk visits it first, and the second visit returns nothing for the caller to retype kids on.
 *
 * The two kinds of key are written differently, and pdf.js is not forgiving about it: a page's
 * `/StructParents` maps to an *array* of elements, while an annotation's `/StructParent` maps to a single
 * element. `StructTreePage.parse` iterates the first and passes the second straight to `addNode`, so an
 * array there is handed over as a non-dictionary and the element is dropped — silently, with the rest of
 * the tree intact.
 */
const parentTreePairs = [
  ...pages.map((page) => [
    page.pageIndex,
    page.marked.filter((leaf) => !leaf.link).map((leaf) => leaf.elementRef),
  ]),
  ...pages.flatMap((page) => page.links.map((leaf) => [leaf.structParent, leaf.elementRef])),
].sort((a, b) => a[0] - b[0]);

const nums = parentTreePairs
  .map(([key, refs]) =>
    Array.isArray(refs)
      ? `${key} [${refs.map((ref) => `${ref} 0 R`).join(' ')}]`
      : `${key} ${refs} 0 R`,
  )
  .join(' ');

const highestKey = Math.max(...parentTreePairs.map(([key]) => key));
const PARENT_TREE = alloc(`<< /Nums [${nums}] >>`);
const STRUCT_ROOT = alloc(
  `<< /Type /StructTreeRoot /K ${DOCUMENT_ELEMENT} 0 R /ParentTree ${PARENT_TREE} 0 R ` +
    `/ParentTreeNextKey ${highestKey + 1} >>`,
);

objects[CATALOG - 1] =
  `<< /Type /Catalog /Pages ${PAGES_DICT} 0 R /MarkInfo << /Marked true >> /Lang (en-US) ` +
  `/StructTreeRoot ${STRUCT_ROOT} 0 R >>`;
objects[PAGES_DICT - 1] =
  `<< /Type /Pages /Kids [${pages.map((p) => `${p.pageRef} 0 R`).join(' ')}] /Count ${pages.length} >>`;

/* ------------------------------------------------------------------ *
 * Checks: every one of these failures produces a file that opens fine and tests nothing.
 * ------------------------------------------------------------------ */

for (const page of pages) {
  const mcids = page.marked.map((leaf) => leaf.mcid).sort((a, b) => a - b);
  if (new Set(mcids).size !== mcids.length) {
    throw new Error(`page ${page.pageIndex} reuses a marked-content id: ${mcids.join(' ')}`);
  }
  mcids.forEach((mcid, index) => {
    if (mcid !== index) {
      throw new Error(
        `page ${page.pageIndex} has ids ${mcids.join(' ')}; /ParentTree is indexed by position, ` +
          'so a gap silently drops the text of every mark after it',
      );
    }
  });
  for (const leaf of page.marked) {
    if (!leaf.elementRef) {
      throw new Error(`mark ${leaf.mcid} on page ${page.pageIndex} is in no structure element`);
    }
  }
  const stream = page.content && objects[page.content - 1].stream;
  // `BDC` takes two operands — a tag and a property list — and pdf.js skips the whole marked section when
  // it is given one, which is how this file was written once already: the tree read back perfectly, the
  // text layer had no marks to bind to, and the only thing that noticed was a browser console.
  const begin = (stream.match(/BX \/MC(\d+) << \/MCID \1 >> BDC/g) ?? []).length;
  const end = (stream.match(/\bEMC\b/g) ?? []).length;
  if (begin !== end || begin !== page.marked.length) {
    throw new Error(
      `page ${page.pageIndex}: ${begin} well-formed begins, ${end} ends, ${page.marked.length} marks`,
    );
  }
  // Every leaf element must name its page, or pdf.js drops the mark while still reporting the role.
  const withPage = page.marked.filter(
    (leaf) => objects[leaf.elementRef - 1].includes(`/Pg ${page.pageRef} 0 R`),
  ).length;
  if (withPage !== page.marked.length) {
    throw new Error(
      `page ${page.pageIndex}: ${page.marked.length - withPage} structure elements have no /Pg, ` +
        'and pdf.js silently ignores their marks without it',
    );
  }
  /*
   * The link half, checked as a three-way agreement. An annotation that is in the tree but not on the page
   * is never rendered, and one that is on the page but whose `/StructParent` has no number-tree entry reads
   * back as an ordinary link with nothing to ask the tree about — both leave the roles and the marks intact,
   * which is the shape of every silent failure this generator has had to be taught about.
   */
  for (const leaf of page.links) {
    const annot = objects[leaf.annotRef - 1];
    if (!annot.includes(`/StructParent ${leaf.structParent}`)) {
      throw new Error(`the link "${leaf.text}" names no StructParent its element can be found at`);
    }
    if (!objects[page.pageRef - 1].includes(`${leaf.annotRef} 0 R`)) {
      throw new Error(`page ${page.pageIndex}: the link annotation ${leaf.annotRef} R is in no /Annots`);
    }
    if (!parentTreePairs.some(([key, refs]) => key === leaf.structParent && refs === leaf.elementRef)) {
      throw new Error(
        `StructParent ${leaf.structParent} does not map to the /Link element, so it is unreachable`,
      );
    }
    if (!objects[leaf.elementRef - 1].includes(`/Obj ${leaf.annotRef} 0 R`)) {
      throw new Error(`the /Link element for "${leaf.text}" has no OBJR kid naming its annotation`);
    }
  }
}

let pdf = '%PDF-1.4\n';
const offsets = new Array(objects.length + 1).fill(0);
for (let num = 1; num <= objects.length; num++) {
  const obj = objects[num - 1];
  if (obj === null || obj === undefined) throw new Error(`object ${num} was never filled in`);
  offsets[num] = pdf.length;
  pdf += typeof obj === 'string'
    ? `${num} 0 obj\n${obj}\nendobj\n`
    : `${num} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
}

const xrefStart = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let num = 1; num <= objects.length; num++) {
  pdf += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, 'playground', 'fixtures', 'tagged-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(`wrote ${out} (${pdf.length} bytes)`);
console.log(
  `pages ${pages.length} · marks ${pages.reduce((n, p) => n + p.marked.length, 0)} · ` +
    `elements ${documentKids.length} + their descendants · objects ${objects.length}`,
);
