/*
 * FR-05's second clause: *placeholder heights come from real page dimensions once known, so the scrollbar
 * does not jump as pages measure themselves*.
 *
 * `src/lib/layout.test.ts` has always had the arithmetic — `meanBox`, `scaledPageSize`, `computeLayout` — over
 * boxes handed to it. The clause is not about that arithmetic; it is about what happens when a page measures
 * itself *while the reader is looking at the document*: the row grows, everything below it moves, and the page
 * under the reader's eyes must not move with it. The one function that receives those measurements,
 * `reportPageDims`, was a `vi.fn()` in every test that mounted the shell, and the pages that reach the DOM in
 * the suite are hand-built slot lists. So the whole clause rested on the helpers' unit tests.
 *
 * Five claims, one per case where it needs its own:
 *
 *  - a report sizes **its own row** and leaves the fit basis alone — `pageEstimate` is page 1, because page 1
 *    is the page a reader arrives on, and a tall page 7 must not rescale the whole document;
 *  - **the first measurement wins**: the sweep and the page both report, and a second report for the same page
 *    (a stale paint, a re-mounted one) must not move the layout a second time;
 *  - the anchor: a row *above* the fold growing shifts `scrollTop` by exactly the growth, so `currentPage` is
 *    the same page before and after. This is the clause in its only observable form — a scrollbar that does
 *    not jump is a scroll position that moved on purpose;
 *  - the sweep's end state: once every page has reported, the laid-out height is the sum of the real boxes,
 *    and each row's height is its own page's;
 *  - the mixed-size half, which is what 0.8 actually fixed: before the sweep reaches the end, the rows it has
 *    not reached are sized from a **sample mean**, not from page 1 — so the height at that moment is already
 *    within a few percent of the final one. A page-1 estimate for a document whose pages cycle through three
 *    boxes was measured at 15 % short, and the default estimate at 36 % long.
 *
 * The viewport is faked at the prototype level (jsdom reports 0 for every `clientWidth` and a `scrollTop` that
 * discards writes), because the hook reads both from the element: a fit mode resolved against 0×0 holds its
 * last good scale, and an anchor that cannot write its scroll position proves nothing.
 */
import { act, cleanup, render } from '@testing-library/react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePdfVirtualizer, type UsePdfVirtualizerResult } from './usePdfVirtualizer';
import { DEFAULT_PAGE_ESTIMATE } from '../lib/layout';

const VIEWPORT = { width: 1000, height: 800 };
const GAP = 16;

/** The heights are read off the element the hook attached its own ref to. */
let api!: UsePdfVirtualizerResult;
let element!: HTMLDivElement;

function Probe(props: {
  doc: PDFDocumentProxy | null;
  numPages: number;
  scale?: number | 'fit-width' | 'fit-page' | 'automatic';
  layout?: 'continuous' | 'single' | 'spread';
}) {
  api = usePdfVirtualizer({
    doc: props.doc,
    numPages: props.numPages,
    scale: props.scale ?? 1,
    gap: GAP,
    layout: props.layout ?? 'continuous',
  });
  return <div ref={api.containerRef} data-testid="viewport" />;
}

/** A page box whose scale-1 viewport is `height` tall, so the sweep's reports are predictable. */
function docWithHeights(heights: Record<number, number>, options: { deferFrom?: number } = {}) {
  const requests: number[] = [];
  const waiters: Array<() => void> = [];
  let open = options.deferFrom === undefined;
  const pageFor = (pageNumber: number): PDFPageProxy =>
    ({
      rotate: 0,
      getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({
        width: 612 * scale,
        height: (heights[pageNumber] ?? 792) * scale,
      }),
    }) as unknown as PDFPageProxy;

  const doc = {
    numPages: Object.keys(heights).length,
    getPage: (pageNumber: number) => {
      requests.push(pageNumber);
      if (!open && requests.length > options.deferFrom!) {
        return new Promise<void>((resolve) => waiters.push(resolve)).then(() => pageFor(pageNumber));
      }
      return Promise.resolve(pageFor(pageNumber));
    },
  } as unknown as PDFDocumentProxy;

  return {
    doc,
    requests,
    /** Release the held `getPage` calls and let every later one through, so the sweep can finish. */
    release: () => {
      open = true;
      const pending = waiters.splice(0);
      pending.forEach((done) => done());
    },
  };
}

function mount(props: Parameters<typeof Probe>[0]) {
  const view = render(<Probe {...props} />);
  element = view.getByTestId('viewport') as HTMLDivElement;
  return view;
}

/** Scroll the way a reader does: move the element, let the rAF-throttled listener see it. */
async function scrollTo(y: number) {
  element.scrollTop = y;
  await act(async () => {
    element.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const storedScroll = new WeakMap<Element, number>();

beforeEach(() => {
  const metrics = {
    configurable: true,
    get: () => VIEWPORT.width,
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', metrics);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT.height,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 0 });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return storedScroll.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      storedScroll.set(this, value);
    },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FR-05: a measured page sizes its own row, and the scroll position keeps the reader', () => {
  it('grows one row by the difference the page reported, and leaves the fit basis alone', () => {
    mount({ doc: null, numPages: 5 });
    const base = DEFAULT_PAGE_ESTIMATE.height;
    expect(api.totalHeight, 'five estimated rows and four gaps').toBe(5 * base + 4 * GAP);

    // Page 2, not page 5, because the claim is about the row the reader can see: at 800 px tall with a 792 px
    // estimate the visible window is rows 1 and 2, and `totalHeight` alone would pass on a layout that sized
    // nothing.
    act(() => api.reportPageDims(1, { width: 612, height: 2000 }));
    expect(api.totalHeight, 'row 2 grew by what page 2 measured, and nothing else moved').toBe(
      5 * base + 4 * GAP + (2000 - base),
    );
    expect(api.pageEstimate, 'a tall page 2 is not the document’s fit basis').toEqual(DEFAULT_PAGE_ESTIMATE);
    expect(
      api.virtualSlots.map((slot) => [slot.pageNumber, slot.height]),
      'the row that changed is the one that reported',
    ).toEqual([[1, base], [2, 2000]]);
  });

  it('keeps the first measurement of a page, so a second report cannot move the layout again', () => {
    mount({ doc: null, numPages: 3 });
    act(() => api.reportPageDims(1, { width: 612, height: 1500 }));
    const after = api.totalHeight;
    act(() => api.reportPageDims(1, { width: 612, height: 400 }));
    expect(api.totalHeight, 'a stale or repeated report is not a re-measurement').toBe(after);
  });

  it('moves the scroll position by the growth of a row above the fold, so the reader stays on their page', async () => {
    mount({ doc: null, numPages: 6 });
    const base = DEFAULT_PAGE_ESTIMATE.height;
    const rowOf = (index: number) => index * (base + GAP);
    await scrollTo(rowOf(3));
    expect(api.currentPage, 'page 4 is at the top of the viewport').toBe(4);

    act(() => api.reportPageDims(0, { width: 612, height: 2000 }));
    const delta = 2000 - base;
    expect(element.scrollTop, 'the element scrolled by exactly what the row above grew').toBe(rowOf(3) + delta);
    expect(api.currentPage, 'and the page at the top is still page 4').toBe(4);
  });

  it('moves the fit basis when page 1 reports, and a fit mode resolves against the box it learned', () => {
    mount({ doc: null, numPages: 3, scale: 'fit-width' });
    // Nothing has been measured, so the estimate the fit resolves against is the package default: a 612-wide
    // page fitted into 1000 px minus the 32 px padding.
    expect(api.resolvedScale).toBeCloseTo((VIEWPORT.width - 32) / 612, 6);

    act(() => api.reportPageDims(0, { width: 306, height: 400 }));
    expect(api.pageEstimate, 'page 1’s own box is now the fit basis').toEqual({ width: 306, height: 400 });
    expect(api.resolvedScale, 'the same viewport now fits a narrower page, so the scale doubles').toBeCloseTo(
      (VIEWPORT.width - 32) / 306,
      6,
    );
    expect(api.totalHeight, 'and every row was re-laid out at the scale the measured page implies').toBeCloseTo(
      (400 + 792 + 792) * api.resolvedScale + 2 * GAP,
      6,
    );
  });

  it('ends with the laid-out height the real boxes add up to, once the sweep has reported', async () => {
    const { doc } = docWithHeights({ 1: 700, 2: 1200, 3: 900, 4: 1500 });
    mount({ doc, numPages: 4 });
    await settle();
    const heights = [700, 1200, 900, 1500];
    expect(api.totalHeight).toBe(heights.reduce((sum, h) => sum + h, 0) + 3 * GAP);
    expect(api.pageEstimate, 'page 1’s own box is the fit basis now that it is known').toEqual({
      width: 612,
      height: 700,
    });
    await scrollTo(0);
    // The visible window at 800 px tall with a 700 px overscan is rows 1 and 2; row 3's box is asserted
    // through `totalHeight` above, which is the figure the scrollbar keeps a reader's place by.
    expect(api.virtualSlots.map((slot) => [slot.pageNumber, slot.height])).toEqual([
      [1, 700],
      [2, 1200],
    ]);
  });

  it('sizes the rows the sweep has not reached from a sample mean, so the height barely moves when it finishes', async () => {
    // Page 1 is the short one on purpose: sizing everything else by it is the defect 0.8 closed, and a mean
    // taken spread through the document is what replaced it.
    const heights: Record<number, number> = {};
    for (let page = 1; page <= 200; page += 1) heights[page] = [792, 1600, 1100][page % 3]!;
    const { doc, requests, release } = docWithHeights(heights, { deferFrom: 13 });
    mount({ doc, numPages: 200 });

    // Page 1, the twelve sample pages, and the first chunk's 25 requests — issued, but held, so the rows past
    // the sample are still being sized from the mean when the figure below is taken.
    await settle();
    expect(requests.length, 'the sweep has issued its first chunk and is waiting on it').toBe(1 + 12 + 25);
    const sampled = api.totalHeight;

    release();
    await settle();
    const final = api.totalHeight;

    const pageOneOnly = 200 * heights[1]! + 199 * GAP;
    expect(
      Math.abs(sampled - final) / final,
      `the sample keeps the first layout within 5 % of the measured document (sampled ${sampled}, final ${final}, page-1-only would be ${pageOneOnly})`,
    ).toBeLessThan(0.05);
    expect(
      Math.abs(pageOneOnly - final) / final,
      'and the figure this replaced really was far off, so the assertion above is not measuring a no-op',
    ).toBeGreaterThan(0.25);
  });

  it('resolves a fit mode against page 1’s measured box, not against the estimate it started with', async () => {
    const { doc } = docWithHeights({ 1: 1600, 2: 792 });
    mount({ doc, numPages: 2, scale: 'fit-width' });
    await settle();
    // (viewport − padding) / page width, with the page now known to be 612 wide and 1600 tall: the scale is
    // width-derived, so what must move is the *height* the row is sized from.
    expect(api.resolvedScale).toBeCloseTo((VIEWPORT.width - 32) / 612, 6);
    expect(api.totalHeight, 'row 1 is fitted, row 2 keeps the same scale and its own box').toBeCloseTo(
      1600 * api.resolvedScale + GAP + 792 * api.resolvedScale,
      6,
    );
  });
});
