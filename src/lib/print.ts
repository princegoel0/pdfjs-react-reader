import type { PageDims } from './layout';

/**
 * Canvas pixels cost four bytes each and every page keeps one alive until the
 * print dialog closes, so the resolution is chosen from a memory budget rather
 * than a fixed DPI. 256 MB is ~25 A4 pages at 2x; past that a tab starts dying
 * on mobile Safari, which is a stated support target.
 */
export const PRINT_MEMORY_BUDGET = 256 * 1024 * 1024;

/** Tried best-first. 2 ≈ 144 dpi, 1.5 ≈ 108 dpi, 1 ≈ the 72 dpi PDF unit. */
export const PRINT_SCALES = [2, 1.5, 1];

export const BYTES_PER_PIXEL = 4;

/**
 * 1-based page numbers to print, in order.
 *
 * The range is clamped rather than rejected: the toolbar offers "current
 * selection" style ranges that a re-loaded document may have shortened.
 */
export function planPrintPages(numPages: number, range?: [number, number] | null): number[] {
  const total = Math.max(0, Math.trunc(numPages) || 0);
  if (total === 0) return [];
  const from = clampPage(range?.[0] ?? 1, 1, 1, total);
  const to = clampPage(range?.[1] ?? total, total, from, total);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * A non-finite bound falls back to the default for that end (so a garbage
 * `[2, NaN]` still means "from page 2 to the end") rather than truncating the
 * job to a single sheet.
 */
function clampPage(value: number, fallback: number, min: number, max: number): number {
  const int = Math.trunc(value);
  if (!Number.isFinite(int)) return Math.min(Math.max(fallback, min), max);
  return Math.min(Math.max(int < 1 ? min : int, min), max);
}

/** Device pixels a page needs at `scale`, matching `PdfPage`'s floor rounding. */
export function printCanvasSize(base: PageDims, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(base.width * scale)),
    height: Math.max(1, Math.floor(base.height * scale)),
  };
}

export function estimatePrintBytes(base: PageDims, scale: number, pageCount: number): number {
  const { width, height } = printCanvasSize(base, scale);
  return width * height * BYTES_PER_PIXEL * pageCount;
}

/** Largest of `levels` whose total canvas cost fits the budget, or null. */
export function planPrintScale(
  base: PageDims,
  pageCount: number,
  levels: number[] = PRINT_SCALES,
  budget: number = PRINT_MEMORY_BUDGET,
): number | null {
  if (!(base.width > 0) || !(base.height > 0) || pageCount <= 0) return null;
  for (const scale of levels) {
    if (estimatePrintBytes(base, scale, pageCount) <= budget) return scale;
  }
  return null;
}

/** How many pages fit at `scale` — used to suggest a range in the error text. */
export function maxPrintablePages(
  base: PageDims,
  scale: number,
  budget: number = PRINT_MEMORY_BUDGET,
): number {
  const perPage = estimatePrintBytes(base, scale, 1);
  if (perPage <= 0) return 0;
  return Math.max(0, Math.floor(budget / perPage));
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}
