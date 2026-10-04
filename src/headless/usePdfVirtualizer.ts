import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  applyRotation,
  automaticFitMode,
  computeLayout,
  computeSlots,
  DEFAULT_PAGE_ESTIMATE,
  findStartIndex,
  findVisibleRange,
  meanBox,
  scaledPageSize,
  spreadSample,
  type LayoutResult,
  type PageDims,
  type PageLayout,
  type ScaleMode,
} from '../lib/layout';

export interface UsePdfVirtualizerOptions {
  doc: PDFDocumentProxy | null;
  numPages: number;
  /** Numeric zoom factor, or an automatic fit mode resolved against the viewport. */
  scale: ScaleMode;
  /** Vertical gap between pages in CSS pixels. */
  gap?: number;
  /** User-applied rotation in degrees (added to each page's intrinsic rotation). */
  rotation?: number;
  /**
   * Extra rotation for individual pages, keyed by 0-based index, added on top
   * of `rotation`. Pages absent from the map keep the global value.
   */
  pageRotations?: Record<number, number>;
  /** Extra rows rendered above/below the viewport. Ignored in 'single' layout. */
  overscan?: number;
  /** Row grouping: continuous scroll, one page at a time, or two-page spreads. */
  layout?: PageLayout;
}

export interface VirtualSlot {
  /** 0-based page indices rendered in this row (one, or two in spread layout). */
  indices: number[];
  /** 1-based page number of the first page in the row. */
  pageNumber: number;
  /** Content-space Y position in pixels. */
  offsetTop: number;
  width: number;
  height: number;
  /** Where each page of the row sits inside it. */
  pages: VirtualSlotPage[];
}

/**
 * One page's box inside its row — published so the shell can place a page without putting it *in* the row.
 *
 * `FR-08` is the reason this is a number rather than a flex child: a layout switch regroups rows, and React
 * cannot move a mounted component between two parents. So a page that went from being a row of its own to the
 * right-hand half of a pair was unmounted and rebuilt — losing the canvas it had painted, its editor state and
 * its place in the document — on a change that moved nothing but a border. The row is the box the shell
 * paints; the pages are its siblings, positioned from these fields, and a page keeps one identity in every
 * layout mode.
 */
export interface VirtualSlotPage {
  /** 0-based index into the document: the identity a page keeps across a layout switch. */
  index: number;
  /** 1-based page number, the way the shell and pdf.js name a page. */
  pageNumber: number;
  /** X from the row's left edge, in content pixels. */
  left: number;
  /** Y from the row's top, which centres a short page beside a taller one. */
  top: number;
  width: number;
  height: number;
}

/**
 * The scroll container handle, spelled structurally on purpose.
 *
 * `@types/react` 18 types a `ref` as accepting `RefObject<T>` =
 * `{ readonly current: T | null }`, while 19 widened `Ref<T>` to accept
 * `RefObject<T | null>`. Naming either version's `RefObject` breaks assignment
 * under the other, which would force every consumer on React 18 to cast. This
 * shape satisfies both.
 */
export type PdfViewportRef = { current: HTMLDivElement | null };

export interface UsePdfVirtualizerResult {
  /** Attach to the scrollable viewport element. */
  containerRef: PdfViewportRef;
  virtualSlots: VirtualSlot[];
  totalHeight: number;
  /** 1-based page currently at the top of the viewport. */
  currentPage: number;
  /** Best-known intrinsic page size (page 1 once loaded, a default estimate before). */
  pageEstimate: PageDims;
  /** Numeric scale actually applied after resolving fit modes. */
  resolvedScale: number;
  viewportWidth: number;
  viewportHeight: number;
  /**
   * Scroll so the page's row top (or, with `offsetInPagePx`, a point that far down the page) meets the top of
   * the viewport. The offset is in content pixels at the current scale, not PDF points.
   */
  scrollToPage: (pageNumber: number, behavior?: ScrollBehavior, offsetInPagePx?: number) => void;
  /** Report a page's intrinsic (scale-1) dimensions once measured. */
  reportPageDims: (index: number, dims: PageDims) => void;
}

const DIM_CHUNK_SIZE = 25;
/**
 * How many pages are weighed to size the rows the sweep has not reached yet. See
 * {@link meanBox}: the figure is the laid-out height's error at first paint, and a
 * dozen pages cost one batch of `getPage` calls that the sweep would make anyway.
 */
const SAMPLE_SIZE = 12;
const HORIZONTAL_PADDING = 32;
const NARROW_HORIZONTAL_PADDING = 8;
const NARROW_VIEWPORT_MAX = 640;

export function usePdfVirtualizer(options: UsePdfVirtualizerOptions): UsePdfVirtualizerResult {
  const {
    doc,
    numPages,
    scale,
    gap = 16,
    rotation = 0,
    pageRotations,
    overscan = 1,
    layout: pageLayout = 'continuous',
  } = options;

  // Effective rotation for one page. A plain function rather than a memoised
  // map: it is called inside existing layout loops, and rebuilding a map per
  // page would allocate on every scroll frame for no gain.
  const rotationFor = useCallback(
    (index: number): number => rotation + (pageRotations?.[index] ?? 0),
    [rotation, pageRotations],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<ReadonlyMap<number, PageDims>>(new Map());
  const [estimate, setEstimate] = useState<PageDims>(DEFAULT_PAGE_ESTIMATE);
  const [average, setAverage] = useState<PageDims | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const reportPageDims = useCallback((index: number, pageDims: PageDims) => {
    setDims((prev) => {
      if (prev.has(index)) return prev;
      const next = new Map(prev);
      next.set(index, pageDims);
      return next;
    });
  }, []);

  // Reset measurements when the document changes.
  useEffect(() => {
    setDims(new Map());
    setEstimate(DEFAULT_PAGE_ESTIMATE);
    setAverage(null);
  }, [doc]);

  // Seed the layout: page 1's box for the fit modes to work against, the mean of a
  // sample spread through the document for the rows the sweep has not reached, and
  // then every remaining page in chunks. A chunk's twenty-odd reports land as one
  // render, because React batches the updates a tick makes.
  useEffect(() => {
    if (!doc || numPages === 0) return;
    let cancelled = false;

    const boxOf = async (pageNumber: number): Promise<PageDims> => {
      const page = await doc.getPage(pageNumber);
      const box = page.getViewport({ scale: 1 });
      return { width: box.width, height: box.height };
    };

    (async () => {
      // Page 1 and the sample are fetched together and published together. The first
      // layout needs both figures — the box the scale is fitted to, and the mean the
      // rows nobody has reached are sized from — and resolving them one after the
      // other spends a commit laying the document out by page 1 alone.
      const picks = spreadSample(numPages, SAMPLE_SIZE);
      const [first, sampled] = await Promise.all([boxOf(1), Promise.all(picks.map(boxOf))]);
      if (cancelled) return;
      setEstimate(first);
      reportPageDims(0, first);
      for (let i = 0; i < picks.length; i++) {
        reportPageDims(picks[i]! - 1, sampled[i]!);
      }
      setAverage(meanBox([first, ...sampled]));

      for (let start = 1; start < numPages; start += DIM_CHUNK_SIZE) {
        if (cancelled) return;
        const end = Math.min(start + DIM_CHUNK_SIZE, numPages);
        const boxes = await Promise.all(
          Array.from({ length: end - start }, (_, i) => boxOf(start + i + 1)),
        );
        if (cancelled) return;
        for (let i = 0; i < boxes.length; i++) {
          reportPageDims(start + i, boxes[i]!);
        }
      }
    })().catch(() => {
      // Damaged pages fall back to the estimate; rendering surfaces the real error.
    });

    return () => {
      cancelled = true;
    };
  }, [doc, numPages, reportPageDims]);

  // Track scroll position (rAF-throttled) and viewport size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    setScrollTop(el.scrollTop);

    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const slots = useMemo(() => computeSlots(numPages, pageLayout), [numPages, pageLayout]);

  const pageEstimate = dims.get(0) ?? estimate;

  /*
   * What a row is sized from before its own page has been measured.
   *
   * Not `pageEstimate`: that is the box the fit modes work against, and it is right to
   * be page 1, because page 1 is the page in view. Sizing the *other* thousand rows by
   * it is what left a mixed-size document's laid-out height a sixth short at first paint
   * and 36 % long before that, and the scrollbar keeps a reader's place by that height.
   */
  const layoutEstimate = average ?? estimate;

  // A zero-width viewport (hidden container, transient layout collapse) would
  // otherwise drive fit modes to the 0.1 floor, shrink the layout, and clamp
  // away the user's scroll position. Hold the last good fit scale instead.
  const lastFitScale = useRef(1);

  const resolvedScale = useMemo(() => {
    if (typeof scale === 'number') return scale;
    if (viewport.width <= 0 || viewport.height <= 0) return lastFitScale.current;
    const base = applyRotation(pageEstimate, rotationFor(0));
    // A spread row is two pages wide plus the gap between them; the fit width
    // must reserve that inner gap so the row doesn't overflow the viewport.
    const pagesAcross = pageLayout === 'spread' ? 2 : 1;
    const innerGap = (pagesAcross - 1) * gap;
    // On phones/tablets in portrait the fixed 32px margin would waste a large
    // share of the screen; shrink the fit padding so the page uses the width.
    const pad = viewport.width <= NARROW_VIEWPORT_MAX ? NARROW_HORIZONTAL_PADDING : HORIZONTAL_PADDING;
    const fitWidthScale = (viewport.width - pad - innerGap) / (base.width * pagesAcross);
    const fitHeight = base.height;
    const mode = scale === 'automatic' ? automaticFitMode(base) : scale;
    const resolved =
      mode === 'fit-page'
        ? Math.max(0.1, Math.min(fitWidthScale, (viewport.height - gap) / fitHeight))
        : Math.max(0.1, fitWidthScale);
    lastFitScale.current = resolved;
    return resolved;
  }, [scale, pageEstimate, rotationFor, viewport.width, viewport.height, gap, pageLayout]);

  const layout: LayoutResult = useMemo(() => {
    const sizes = slots.map((group) => {
      let width = (group.length - 1) * gap;
      let height = 0;
      for (const i of group) {
        const s = scaledPageSize(dims.get(i), layoutEstimate, resolvedScale, rotationFor(i));
        width += s.width;
        height = Math.max(height, s.height);
      }
      return { width, height };
    });
    return computeLayout(sizes, gap);
  }, [slots, dims, layoutEstimate, resolvedScale, rotationFor, gap]);

  // Keep the topmost visible row anchored when layout shifts underneath it
  // (dimension corrections, zoom changes) so the viewport doesn't jump.
  const prevLayout = useRef<LayoutResult | null>(null);
  useEffect(() => {
    const prev = prevLayout.current;
    prevLayout.current = layout;
    const el = containerRef.current;
    if (!prev || !el || prev.offsets.length === 0 || layout.offsets.length === 0) return;

    const first = Math.min(findStartIndex(prev, el.scrollTop), prev.offsets.length - 1);
    const delta = layout.offsets[first]! - prev.offsets[first]!;
    if (Math.abs(delta) > 0.5) {
      el.scrollTop += delta;
      setScrollTop(el.scrollTop);
    }
  }, [layout]);

  const visible = useMemo(() => {
    if (slots.length === 0) return { start: 0, end: -1 };
    if (pageLayout === 'single') {
      // Presentation mode: only the row crossing the viewport center exists.
      const mid = Math.min(
        findStartIndex(layout, scrollTop + viewport.height / 2),
        slots.length - 1,
      );
      return { start: mid, end: mid };
    }
    return findVisibleRange(
      layout,
      scrollTop,
      viewport.height,
      overscan * (layout.heights[0] ?? 0),
    );
  }, [slots.length, pageLayout, layout, scrollTop, viewport.height, overscan]);

  const currentPage = useMemo(() => {
    if (numPages === 0) return 1;
    const first = Math.min(findStartIndex(layout, scrollTop), layout.offsets.length - 1);
    return (slots[first]?.[0] ?? 0) + 1;
  }, [layout, scrollTop, numPages, slots]);

  const virtualSlots = useMemo<VirtualSlot[]>(() => {
    const out: VirtualSlot[] = [];
    for (let s = visible.start; s <= visible.end; s++) {
      const indices = slots[s];
      const offsetTop = layout.offsets[s];
      const height = layout.heights[s];
      if (!indices || offsetTop === undefined || height === undefined) continue;
      const pages: VirtualSlotPage[] = [];
      let width = (indices.length - 1) * gap;
      let left = 0;
      for (const i of indices) {
        const size = scaledPageSize(dims.get(i), layoutEstimate, resolvedScale, rotationFor(i));
        pages.push({
          index: i,
          pageNumber: i + 1,
          left,
          // What `align-items: center` used to do in the row's own box, now that the row has no children:
          // a pair of pages of different heights keeps the shorter one centred against the taller.
          top: (height - size.height) / 2,
          width: size.width,
          height: size.height,
        });
        left += size.width + gap;
        width += size.width;
      }
      out.push({ indices, pageNumber: indices[0]! + 1, offsetTop, width, height, pages });
    }
    return out;
  }, [visible, slots, layout, dims, layoutEstimate, resolvedScale, rotationFor, gap]);

  const scrollToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior = 'auto', offsetInPagePx = 0) => {
      const el = containerRef.current;
      if (!el || slots.length === 0) return;
      const clamped = Math.min(Math.max(1, Math.round(pageNumber)), numPages);
      const pageIndex = clamped - 1;
      let slotIndex = -1;
      for (let s = 0; s < slots.length; s++) {
        if (slots[s]!.includes(pageIndex)) {
          slotIndex = s;
          break;
        }
      }
      const top = layout.offsets[slotIndex];
      if (top === undefined) return;
      // A destination inside the page is measured from that page's own top edge, in content pixels — which is
      // why it arrives already scaled rather than as PDF points: only the caller holding the page viewport can
      // turn a `/XYZ` top into one, and the rotation is part of that answer.
      el.scrollTo({ top: Math.max(0, top + offsetInPagePx), behavior });
    },
    [slots, layout, numPages],
  );

  return {
    containerRef,
    virtualSlots,
    totalHeight: layout.totalHeight,
    currentPage,
    pageEstimate,
    resolvedScale,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    scrollToPage,
    reportPageDims,
  };
}
