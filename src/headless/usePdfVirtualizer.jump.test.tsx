/*
 * FR-12's first words and FR-05's second clause, met at the same moment: a jump has to put the reader on the
 * page they typed, and the table that says where that page is keeps changing while a long document measures
 * itself.
 *
 * `usePdfVirtualizer.scrollToPage` turns a page number into `layout.offsets[row]` and writes it. On a document
 * that has not finished measuring, that number belongs to a table that is about to be wrong: a fit mode
 * resolves against page 1's box, and until that box arrives it resolves against the 612×792 default — 1.98
 * instead of the 1.53 that `long-sample.pdf` settles on. A jump issued inside that window writes an offset for
 * the stale table. Measured in webkit on 2026-10-07 (#259, and the counter #265 added to the matrix row): the
 * write went to 1,585,472, the corrected table shrank the document by 27 %, the engine clamped the reader to
 * the new end of the scroll range, and the anchor — which derives the reader's row by looking that *new*
 * position up in the *old* table — named row 733 and moved them there. Two page changes in ninety seconds, and
 * page 733 for the rest of the session. Chromium won the same race by measuring page 1 first.
 *
 * So a jump is a request that outlives its write, and these are the things that has to hold:
 *
 *  - a table that grows under a jump does not move the reader off the page they asked for;
 *  - a table that *shrinks past* the reader — the webkit shape, where the engine clamps — still lands them on
 *    it, rather than a third of the way into the document;
 *  - a destination *inside* a page (FR-10 resolves an outline click to a page and a position) keeps that
 *    position across the re-issue, instead of landing on the row's top edge;
 *  - a reader who takes the wheel is not dragged back to an unsatisfied request;
 *  - the pin stops fighting after its ceiling of layout changes, and after its window expires, because a
 *    request that never dies would yank a reader back to a page they asked for before they went elsewhere.
 *
 * jsdom has no scrolling at all: `Element.scrollTo` is not implemented, `scrollTop` discards writes and
 * `scrollHeight` is 0. The prototype stubs below *are* the engine — the content height is the height the hook
 * laid out (`api.totalHeight`, which is what the rendered spacer is styled to), a write clamps to
 * `scrollHeight − clientHeight`, a read clamps again so a document that shrinks under the reader produces the
 * same clamp a browser produces, and every change dispatches the `scroll` event a real scroll fires, because
 * `currentPage` is derived from the hook's state and a test that never delivers that event is asserting the
 * state of a scroll the reader has not been told about. Without the clamp, cases 2, 4 and 5 would be
 * asserting nothing.
 */
import { act, cleanup, render } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePdfVirtualizer, type UsePdfVirtualizerResult } from './usePdfVirtualizer';

const GAP = 16;
/** The fake engine's viewport. Mutable, so a case can be tall (nothing lands) or short (the last row is reachable). */
const VIEWPORT = { width: 1000, height: 800 };

let api!: UsePdfVirtualizerResult;
let element!: HTMLDivElement;
/** Every scroll write the hook made, so the ceiling and the expiry can be counted rather than inferred. */
let writes: number[] = [];

const maxScroll = () => Math.max(0, (api?.totalHeight ?? 0) - VIEWPORT.height);

function Probe(props: { doc: PDFDocumentProxy | null; numPages: number; scale?: 'fit-width' | number }) {
  api = usePdfVirtualizer({
    doc: props.doc,
    numPages: props.numPages,
    scale: props.scale ?? 1,
    gap: GAP,
    layout: 'continuous',
  });
  return <div ref={api.containerRef} data-testid="viewport" />;
}

function mount(props: Parameters<typeof Probe>[0]) {
  writes = [];
  const view = render(<Probe {...props} />);
  element = view.getByTestId('viewport') as HTMLDivElement;
  return view;
}

/** The offset the current table gives a page's row, read back from the mounted slots rather than recomputed. */
function rowTop(pageNumber: number) {
  const slot = api.virtualSlots.find((entry) => entry.pageNumber === pageNumber);
  if (!slot) throw new Error(`page ${pageNumber} is not mounted at ${element.scrollTop}`);
  return slot.offsetTop;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

const stored = new WeakMap<Element, number>();

beforeEach(() => {
  writes = [];
  VIEWPORT.height = 800;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => VIEWPORT.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT.height,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return this === element ? Math.ceil(api.totalHeight) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return Math.min(stored.get(this) ?? 0, maxScroll());
    },
    set(this: Element, value: number) {
      const next = Math.max(0, Math.min(value, maxScroll()));
      const moved = Math.abs(next - (stored.get(this) ?? 0)) > 0.5;
      stored.set(this, next);
      if (moved && this === element) this.dispatchEvent(new Event('scroll'));
    },
  });
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number, y?: number) {
    const top = typeof options === 'object' && options !== null ? Number(options.top) : Number(y);
    if (this !== element || Number.isNaN(top)) return;
    writes.push(top);
    this.scrollTop = top;
  } as Element['scrollTo'];
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
  vi.useRealTimers();
});

describe('FR-12 and FR-05: a jump is a request for a page, not a single write of an offset', () => {
  it('puts the reader on the page that was typed when a fit scale lands after the jump', async () => {
    // Six rows of the default box at the default fit: page 1 has not reported yet, so the scale is provisional.
    mount({ doc: null, numPages: 6, scale: 'fit-width' });
    await settle();
    const provisionalScale = api.resolvedScale;
    act(() => api.scrollToPage(5));
    await settle();
    expect(api.currentPage, 'the jump lands while the table is still the provisional one').toBe(5);

    // Page 1 turns out to be a narrow page: the same viewport now fits it at about twice the scale, and every
    // row moves. The provisional table's answer for page 5 is some other page's top edge.
    act(() => api.reportPageDims(0, { width: 306, height: 400 }));
    await settle();
    expect(api.resolvedScale, 'and the scale really did change, or this case measured nothing').toBeGreaterThan(
      provisionalScale * 1.5,
    );
    expect(api.currentPage, 'the reader is still on the page they typed').toBe(5);
    expect(element.scrollTop, 'at the offset the corrected table gives that page').toBe(rowTop(5));
  });

  it('still lands the reader on the page they typed when the document shrinks past them', async () => {
    // The webkit shape. A short viewport, so page 6 can reach the top of the range rather than being clamped.
    VIEWPORT.height = 200;
    mount({ doc: null, numPages: 6, scale: 'fit-width' });
    await settle();
    act(() => api.scrollToPage(6));
    await settle();
    const written = element.scrollTop;
    expect(api.currentPage).toBe(6);

    // Page 1 is twice as wide as the default, so the whole document halves in height and the position the jump
    // wrote is now beyond the end of the scroll range: the engine clamps it, and the reader is off their page.
    act(() => api.reportPageDims(0, { width: 1224, height: 792 }));
    await settle();
    const clampedEnd = maxScroll();
    expect(written, 'the position the jump wrote is past the clamped end of the document').toBeGreaterThan(clampedEnd);
    expect(api.currentPage, 'a reader clamped by a shrink is put back on the page they asked for').toBe(6);
    expect(element.scrollTop, 'at the corrected table’s own offset for that row').toBe(rowTop(6));
  });

  it('carries a destination inside the page across the re-issue, not just the page (FR-10)', async () => {
    // FR-10 resolves an outline or link destination to a page *and a position*. A re-issued jump that dropped
    // the offset would land the reader at the top of the right page, which is the wrong place to start reading.
    mount({ doc: null, numPages: 6, scale: 'fit-width' });
    await settle();
    act(() => api.scrollToPage(5, 'auto', 120));
    await settle();

    act(() => api.reportPageDims(0, { width: 306, height: 400 }));
    await settle();
    expect(api.currentPage).toBe(5);
    expect(element.scrollTop, 'the row top plus the 120 px the caller asked for').toBe(rowTop(5) + 120);
  });

  it('gives up an unsatisfied jump when the reader takes the wheel', async () => {
    // A viewport taller than the document makes the request unsatisfiable by construction: the last row can
    // never reach the top edge, so the pin would re-issue at every layout change if the wheel did not close it.
    VIEWPORT.height = 100_000;
    mount({ doc: null, numPages: 10, scale: 'fit-width' });
    await settle();
    act(() => api.scrollToPage(10));
    await settle();
    expect(writes.length, 'the request itself is one write').toBe(1);

    act(() => element.dispatchEvent(new Event('wheel')));
    act(() => api.reportPageDims(1, { width: 612, height: 900 }));
    await settle();
    expect(writes.length, 'the wheel closed the request, so the next layout change wrote nothing for it').toBe(1);
  });

  it('stops re-issuing after its ceiling of layout changes', async () => {
    VIEWPORT.height = 100_000;
    mount({ doc: null, numPages: 10, scale: 'fit-width' });
    await settle();
    act(() => api.scrollToPage(10));
    await settle();
    expect(writes.length, 'the request itself is one write').toBe(1);

    for (let index = 1; index <= 8; index += 1) {
      act(() => api.reportPageDims(index, { width: 612, height: 900 + index }));
      await settle();
    }
    // The request, then one re-issue at each of the next five layout changes. The sixth pass is the one that
    // has run out of chances, and it drops the pin *without* writing: a ceiling that lunges at the page one
    // last time is not a ceiling. (JUMP_REISSUE_LIMIT is 6; it is not exported, so this is the number the
    // hook's own constant promises.)
    expect(writes.length, 'the pin fought for the page for exactly its ceiling of layout changes').toBe(6);

    const after = writes.length;
    act(() => api.reportPageDims(9, { width: 612, height: 940 }));
    await settle();
    expect(writes.length, 'and it is gone: a later layout change cannot yank the reader back').toBe(after);
  });

  it('stops re-issuing once its window has expired', async () => {
    // Only `Date` is faked: the rAF the scroll listener uses has to stay real, or the state this test reads
    // never arrives.
    vi.useFakeTimers({ toFake: ['Date'] });
    VIEWPORT.height = 100_000;
    mount({ doc: null, numPages: 10, scale: 'fit-width' });
    await settle();
    act(() => api.scrollToPage(10));
    await settle();
    expect(writes.length).toBe(1);

    act(() => api.reportPageDims(1, { width: 612, height: 900 }));
    await settle();
    expect(writes.length, 'a layout change inside the window re-issues').toBe(2);

    vi.advanceTimersByTime(4100);
    act(() => api.reportPageDims(2, { width: 612, height: 1000 }));
    await settle();
    expect(writes.length, 'and one outside it does not').toBe(2);
  });
});
