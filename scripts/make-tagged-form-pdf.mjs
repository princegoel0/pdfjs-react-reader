// Generates playground/fixtures/tagged-form-sample.pdf: a tagged one-page document whose two text fields are
// *inside* the structure tree — one with an `/Alt` on its owning element, one without.
//
// This exists because FR-43's annotation clause names a widget and every measurement in the repository was a
// link. `tagged-sample.pdf` carries exactly one annotation (a `/Link`), which is what `enableLinkOwnership` is
// written for, so ownership is proven for the annotation the file has and a form field inside marked content is
// still unmeasured (that is FR-43's third gap, and `form-sample.pdf` cannot answer it either: it declares fields
// and no structure tree). The clause's own words are "a widget is announced with its owning node rather than as
// an unlabelled control", and the only way to find out whether pdf.js delivers that is a file that has both
// halves at once.
//
// What the engine does with them was read before this file was written, and it is the reason both cases are
// here. `StructTreeLayerBuilder.#setAttributes` (`web/pdf_viewer.mjs`) walks a structure element that carries
// `/Alt`, and for every kid of type `annotation` it puts `aria-label` — the `/Alt`, verbatim — into the table
// `AnnotationLayer` then asks for by annotation id. So the owning node *does* name a widget, when the producer
// wrote an `/Alt`. And `enableLinkOwnership` is computed as `contentElement.localName === "a"`, so the
// `aria-owns` path is a link's and never a widget's: the two mechanisms are different, and only one file with
// one field and one link can say which is which.
//
// Field A therefore carries `/Alt (Reviewer name)` on its `/Form` element — the engine's path. Field B carries
// none, and its widget declares no `/TU` either, so pdf.js has nothing to name it with: the shell's own pass
// (`src/lib/annotation-names.ts`, #267) is what puts a name on it, from the field name the engine already wrote
// onto `name`. That pair is the claim worth guarding: a producer who labelled the field gets its label used, and
// one who did not gets a control the reader can still name — and neither path overwrites the other.
//
// The marked-content spellings are copied from `make-tagged-pdf.mjs` and its lessons, because each of the ways
// they can be wrong is silent in a reader: `BDC` with one operand is skipped by pdf.js entirely, an integer kid
// with no `/Pg` on its element drops the mark while still reporting the role, an annotation's `/StructParent`
// must map to a single element and not an array, and an `/OBJR` with no matching ref in the page's `/Annots`
// retypes into nothing. The checks at the bottom refuse to write a file where any of those has gone wrong.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DA = '/F1 10 Tf 0 g';

/**
 * The two fields. `mcid` is the mark the field's own value is drawn with, `caption` is the paragraph that
 * precedes it, and `alt` is what the owning `/Form` element says about the widget — present on one, deliberately
 * absent on the other.
 */
const FIELDS = [
  {
    name: 'reviewerName',
    value: 'Ada Lovelace',
    caption: 'Reviewer name:',
    alt: 'Reviewer name',
    y: 660,
  },
  {
    name: 'reviewerComments',
    value: 'looks fine',
    caption: 'Comments:',
    y: 610,
  },
];

/* ------------------------------------------------------------------ *
 * Object allocation — same discipline as the tagged generator: reserve the number, fill the body later.
 * ------------------------------------------------------------------ */

const objects = [];
const alloc = (body) => {
  objects.push(body);
  return objects.length;
};

const escapeText = (text) => String(text).replace(/([\\()])/g, '\\$1');

const CATALOG = alloc(null);
const PAGES_DICT = alloc(null);
const FONT = alloc('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
const DOCUMENT_ELEMENT = alloc(null);
const ACRO_FORM = alloc(null);

/** Marks, laid out top to bottom: the heading, then caption + field value per field. */
const marks = [{ mcid: 0, text: 'Tagged form fixture', size: 20, font: 'F2', y: 720 }];
let nextMcid = 1;
for (const field of FIELDS) {
  field.captionMark = { mcid: nextMcid++, text: field.caption, size: 12, font: 'F1', y: field.y };
  field.valueMark = { mcid: nextMcid++, text: field.value, size: 10, font: 'F1', y: field.y - 1 };
  marks.push(field.captionMark, field.valueMark);
}

/**
 * Draw one mark. The property list is written inline rather than as the `/MCn` name key into `/Properties`,
 * because measured against the installed engine the name-key form reaches `getTextContent` unresolved, the
 * marked-content item carries no `id`, and an `aria-owns` then points at a span that was never written.
 */
const markFor = (leaf) =>
  `BX /MC${leaf.mcid} << /MCID ${leaf.mcid} >> BDC\n` +
  `BT /${leaf.font} ${leaf.size} Tf 72 ${leaf.y} Td (${escapeText(leaf.text)}) Tj ET\n` +
  'EMC';

/*
 * The widgets. `/F 4` is the PRINT flag (the same reason `form-sample.pdf` carries it: without it pdf.js's
 * `Annotation.printable` is false and the worker drops the field from the print operator list). Neither field
 * declares `/TU`, so nothing on the annotation itself can name it — that is the hole the two paths fill.
 */
for (const field of FIELDS) {
  field.structParent = 1; // the page owns 0; the fields take 1 and 2, assigned below
  field.annotRef = alloc(
    `<< /Type /Annot /Subtype /Widget /F 4 /FT /Tx /T (${field.name}) /V (${field.value}) ` +
      `/DA (${DA}) /Rect [200 ${field.y - 4} 360 ${field.y + 14}] /P 0 R >>`,
  );
}
FIELDS.forEach((field, index) => {
  field.structParent = index + 1;
  // `/P` has to name the page, and the page does not exist yet — it is patched after allocation.
  objects[field.annotRef - 1] = objects[field.annotRef - 1].replace(
    '/P 0 R',
    `/P __PAGE__ 0 R /StructParent ${field.structParent}`,
  );
});

const content = alloc({
  stream: marks.map(markFor).join('\n'),
});

const pageRef = alloc(
  `<< /Type /Page /Parent ${PAGES_DICT} 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 ${FONT} 0 R /F2 ${FONT} 0 R >> >> ` +
    `/Properties << ${marks.map((leaf) => `/MC${leaf.mcid} ${alloc(`<< /MCID ${leaf.mcid} >>`)} 0 R`).join(' ')} >> ` +
    `/Contents ${content} 0 R ` +
    `/Annots [${FIELDS.map((f) => `${f.annotRef} 0 R`).join(' ')}] /StructParents 0 >>`,
);
objects.forEach((body, i) => {
  if (typeof body === 'string' && body.includes('__PAGE__')) {
    objects[i] = body.replace(/__PAGE__/g, String(pageRef));
  }
});

/*
 * The elements. Each field is one `/Form` element whose kids are the annotation (`/OBJR`) and the words the
 * field paints (`/MCR`) — the same pairing the link case needs, and for the same reason: the `OBJR` alone binds
 * no text, the `MCR` alone is a mark with no annotation to ask about.
 *
 * The caption is a `P` element holding its own mark, and the field element sits beside it inside a `Div` so the
 * two are siblings under one parent — the shape a producer writes when a label and its field belong together.
 * A widget's owning node is its `/Form` element, and that is the node `#setAttributes` reads `/Alt` from.
 */
const fieldElements = FIELDS.map((field) => {
  const ref = alloc(null);
  field.elementRef = ref;
  objects[ref - 1] =
    `<< /Type /StructElem /S /Form /P __PARENT__ 0 R /Pg ${pageRef} 0 R` +
    `${field.alt ? ` /Alt (${escapeText(field.alt)})` : ''} ` +
    `/K [<< /Type /OBJR /Obj ${field.annotRef} 0 R /Pg ${pageRef} 0 R >> ` +
    `<< /Type /MCR /MCID ${field.valueMark.mcid} /Pg ${pageRef} 0 R >>] >>`;
  return ref;
});

const captionElements = FIELDS.map((field) => {
  const ref = alloc(null);
  objects[ref - 1] =
    `<< /Type /StructElem /S /P /P __PARENT__ 0 R /Pg ${pageRef} 0 R ` +
    `/K [${field.captionMark.mcid}] >>`;
  return ref;
});

const headingRef = alloc(
  `<< /Type /StructElem /S /H1 /P ${DOCUMENT_ELEMENT} 0 R /Pg ${pageRef} 0 R /K [${marks[0].mcid}] >>`,
);
/**
 * The group's kids are authored **in reading order** — a caption and then the field that follows it — because the
 * tree's order is what a reader hears, and it is also the order the content stream opens its marks. Listing all
 * the captions first would still be a valid tree and would make the pairing assertion below a set comparison in
 * disguise: the marks are the same five either way, and only their order says whether the tree walks the page.
 */
const groupRef = alloc(null);
const inReadingOrder = FIELDS.flatMap((field, index) => [captionElements[index], fieldElements[index]]);
objects[groupRef - 1] =
  `<< /Type /StructElem /S /Div /P ${DOCUMENT_ELEMENT} 0 R ` +
  `/K [${inReadingOrder.map((ref) => `${ref} 0 R`).join(' ')}] >>`;
objects[DOCUMENT_ELEMENT - 1] =
  `<< /Type /StructElem /S /Document /K [${headingRef} 0 R ${groupRef} 0 R] >>`;
// The grouping element's own kids name their parent, which is the group and not the document.
for (const ref of captionElements.concat(fieldElements)) {
  objects[ref - 1] = objects[ref - 1].replace('__PARENT__', String(groupRef));
}

/*
 * `/ParentTree`: the page's key maps to an array of the elements reached by marked content that is *not* an
 * annotation's, and each annotation's `/StructParent` maps to its single `/Form` element. Writing an array
 * under a `/StructParent` hands pdf.js a non-dictionary and the element is dropped silently.
 *
 * The field elements are deliberately kept out of the page's array: they are reached through their
 * annotation's `/StructParent`, and visiting one twice loses the retype that makes it an annotation kid.
 */
const parentTreePairs = [
  [0, [headingRef, ...captionElements]],
  ...FIELDS.map((field) => [field.structParent, field.elementRef]),
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

objects[ACRO_FORM - 1] =
  `<< /Fields [${FIELDS.map((f) => `${f.annotRef} 0 R`).join(' ')}] ` +
  `/DR << /Font << /F1 ${FONT} 0 R >> >> >>`;
objects[CATALOG - 1] =
  `<< /Type /Catalog /Pages ${PAGES_DICT} 0 R /MarkInfo << /Marked true >> /Lang (en-US) ` +
  `/StructTreeRoot ${STRUCT_ROOT} 0 R /AcroForm ${ACRO_FORM} 0 R >>`;
objects[PAGES_DICT - 1] =
  `<< /Type /Pages /Kids [${pageRef} 0 R] /Count 1 >>`;

/* ------------------------------------------------------------------ *
 * Checks: every failure below produces a file that opens fine and tests nothing.
 * ------------------------------------------------------------------ */

const mcids = marks.map((leaf) => leaf.mcid).sort((a, b) => a - b);
mcids.forEach((mcid, index) => {
  if (mcid !== index) {
    throw new Error(
      `/ParentTree is indexed by position, so a gap in ${mcids.join(' ')} silently drops the text of every mark after it`,
    );
  }
});
const stream = objects[content - 1].stream;
const begins = (stream.match(/BX \/MC(\d+) << \/MCID \1 >> BDC/g) ?? []).length;
const ends = (stream.match(/\bEMC\b/g) ?? []).length;
if (begins !== ends || begins !== marks.length) {
  throw new Error(`${begins} well-formed BDC begins, ${ends} EMC ends, ${marks.length} marks`);
}
for (const field of FIELDS) {
  const element = objects[field.elementRef - 1];
  const annot = objects[field.annotRef - 1];
  if (!element.includes(`/Obj ${field.annotRef} 0 R`)) {
    throw new Error(`the /Form element for "${field.name}" has no OBJR kid naming its widget`);
  }
  if (!element.includes(`/MCID ${field.valueMark.mcid}`)) {
    throw new Error(`the /Form element for "${field.name}" binds no mark, so it owns no words`);
  }
  if (!annot.includes(`/StructParent ${field.structParent}`)) {
    throw new Error(`the widget "${field.name}" names no StructParent its element can be found at`);
  }
  if (!annot.includes(`/P ${pageRef} 0 R`)) {
    throw new Error(`the widget "${field.name}" is on no page, so the annotation layer never sees it`);
  }
  if (!objects[pageRef - 1].includes(`${field.annotRef} 0 R`)) {
    throw new Error(`the widget "${field.name}" is in no /Annots, so it is in the tree but never rendered`);
  }
  if (!parentTreePairs.some(([key, refs]) => key === field.structParent && refs === field.elementRef)) {
    throw new Error(`StructParent ${field.structParent} is not the widget's single element, so it is unreachable`);
  }
  if (!element.includes(`/Pg ${pageRef} 0 R`)) {
    throw new Error(`the /Form element for "${field.name}" has no /Pg, and pdf.js drops a mark without it`);
  }
}
if (!objects[pageRef - 1].includes(`/Contents ${content} 0 R`)) {
  // The check that this file needed once already: a page with no content stream opens, paints its widgets, binds
  // every mark in its tree, and has no text at all — so the tree half of every assertion reads back perfect.
  throw new Error('the page names no content stream, so its marks exist only in the tree');
}
if (!objects[ACRO_FORM - 1].includes('/Fields')) throw new Error('the catalog declares no field list');
if (FIELDS.filter((f) => f.alt).length !== 1 || FIELDS.filter((f) => !f.alt).length !== 1) {
  throw new Error('this file exists to hold exactly one /Alt-named field and one unnamed-by-the-producer field');
}

let pdf = '%PDF-1.4\n';
const offsets = new Array(objects.length + 1).fill(0);
for (let num = 1; num <= objects.length; num++) {
  const obj = objects[num - 1];
  if (obj === null || obj === undefined) throw new Error(`object ${num} was never filled in`);
  if (typeof obj === 'string' && obj.includes('__PARENT__')) throw new Error(`object ${num} has no resolved /P`);
  offsets[num] = pdf.length;
  pdf +=
    typeof obj === 'string'
      ? `${num} 0 obj\n${obj}\nendobj\n`
      : `${num} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
}

const xrefStart = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let num = 1; num <= objects.length; num++) {
  pdf += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, 'playground', 'fixtures', 'tagged-form-sample.pdf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, 'latin1');
console.log(
  `wrote ${out} (${pdf.length} bytes) — 1 page, ${marks.length} marks, ` +
    `2 widgets (${FIELDS.map((f) => `${f.name}${f.alt ? ' with /Alt' : ' no /Alt'}`).join(', ')})`,
);
