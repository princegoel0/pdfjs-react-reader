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
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFSignature, degrees } from '@cantoo/pdf-lib';
import { boxToPage, isSignable, signatureContent } from './signature';
import type { BoxPoint, PageRect, SignatureStyle } from './signature';

/** The bytes the viewer is showing, with whatever the reader has already changed. */
export type PdfBytes = Uint8Array;

/** One signature field, or one widget of one, as the file declares it. */
export interface PdfSignatureField {
  /** The field's name, which is how a mark is addressed back to it. */
  name: string;
  /**
   * Which page holds the widget, 0-based, or `null` when the file lists the widget nowhere
   * it can be found — a widget with no `/P` and no page that names it, which happens.
   */
  page: number | null;
  /** `/Rect` in PDF user space: `[x0, y0, x1, y1]`, y up. */
  rect: PageRect;
  /**
   * Whether the widget's dictionary carries the spec's `NoRotate` bit, reported as what the
   * file says and nothing more.
   *
   * It was expected to matter: `SignatureWidgetAnnotation` sets `hasOwnCanvas = noRotate`, and
   * an appearance on that path is rendered into a separate canvas the application has to
   * collect through `annotationCanvasMap`, which `PdfPage` passes as `null`. Measured against
   * the box in `signature-sample.pdf` that declares `/F 20`, pdf.js reported both `noRotate`
   * and `hasOwnCanvas` false and the mark painted like the others — so the own-canvas route
   * was never reached, and whether it can be is untested. Do not build on either reading.
   */
  noRotate: boolean;
  /** False for a field no one has ever drawn in — which is the usual case. */
  hasAppearance: boolean;
  /**
   * Whether the field holds a `/V`, which on a `/Sig` field is a signature value: the bytes
   * of who signed, when, and over what range. `signFields` refuses these, because drawing a
   * mark over one leaves a document that still claims to be cryptographically signed and no
   * longer is.
   */
  alreadySigned: boolean;
}

/** A mark to write: which field, and the path in that page's user space. */
export interface PdfSignatureMark {
  field: string;
  /**
   * The mark relative to its box, 0–1 with y up — which is what `padToBox` gives back.
   *
   * Relative rather than absolute because a field may be displayed in more than one box, and
   * each of them gets the same mark scaled to fit it.
   */
  points: BoxPoint[];
  style?: SignatureStyle;
}

export interface PdfSignResult {
  bytes: PdfBytes;
  /** Each widget that received a mark, so a field signed in two places is reported twice. */
  signed: string[];
  /** Marks the file holds no field for. Nothing is written for these, and nothing pretends otherwise. */
  refused: string[];
}

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
  const doc = await loadForWriting(bytes);
  const fields = doc.getForm().getFields();
  const fieldsRemoved = fields.length;
  /* An empty form is a real answer, not a failure: a document with no fields has
     nothing to flatten, and the caller deciding "flatten before printing" deserves to
     know the file was already flat rather than getting a silently unchanged copy. */
  if (fieldsRemoved > 0) {
    giveUnsignedSignatureWidgetsAnAppearance(doc);
    doc.getForm().flatten();
  }
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, fieldsRemoved, hadNoForm: fieldsRemoved === 0 };
}

/*
 * A signature box that was never signed has no appearance, and the writer's flatten
 * asks every widget for one: `findWidgetAppearanceRef` reaches `getNormalAppearance`,
 * finds no `/N`, and throws `Unexpected N type: undefined`. Measured on
 * `signature-sample.pdf`, which means **flattening any form with an ordinary empty
 * signature field fails** — not an edge case, since a blank signature box is what an
 * unsigned document looks like. Text and choice fields are unaffected because the
 * writer can compose an appearance for those from the value and the default style.
 *
 * So each signature widget that has no `/N` is given one: an empty form in its own box.
 * The flatten then has something to move into the page, finds nothing to draw, and the
 * field is removed like any other — which is the right outcome, because an unsigned
 * box is not content and the reader asked for the interactivity to go.
 */
function giveUnsignedSignatureWidgetsAnAppearance(doc: PDFDocument): void {
  for (const field of doc.getForm().getFields()) {
    if (!(field instanceof PDFSignature)) continue;
    for (const widget of signatureWidgets(doc, field)) {
      if (hasNormalAppearance(doc, widget)) continue;
      const rect = rectOf(doc, widget) ?? [0, 0, 0, 0];
      const empty = doc.context.register(
        doc.context.stream('', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: doc.context.obj([...rect]),
          Resources: {},
        }),
      );
      widget.set(PDFName.of('AP'), doc.context.obj({ N: empty }));
    }
  }
}

/**
 * Every writer pass in this module starts here, so the one flag that decides whether an
 * encrypted file is readable at all is stated once rather than per function.
 */
async function loadForWriting(bytes: PdfBytes): Promise<PDFDocument> {
  return PDFDocument.load(toArrayBuffer(bytes), { ignoreEncryption: true });
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
  const doc = await loadForWriting(bytes);
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

/*
 * ---------------------------------------------------------------------------
 * Signatures
 * ---------------------------------------------------------------------------
 *
 * The PRD's in-scope half of signing is a drawn mark written into a `/Sig` field's
 * appearance stream, and that is exactly what these two functions do. What they
 * deliberately do not do is sign anything: no `/V` value is ever written, because a
 * `/V` on a `/Sig` field is a cryptographic claim, and every reader that sees one
 * without a matching `/ByteRange` will tell the user the signature is invalid. The
 * mark is a picture of a signature, in the same sense a stamp is, and the docs say so.
 *
 * Two shapes have to be handled because files arrive both ways: the field *is* the
 * widget annotation, and the field is a parent whose `/Kids` name the widgets. The
 * second is what Acrobat writes for a form signed in more than one place, and the
 * appearance belongs on the kid, not on the parent.
 */

/** Every widget dictionary in the file mapped to the page that lists it in `/Annots`. */
function annotOwners(doc: PDFDocument): Map<PDFDict, number> {
  const owners = new Map<PDFDict, number>();
  doc.getPages().forEach((page, index) => {
    const raw = page.node.get(PDFName.of('Annots'));
    if (!raw) return;
    const list = doc.context.lookup(raw, PDFArray);
    for (const entry of list?.asArray() ?? []) {
      const dict = doc.context.lookup(entry, PDFDict);
      if (dict) owners.set(dict, index);
    }
  });
  return owners;
}

/** The widget dictionaries of one signature field, in the shape the file uses. */
function signatureWidgets(doc: PDFDocument, field: PDFSignature): PDFDict[] {
  const dict = field.acroField.dict;
  const kids = dict.get(PDFName.of('Kids'));
  if (!kids) return [dict];
  const list = doc.context.lookup(kids, PDFArray);
  const widgets: PDFDict[] = [];
  for (const entry of list?.asArray() ?? []) {
    const kid = doc.context.lookup(entry, PDFDict);
    if (kid) widgets.push(kid);
  }
  // A parent whose /Kids resolves to nothing has no box to draw in; the parent itself is
  // then the annotation, which is the first shape rather than a failure.
  return widgets.length ? widgets : [dict];
}

function rectOf(doc: PDFDocument, widget: PDFDict): PageRect | null {
  const raw = widget.get(PDFName.of('Rect'));
  const list = raw ? doc.context.lookup(raw, PDFArray) : undefined;
  if (!list || list.size() < 4) return null;
  const numbers = list.asArray().map((n) => Number(String(n)));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!];
}

/** A number a dictionary holds, whether it sits there directly or behind a reference. */
function numberOf(doc: PDFDocument, raw: PDFObject | undefined): number {
  if (!raw) return 0;
  const value = Number(String(doc.context.lookup(raw)));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Whether a signature value is present, on the widget or on the field behind it — the spec
 * allows `/V` on either, and a file that puts it on one is not obliged to repeat it on the
 * other.
 */
function hasSignatureValue(doc: PDFDocument, field: PDFSignature, widget: PDFDict): boolean {
  if (widget.get(PDFName.of('V'))) return true;
  const parent = field.acroField.dict.get(PDFName.of('Parent'));
  if (parent && doc.context.lookup(parent, PDFDict)?.get(PDFName.of('V'))) return true;
  return Boolean(field.acroField.dict.get(PDFName.of('V')));
}

/** Whether the widget already carries the appearance a viewer would paint. */
function hasNormalAppearance(doc: PDFDocument, widget: PDFDict): boolean {
  const raw = widget.get(PDFName.of('AP'));
  if (!raw) return false;
  // `/N` is a stream for most fields and a dictionary of states for a button; either
  // counts, because the question this answers is "is there something in this box".
  return Boolean(doc.context.lookup(raw, PDFDict)?.get(PDFName.of('N')));
}

/**
 * Where a reader could sign this document.
 *
 * Returned in file order, and once per widget: a field that is signed in two places
 * appears twice, because those are two boxes the reader has to see and choose between.
 *
 * A field with no `/Rect`, or one whose four numbers do not add up, is left out rather than
 * reported with a zero box: there is no mark that could be placed in it.
 */
export async function findSignatureFields(bytes: PdfBytes): Promise<PdfSignatureField[]> {
  const doc = await loadForWriting(bytes);
  const owners = annotOwners(doc);
  const out: PdfSignatureField[] = [];
  for (const field of doc.getForm().getFields()) {
    if (!(field instanceof PDFSignature)) continue;
    const name = field.getName();
    for (const widget of signatureWidgets(doc, field)) {
      const rect = rectOf(doc, widget);
      if (!rect) continue;
      out.push({
        name,
        page: owners.get(widget) ?? null,
        rect,
        // The spec's NoRotate bit, and the only annotation flag that changes how this renders.
        noRotate: (numberOf(doc, widget.get(PDFName.of('F'))) & 0x10) !== 0,
        hasAppearance: hasNormalAppearance(doc, widget),
        alreadySigned: hasSignatureValue(doc, field, widget),
      });
    }
  }
  return out;
}

/**
 * Write a drawn mark into the named signature fields and return the new file.
 *
 * The appearance is written in page coordinates, with `/BBox` set to the widget's own
 * `/Rect`, which is what lets a path recorded in the same space be written without any
 * translation — and it is the same space `lib/ink.ts` already stores strokes in.
 *
 * A mark whose field is not in the file is refused rather than dropped quietly, and a
 * request that writes nothing does not re-save the document: the bytes that come back
 * are then the bytes that went in.
 */
export async function signFields(bytes: PdfBytes, marks: PdfSignatureMark[]): Promise<PdfSignResult> {
  const wanted = marks.filter((mark) => isSignable(mark.points));
  const doc = await loadForWriting(bytes);
  const fields = doc
    .getForm()
    .getFields()
    .filter((field): field is PDFSignature => field instanceof PDFSignature);

  const signed: string[] = [];
  const written = new Set<string>();
  for (const mark of wanted) {
    const field = fields.find((candidate) => candidate.getName() === mark.field);
    // Refused rather than overwritten: a `/V` is somebody's claim about the document, and a
    // picture drawn into the same box makes that claim false without saying so.
    if (!field || hasSignatureValue(doc, field, field.acroField.dict)) continue;
    written.add(mark.field);
    for (const widget of signatureWidgets(doc, field)) {
      const rect = rectOf(doc, widget);
      if (!rect) continue;
      const content = signatureContent(boxToPage(mark.points, rect), mark.style);
      // A box with no area has nowhere to put a mark, and an empty stream would be a
      // field that looks signed and paints nothing.
      if (!content) continue;
      const stream = doc.context.stream(content, {
        Type: 'XObject',
        Subtype: 'Form',
        // Page coordinates, so the mark arrives where the form's author drew the box.
        BBox: doc.context.obj([...rect]),
        Resources: {},
      });
      widget.set(PDFName.of('AP'), doc.context.obj({ N: doc.context.register(stream) }));
      signed.push(mark.field);
    }
  }

  const refused = marks.filter((mark) => !written.has(mark.field)).map((mark) => mark.field);
  if (!signed.length) return { bytes, signed, refused };
  return { bytes: await doc.save({ useObjectStreams: false }), signed, refused };
}
