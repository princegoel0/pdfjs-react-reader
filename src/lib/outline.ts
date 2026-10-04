import type { PDFDocumentProxy } from 'pdfjs-dist';

/** The destination kinds a `/Dest` may name, from the PDF specification's table of display modes. */
export type DestinationKind =
  | 'XYZ'
  | 'Fit'
  | 'FitH'
  | 'FitV'
  | 'FitB'
  | 'FitBH'
  | 'FitBV'
  | 'FitR'
  /** Anything the writer called something else. A click still lands on the page. */
  | 'Unknown';

/**
 * Where a destination says to land, in the page's own default user space.
 *
 * A destination is `[page, /XYZ, left, top, zoom]`, and the three trailing values are what make a bookmark a
 * *place* rather than a page: a link to "Chapter 4" that means the middle of a page says so here. The units
 * are unscaled PDF points with the origin at the page's **bottom-left**, which is the opposite way round to a
 * scroll container — so these numbers mean nothing until a page viewport turns them into an offset, and that
 * is why they travel with the entry instead of being resolved to pixels at parse time.
 *
 * A `null` is not missing information: the specification spells it "leave whatever the reader has". For a
 * click that means the top of the page, which is what a viewer with nothing to go on does.
 */
export interface PdfDestinationPosition {
  kind: DestinationKind;
  left: number | null;
  top: number | null;
  /**
   * The magnification the destination asks for, as a factor. `null` when it asks for none — including a
   * `/XYZ` whose zoom is `0`, which the specification defines as "keep the current zoom" rather than "zoom to
   * nothing", and a viewer that applied it would make the page disappear.
   */
  zoom: number | null;
}

export interface OutlineEntry {
  title: string;
  /** 0-based target page, or null when the item has no local destination. */
  pageIndex: number | null;
  /** Where on that page the item points, or null when there is no page to point at. */
  position: PdfDestinationPosition | null;
  children: OutlineEntry[];
  /** PDF /Count < 0 means the viewer should start with this node collapsed. */
  collapsed: boolean;
}

/**
 * The page target extracted from a resolved destination array. Mirrors pdf.js's
 * own link handling (web/pdf_viewer.mjs): a plain integer is a 0-based page
 * index, while a `{ num, gen }` object is a PDF *object reference* that must be
 * translated — object numbers are not page numbers.
 *
 * Every form carries the position the rest of the array names, because a caller that wanted the page also
 * wanted the place.
 */
export type DestinationRef =
  | { kind: 'index'; index: number; position: PdfDestinationPosition }
  | { kind: 'proxy'; num: number; gen: number; position: PdfDestinationPosition };

const numberAt = (dest: unknown[], index: number): number | null => {
  const value = dest[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * The trailing three of `[page, /XYZ, left, top, zoom]`, read the way each display mode means them.
 *
 * `/FitH` and `/FitBH` carry their one number as a vertical position; `/FitV` and `/FitBV` carry it
 * horizontally; `/FitR` carries a rectangle whose fourth value is the top. The `B` variants fit the page's
 * *bounding box* rather than its media box, which changes what the scale resolves to but not which axis the
 * number belongs to.
 */
export function parseDestinationPosition(dest: unknown[]): PdfDestinationPosition {
  const raw = dest[1];
  const name =
    typeof raw === 'string'
      ? raw
      : raw !== null && typeof raw === 'object' && 'name' in raw
        ? String((raw as { name: unknown }).name)
        : '';
  const zoom = numberAt(dest, 4);
  switch (name) {
    case 'XYZ':
      return { kind: 'XYZ', left: numberAt(dest, 2), top: numberAt(dest, 3), zoom: zoom !== null && zoom > 0 ? zoom : null };
    case 'Fit':
    case 'FitB':
      return { kind: name, left: null, top: null, zoom: null };
    case 'FitH':
    case 'FitBH':
      return { kind: name, left: null, top: numberAt(dest, 2), zoom: null };
    case 'FitV':
    case 'FitBV':
      return { kind: name, left: numberAt(dest, 2), top: null, zoom: null };
    case 'FitR':
      return { kind: 'FitR', left: numberAt(dest, 2), top: numberAt(dest, 5), zoom: null };
    default:
      return { kind: 'Unknown', left: null, top: null, zoom: null };
  }
}

export function parseDestination(dest: unknown): DestinationRef | null {
  if (!Array.isArray(dest) || dest.length === 0) return null;
  const position = parseDestinationPosition(dest as unknown[]);
  const ref = dest[0];
  if (Number.isInteger(ref) && (ref as number) >= 0) {
    return { kind: 'index', index: ref as number, position };
  }
  if (
    ref !== null &&
    typeof ref === 'object' &&
    'num' in ref &&
    typeof (ref as { num: unknown }).num === 'number'
  ) {
    const gen = (ref as { gen?: unknown }).gen;
    return {
      kind: 'proxy',
      num: (ref as { num: number }).num,
      gen: typeof gen === 'number' ? gen : 0,
      position,
    };
  }
  return null;
}

/** Resolves a destination to a 0-based page index, or null when unresolvable. */
export async function resolveDestinationPageIndex(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  const found = await resolveDestination(doc, dest);
  return found ? found.pageIndex : null;
}

/**
 * A destination as the two things a click needs: which page, and where on it.
 *
 * `resolveDestinationPageIndex` stays the name for a caller that only wants the page — it is stable and
 * published, and the page really is the half that is always known. This is the same walk with the position
 * kept, because a bookmark that names a place and lands at the top of the page has thrown half of itself
 * away, and the reader cannot tell that the document said more.
 */
export async function resolveDestination(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<{ pageIndex: number; position: PdfDestinationPosition } | null> {
  const parsed = parseDestination(dest);
  if (!parsed) return null;
  if (parsed.kind === 'index') return { pageIndex: parsed.index, position: parsed.position };
  const proxy = { num: parsed.num, gen: parsed.gen };
  const cached = doc.cachedPageNumber(proxy);
  // cachedPageNumber is 1-based, getPageIndex is 0-based; both answer the same question.
  if (typeof cached === 'number') return { pageIndex: cached - 1, position: parsed.position };
  try {
    const index = await doc.getPageIndex(proxy);
    return index === null || index === undefined ? null : { pageIndex: index, position: parsed.position };
  } catch {
    return null;
  }
}
