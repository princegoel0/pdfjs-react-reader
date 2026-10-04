/** A point in PDF user space (unscaled, origin bottom-left). */
export interface PdfPoint {
  x: number;
  y: number;
}

/** A point in CSS pixels within the rendered page box. */
export interface ViewportPoint {
  x: number;
  y: number;
}

export interface PageDims {
  width: number;
  height: number;
}

/** Numeric zoom factor, or an automatic mode resolved against the viewport. */
export type ScaleMode = 'fit-width' | 'fit-page' | 'automatic' | number;

/**
 * Which fit mode `automatic` means for a page of these dimensions.
 *
 * A portrait page is fitted by width, because a text column wants the whole
 * horizontal run and the reader is already scrolling vertically. A landscape
 * page is fitted as a whole, since fitting a wide page by width pushes its
 * bottom off screen and turns one page into three scrolls. Orientation is read
 * after the user's rotation, so a turned page is treated as the shape the
 * reader actually sees; a square page takes width.
 */
export function automaticFitMode(dims: PageDims): 'fit-width' | 'fit-page' {
  return dims.width > dims.height ? 'fit-page' : 'fit-width';
}

export const DEFAULT_PAGE_ESTIMATE: PageDims = { width: 612, height: 792 };

/** Returns page dims at scale 1 with `extraRotation` (degrees, user-applied) applied. */
export function applyRotation(dims: PageDims, extraRotation: number): PageDims {
  const normalized = ((extraRotation % 360) + 360) % 360;
  return normalized % 180 !== 0
    ? { width: dims.height, height: dims.width }
    : dims;
}

export function scaledPageSize(
  dims: PageDims | undefined,
  estimate: PageDims,
  scale: number,
  extraRotation: number,
): PageDims {
  const base = applyRotation(dims ?? estimate, extraRotation);
  return { width: base.width * scale, height: base.height * scale };
}

/**
 * The mean of several page boxes: what a row whose own page has not been measured
 * yet is sized from.
 *
 * Page 1's box is a poor stand-in for a document whose pages differ from it. Measured
 * on the 1,000-page fixture, whose three boxes cycle evenly through the file, laying
 * the unmeasured rows out at page 1's shape put the laid-out height 15 % short, and at
 * the pre-load default 36 % long. A dozen boxes taken spread through the document bring
 * the same figure inside 2 %, and cost nothing the sweep was not already paying.
 */
export function meanBox(boxes: PageDims[]): PageDims | null {
  if (boxes.length === 0) return null;
  let width = 0;
  let height = 0;
  for (const box of boxes) {
    width += box.width;
    height += box.height;
  }
  return { width: width / boxes.length, height: height / boxes.length };
}

/**
 * `count` 1-based page numbers spread evenly across a document, from its second page
 * to its last, never page 1.
 *
 * Page 1 is excluded because it has been fetched already and its box is on its way to
 * the layout: sampling it again would weight the mean toward whatever the first page
 * happens to be, which is the bias the sample exists to remove.
 */
export function spreadSample(numPages: number, count: number): number[] {
  if (numPages < 3 || count < 1) return [];
  const n = Math.min(count, numPages - 1);
  if (n === 1) return [Math.round((numPages + 2) / 2)];
  const step = (numPages - 2) / (n - 1);
  return Array.from({ length: n }, (_, k) => 2 + Math.round(k * step));
}

export interface LayoutResult {
  /** offsets[i] = content-space Y where page i starts. */
  offsets: number[];
  /** offsets[i] + heights[i] = bottom of page i (excludes trailing gap). */
  heights: number[];
  totalHeight: number;
}

export function computeLayout(
  sizes: PageDims[],
  gap: number,
): LayoutResult {
  const offsets: number[] = new Array(sizes.length);
  const heights: number[] = new Array(sizes.length);
  let y = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]!;
    offsets[i] = y;
    heights[i] = size.height;
    y += size.height + gap;
  }
  return { offsets, heights, totalHeight: sizes.length > 0 ? y - gap : 0 };
}

/** First index whose page bottom is below `y` (binary search). */
export function findStartIndex(layout: LayoutResult, y: number): number {
  const { offsets, heights } = layout;
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = offsets.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! + heights[mid]! > y) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

/** Continuous vertical scroll, one page per screen, or two-page book spread. */
export type PageLayout = 'continuous' | 'single' | 'spread';

/**
 * Groups 0-based page indices into rendered rows. Spread view keeps page 1
 * alone (book convention), then pairs (2,3), (4,5), …
 */
export function computeSlots(numPages: number, layout: PageLayout): number[][] {
  if (numPages <= 0) return [];
  if (layout !== 'spread') {
    return Array.from({ length: numPages }, (_, i) => [i]);
  }
  const slots: number[][] = [[0]];
  for (let i = 1; i < numPages; i += 2) {
    slots.push(i + 1 < numPages ? [i, i + 1] : [i]);
  }
  return slots;
}

export interface VisibleRange {
  start: number;
  end: number;
}

/**
 * Inclusive page-index range intersecting the viewport expanded by
 * `overscanPx` on both sides. Returns an empty range when the layout is empty
 * or the window is fully past the content.
 */
export function findVisibleRange(
  layout: LayoutResult,
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): VisibleRange {
  const n = layout.offsets.length;
  if (n === 0) return { start: 0, end: -1 };
  const top = scrollTop - overscanPx;
  const bottom = scrollTop + viewportHeight + overscanPx;
  const start = Math.min(findStartIndex(layout, top), n - 1);
  const end = Math.min(findStartIndex(layout, bottom), n - 1);
  return { start, end };
}
