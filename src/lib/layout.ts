export interface PageDims {
  width: number;
  height: number;
}

/** Numeric zoom factor, or an automatic mode resolved against the viewport. */
export type ScaleMode = 'fit-width' | 'fit-page' | number;

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
