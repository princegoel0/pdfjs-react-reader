/**
 * The one module in the package that touches the PDF writer.
 *
 * `@cantoo/pdf-lib` is an **optional peer**: a host that never imports
 * `pdfjs-react-reader/edit` neither installs it nor pays for it, so this file is the
 * only place its name appears. Everything crossing the boundary is bytes and plain
 * objects — no writer types in any public signature — because a `.d.ts` that mentions
 * an uninstalled package breaks `tsc` for the host that made the correct choice.
 *
 * Why the fork rather than `pdf-lib`: measured in `0.7`'s Spike B, the two are
 * equivalent on every operation this tier needs, and the fork is the one still
 * maintained (published 2026-09-15 against upstream's 2022-05-12) for code that parses
 * files from untrusted sources. It costs 73 kB more gzipped, which is why the tier is
 * opt-in rather than part of the shell.
 *
 * The ordering rule that Spike B discovered lives here as a comment on `flattenBytes`:
 * a document assembled by copying pages carries its widget annotations but not its
 * `AcroForm`, so flattening one of those quietly does nothing. Spike C added the second
 * rule this module obeys: a page move is a permutation of the page tree, never
 * `removePage()` followed by `insertPage()`, because removal deletes the object.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, degrees } from '@cantoo/pdf-lib';

/** The bytes the viewer is showing, with whatever the reader has already changed. */
export type PdfBytes = Uint8Array;

export interface PdfPageArrangement {
  /**
   * Which pages the file should hold, as indices into the document as loaded, in the order
   * they should appear. A reordered array moves pages; an array that leaves some out deletes
   * them. It cannot be empty: a document with no pages is not a document.
   */
  order: number[];
  /**
   * Absolute `/Rotate` values in degrees, keyed by the same load-time indices. A page that
   * appears nowhere in the map keeps the rotation it already has.
   *
   * The keys name the page as it was when the arrangement came in, not as it ends up, so a
   * caller can say "the page the reader rotated" without tracking where the move put it.
   */
  rotations?: Record<number, number>;
}

export interface PdfArrangeResult {
  bytes: PdfBytes;
  /** Pages in the file that came back, which is `order.length`. */
  pages: number;
  /** Pages the order left out, so a caller can say what a move cost. */
  removed: number;
}

export interface PdfFlattenResult {
  bytes: PdfBytes;
  /** Field count before the flatten ran, which is what "nothing was flattened" shows up as. */
  fieldsRemoved: number;
  /** True when `fieldsRemoved` was 0, i.e. the document had no interactive form. */
  hadNoForm: boolean;
}

/**
 * Make the form's current values part of the page, and drop the interactivity.
 *
 * `flatten()` moves each widget's appearance stream into the page's own content and
 * removes the field objects, which is what makes the output read the same in every
 * viewer and print without a form layer — and it is not a rasterise, so text stays text.
 * Measured on `form-sample.pdf`: the filled value goes from a widget to page text
 * (13 → 19 text spans through pdf.js) with the page's nine widgets gone, while
 * `Highlight` and `Link` annotations on the *other* page survive.
 *
 * Run this on a document that still owns its form. Copying pages into a fresh
 * `PDFDocument` loses the `AcroForm`, and flattening the result removes nothing at all.
 */
export async function flattenBytes(bytes: PdfBytes): Promise<PdfFlattenResult> {
  const doc = await PDFDocument.load(toArrayBuffer(bytes), { ignoreEncryption: true });
  const fields = doc.getForm().getFields();
  const fieldsRemoved = fields.length;
  /* An empty form is a real answer, not a failure: a document with no fields has
     nothing to flatten, and the caller deciding "flatten before printing" deserves to
     know the file was already flat rather than getting a silently unchanged copy. */
  if (fieldsRemoved > 0) doc.getForm().flatten();
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, fieldsRemoved, hadNoForm: fieldsRemoved === 0 };
}

/** `pdf-lib` will not accept a `Uint8Array` view that is offset into a larger buffer. */
function toArrayBuffer(bytes: PdfBytes): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Put the pages in a new order, drop the ones the reader removed, and write their rotations
 * into the file.
 *
 * One call, one load and save, because an arrangement is a single intent: the page list the
 * reader ended up with plus how each of those pages should sit. `order` is the whole of it —
 * reordering and deleting are the same operation on a list that happens to be shorter.
 */
export async function arrangePages(
  bytes: PdfBytes,
  arrangement: PdfPageArrangement,
): Promise<PdfArrangeResult> {
  const doc = await PDFDocument.load(toArrayBuffer(bytes), { ignoreEncryption: true });
  const total = doc.getPageCount();
  const order = arrangement.order;
  if (order.length === 0) throw new Error('a PDF must keep at least one page');

  const kept = new Set<number>();
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      throw new Error(`page ${index} is not one of this document's ${total} pages`);
    }
    if (kept.has(index)) throw new Error(`page ${index} is asked for twice`);
    kept.add(index);
  }

  /*
   * Rotation is a property of the page object rather than of its position, so it is written
   * against the indices the caller already has and then travels with the page. Measured on
   * `page-order-sample.pdf`: the page carrying `/Rotate 90` kept both the flag and its 792x612
   * viewport after moving to a different slot.
   */
  if (arrangement.rotations) {
    const pages = doc.getPages();
    for (const [key, angle] of Object.entries(arrangement.rotations)) {
      const page = pages[Number(key)];
      if (page) page.setRotation(degrees(normaliseAngle(angle)));
    }
  }

  // Descending, so each removal still addresses the page it means.
  let removed = 0;
  for (let index = total - 1; index >= 0; index -= 1) {
    if (kept.has(index)) continue;
    doc.removePage(index);
    removed += 1;
  }

  const survivors = [...kept].sort((a, b) => a - b);
  permutePageTree(doc, order.map((original) => survivors.indexOf(original)));

  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, pages: order.length, removed };
}

/*
 * The move itself is a permutation of the page tree's `/Kids` array, and that is the whole
 * design decision behind it: `removePage()` followed by `insertPage()` is the API that reads
 * like a move, but removal ends with `context.delete(page.ref)`, so the handle it handed back
 * names a dictionary the writer no longer holds. Measured, the result is a tree whose first kid
 * is an object absent from the file — a blank or missing page, with `/Count`, `getPageCount()`
 * and the saved tree all agreeing that the document has all its pages. Permuting `/Kids` deletes
 * nothing, which is also why a form's fields, an outline's destinations and a link's target keep
 * naming the page they were written against: after a measured move, the outline entry for page 1
 * resolved to its new slot 2 rather than to the slot it used to occupy.
 */
function permutePageTree(doc: PDFDocument, order: number[]): void {
  if (order.length < 2) return;
  const tree = doc.context.lookup(doc.catalog.get(PDFName.of('Pages')), PDFDict);
  const kidsEntry = tree.get(PDFName.of('Kids'));
  if (!kidsEntry) throw new Error('the page tree has no /Kids array');
  const kids = doc.context.lookup(kidsEntry, PDFArray);
  const current = kids.asArray();
  if (current.length !== order.length) {
    throw new Error(`the page tree holds ${current.length} pages, the order names ${order.length}`);
  }
  const refs = order.map((index) => {
    const ref = current[index];
    if (!ref) throw new Error(`page ${index} is not in the page tree`);
    return ref;
  });
  tree.set(PDFName.of('Kids'), doc.context.obj(refs));
  tree.set(PDFName.of('Count'), doc.context.obj(order.length));
}

/** `/Rotate` only means quarter turns, and the writer rejects a plain number as well as an odd angle. */
function normaliseAngle(angle: number): number {
  const normalised = ((Math.round(angle) % 360) + 360) % 360;
  if (normalised % 90 !== 0) {
    throw new Error(`a page rotation must be a multiple of 90 degrees, got ${angle}`);
  }
  return normalised;
}
