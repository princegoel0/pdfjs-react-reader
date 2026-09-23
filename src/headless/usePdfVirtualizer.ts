import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  applyRotation,
  computeLayout,
  computeSlots,
  DEFAULT_PAGE_ESTIMATE,
  findStartIndex,
  findVisibleRange,
  scaledPageSize,
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
  scrollToPage: (pageNumber: number, behavior?: ScrollBehavior) => void;
  /** Report a page's intrinsic (scale-1) dimensions once measured. */
  reportPageDims: (index: number, dims: PageDims) => void;
}

const DIM_CHUNK_SIZE = 25;
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
    overscan = 1,
    layout: pageLayout = 'continuous',
  } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<ReadonlyMap<number, PageDims>>(new Map());
  const [estimate, setEstimate] = useState<PageDims>(DEFAULT_PAGE_ESTIMATE);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const inflight = useRef(new Set<number>());

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
    inflight.current.clear();
  }, [doc]);

  // Seed the estimate from page 1, then measure remaining pages in background
  // chunks so real dimensions progressively replace estimates.
  useEffect(() => {
    if (!doc || numPages === 0) return;
    let cancelled = false;

    (async () => {
      const first = await doc.getPage(1);
      if (cancelled) return;
      const base = first.getViewport({ scale: 1 });
      setEstimate({ width: base.width, height: base.height });
      reportPageDims(0, { width: base.width, height: base.height });

      for (let start = 1; start < numPages; start += DIM_CHUNK_SIZE) {
        if (cancelled) return;
        const end = Math.min(start + DIM_CHUNK_SIZE, numPages);
        const pages = await Promise.all(
          Array.from({ length: end - start }, (_, i) => doc.getPage(start + i + 1)),
        );
        if (cancelled) return;
        for (let i = 0; i < pages.length; i++) {
          const base = pages[i]!.getViewport({ scale: 1 });
          reportPageDims(start + i, { width: base.width, height: base.height });
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

  // A zero-width viewport (hidden container, transient layout collapse) would
  // otherwise drive fit modes to the 0.1 floor, shrink the layout, and clamp
  // away the user's scroll position. Hold the last good fit scale instead.
  const lastFitScale = useRef(1);

  const resolvedScale = useMemo(() => {
    if (typeof scale === 'number') return scale;
    if (viewport.width <= 0 || viewport.height <= 0) return lastFitScale.current;
    const base = applyRotation(pageEstimate, rotation);
    // A spread row is two pages wide plus the gap between them; the fit width
    // must reserve that inner gap so the row doesn't overflow the viewport.
    const pagesAcross = pageLayout === 'spread' ? 2 : 1;
    const innerGap = (pagesAcross - 1) * gap;
    // On phones/tablets in portrait the fixed 32px margin would waste a large
    // share of the screen; shrink the fit padding so the page uses the width.
    const pad = viewport.width <= NARROW_VIEWPORT_MAX ? NARROW_HORIZONTAL_PADDING : HORIZONTAL_PADDING;
    const fitWidthScale = (viewport.width - pad - innerGap) / (base.width * pagesAcross);
    const fitHeight = base.height;
    const resolved =
      scale === 'fit-width'
        ? Math.max(0.1, fitWidthScale)
        : Math.max(0.1, Math.min(fitWidthScale, (viewport.height - gap) / fitHeight));
    lastFitScale.current = resolved;
    return resolved;
  }, [scale, pageEstimate, rotation, viewport.width, viewport.height, gap, pageLayout]);

  const layout: LayoutResult = useMemo(() => {
    const sizes = slots.map((group) => {
      let width = (group.length - 1) * gap;
      let height = 0;
      for (const i of group) {
        const s = scaledPageSize(dims.get(i), estimate, resolvedScale, rotation);
        width += s.width;
        height = Math.max(height, s.height);
      }
      return { width, height };
    });
    return computeLayout(sizes, gap);
  }, [slots, dims, estimate, resolvedScale, rotation, gap]);

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
      let width = (indices.length - 1) * gap;
      for (const i of indices) {
        width += scaledPageSize(dims.get(i), estimate, resolvedScale, rotation).width;
      }
      out.push({ indices, pageNumber: indices[0]! + 1, offsetTop, width, height });
    }
    return out;
  }, [visible, slots, layout, dims, estimate, resolvedScale, rotation, gap]);

  const scrollToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior = 'auto') => {
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
      el.scrollTo({ top, behavior });
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
