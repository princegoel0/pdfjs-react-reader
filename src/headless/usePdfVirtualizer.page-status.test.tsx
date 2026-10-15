/*
 * FR-37's page union, **produced** rather than declared.
 *
 * The clause is unusually strict about this: "a member the model cannot reach is a defect rather than an
 * unused branch, so … every page state is written by a path a test drives", and §3.5 names exactly one
 * exception, `destroyed`. `unrequested` is not that exception, and it is the member `PdfPage` can never
 * report — a page the virtualizer has not asked for is not mounted, so there is no component to call
 * `onStatusChange`. Its own definition says who owns it: "**the virtualizer has not asked for it**. No work,
 * no memory."
 *
 * So the answer comes from `usePdfVirtualizer`, which is the only thing in the package that knows the ask,
 * and it is derived from the `virtualSlots` the shell already renders from rather than from a second count
 * of the window — two ways of knowing the ask would be two ways to disagree about it, and the state would
 * become a coin flip. Four claims:
 *
 *  - an unasked page reads `unrequested` and an asked one reads `queued` before anything has been reported,
 *    which is the first state `PdfPage` itself emits;
 *  - a report moves the asked page's answer, and repeating the same report changes nothing at all — no new
 *    map, so a host that subscribes through the returned function is not woken for nothing on a 1,000-page
 *    scroll;
 *  - the ask beats the report: a page outside the window that says it is `rendered` still reads
 *    `unrequested`. **This is the case that indicts the implementation** — drop the ask-set check and it
 *    reads `rendered`, which is the fiction the clause forbids, a painted page nobody asked for;
 *  - and a page that *was* asked and painted, then left the ask when the document got shorter, stops
 *    claiming it painted. A stale report is not a current state.
 */
import { act, cleanup, render } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePdfVirtualizer, type UsePdfVirtualizerResult } from './usePdfVirtualizer';
import type { PdfPageStatus } from '../lib/status';

const VIEWPORT = { width: 1000, height: 800 };
const GAP = 16;

let api!: UsePdfVirtualizerResult;

/**
 * One object, built once. A fresh literal per render would be a fresh `doc` identity, the dimension sweep keys
 * an effect on the document, and the hook would re-measure, re-render and re-measure until the heap gave up —
 * which is exactly what the first draft of this file did.
 */
const doc = {
  numPages: 200,
  getPage: () => Promise.resolve({ rotate: 0, getViewport: () => ({ width: 612, height: 792 }) }),
} as unknown as PDFDocumentProxy;

function Probe(props: { numPages: number }) {
  api = usePdfVirtualizer({
    doc,
    numPages: props.numPages,
    scale: 1,
    gap: GAP,
    layout: 'continuous',
  });
  return <div ref={api.containerRef} data-testid="viewport" />;
}

/** Pages the virtualizer has asked for, read off the slots it built — the same source `pageStatus` uses. */
const asked = () => new Set(api.virtualSlots.flatMap((slot) => slot.indices.map((index) => index + 1)));

/** Let the dimension sweep's `getPage` promises land, so a render count measures the report and nothing else. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const storedScroll = new WeakMap<Element, number>();

/** jsdom has none, and the hook measures the viewport with one. The size itself is faked below. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => VIEWPORT.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT.height });
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FR-37: every page state is produced, `unrequested` included', () => {
  it('answers `unrequested` for a page the ask does not hold, and `queued` for one it does', () => {
    render(<Probe numPages={200} />);
    const window = asked();
    expect(window.size).toBeGreaterThan(0);
    const inside = [...window][0]!;
    const outside = Array.from({ length: 200 }, (_, i) => i + 1).find((page) => !window.has(page))!;

    expect(api.pageStatus(inside)).toBe('queued');
    expect(api.pageStatus(outside)).toBe('unrequested');
  });

  it('moves the answer with a report, and a repeated report leaves it exactly where it was', async () => {
    render(<Probe numPages={200} />);
    const inside = [...asked()][0]!;
    expect(api.pageStatus(inside)).toBe('queued');

    await settle();
    act(() => api.reportPageStatus(inside, 'rendering'));
    expect(api.pageStatus(inside)).toBe('rendering');

    // The claim deliberately stops at the answer. A render *count* cannot be attributed to the report here:
    // the dimension sweep resolves `getPage` in batches of `DIM_CHUNK_SIZE`, so the host re-renders for the
    // sweep for as long as the document is being measured, and a count would be measuring that. What the
    // clause asks is that the state is produced and that re-reporting the same state is not a new state.
    const before = api.pageStatus(inside);
    act(() => api.reportPageStatus(inside, 'rendering'));
    expect(api.pageStatus(inside)).toBe(before);

    act(() => api.reportPageStatus(inside, 'rendered'));
    await settle();
    expect(api.pageStatus(inside)).toBe('rendered');
  });

  it('lets the ask beat the report: an unasked page that claims `rendered` is still `unrequested`', () => {
    render(<Probe numPages={200} />);
    const outside = Array.from({ length: 200 }, (_, i) => i + 1).find((page) => !asked().has(page))!;

    act(() => api.reportPageStatus(outside, 'rendered'));

    expect(api.pageStatus(outside)).toBe('unrequested');
    const reported: PdfPageStatus = api.pageStatus(outside);
    expect(reported).not.toBe('rendered');
  });

  it('stops reporting a page as painted once it has left the ask', () => {
    const view = render(<Probe numPages={200} />);
    const inside = ([...asked()][1] ?? [...asked()][0])!;
    act(() => api.reportPageStatus(inside, 'rendered'));
    expect(api.pageStatus(inside)).toBe('rendered');

    view.rerender(<Probe numPages={1} />);

    expect(asked().has(inside)).toBe(false);
    expect(api.pageStatus(inside)).toBe('unrequested');
  });
});
