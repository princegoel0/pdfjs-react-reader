/*
 * The shell's half of FR-39: it has to tell the index where the reader is. FR-26 is the same seam seen from the
 * other side — a host-supplied controller drives the bar, the marks and the counter, so the shell must never
 * reach around it to the built-in search.
 *
 * The hook is tested against a `focusPage` it is handed directly (`usePdfSearch.incremental.test.tsx`),
 * which proves it walks outward from whatever it is given and nothing about who gives it. This file is the
 * wire: `currentPage - 1`, in the engine's 1-based page and the index's 0-based one, read at the moment a
 * search starts rather than latched at mount — which is why the second case scrolls and expects a
 * different number.
 *
 * Both the virtualizer and the search hook are stubbed here on purpose. This is a test about two neighbours
 * agreeing on a value, and the cheapest honest way to see the value is to stop the neighbour that computes
 * it and the one that consumes it.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewerController } from './ViewerController';
import { ViewerProvider } from './ViewerContext';
import { DEFAULT_LABELS } from '../lib/labels';
import type { PdfFindController } from '../headless/usePdfSearch';
import type { PdfViewerHandle } from './PdfViewer';

const seen = vi.hoisted(() => ({ focusPage: [] as number[] }));
/** One stub for the whole file: the handle reaches it, and an assertion reads the calls back. */
const invalidatePages = vi.hoisted(() => vi.fn());

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'loading',
    doc: null,
    numPages: 0,
    isReady: false,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: vi.fn(),
  }),
}));

let page = 1;

vi.mock('../headless/usePdfVirtualizer', () => ({
  usePdfVirtualizer: () => ({
    containerRef: { current: null },
    virtualSlots: [],
    totalHeight: 0,
    get currentPage() {
      return page;
    },
    pageEstimate: { width: 612, height: 792 },
    resolvedScale: 1,
    scrollToPage: vi.fn(),
    reportPageDims: vi.fn(),
  }),
}));

vi.mock('../headless/usePdfSearch', async (importOriginal) => ({
  ...((await importOriginal<object>()) as object),
  usePdfSearch: (options: { focusPage?: number }) => {
    seen.focusPage.push(options.focusPage ?? -99);
    const controller: PdfFindController = {
      status: 'idle',
      progress: 0,
      query: '',
      options: { caseSensitive: false, wholeWord: false, regex: false },
      results: [],
      total: 0,
      counts: [],
      pagesWithMatches: 0,
      patternError: null,
      patternKind: null,
      activeIndex: -1,
      activeSeq: 0,
      complete: true,
      pagesIndexed: 0,
      pagesTotal: 0,
      search: vi.fn(),
      setActiveIndex: vi.fn(),
      nextMatch: vi.fn(),
      prevMatch: vi.fn(),
      clear: vi.fn(),
      invalidatePages,
    };
    return controller;
  },
}));

/** The controller the last render built, so a test can reach the handle the way a host's ref does. */
const captured = vi.hoisted(() => ({ controller: null as null | { handle: PdfViewerHandle } }));

function Harness({ find }: { find?: PdfFindController }) {
  const controller = useViewerController({
    src: '/fixtures/outline-sample.pdf',
    labels: DEFAULT_LABELS,
    find,
  });
  captured.controller = controller;
  return (
    <ViewerProvider controller={controller}>
      <span />
    </ViewerProvider>
  );
}

afterEach(() => {
  cleanup();
  seen.focusPage = [];
  page = 1;
  invalidatePages.mockClear();
  captured.controller = null;
});

describe('where the reader is, as the index learns it', () => {
  it('hands the search the page in view, 0-based', () => {
    page = 5;
    render(<Harness />);
    expect(seen.focusPage.at(-1)).toBe(4);
  });

  it('follows the reader down the document instead of latching on mount', () => {
    page = 1;
    const view = render(<Harness />);
    expect(seen.focusPage.at(-1)).toBe(0);

    page = 42;
    act(() => {
      view.rerender(<Harness />);
    });
    expect(seen.focusPage.at(-1)).toBe(41);
  });
});

/*
 * FR-39's "offered to the host", seen from the handle. The hook has had `invalidatePages` since `0.11` and
 * the shell never carried it out, so a host that composes `PdfViewer` — rather than `usePdfSearch` itself —
 * had no way to say a page is no longer what was indexed. Two things are asserted: that the handle offers
 * it, and that the numbering is converted *at the handle*, because every page a handle names is 1-based
 * and every page the index names is not. A wrong conversion is invisible until someone invalidates page 8
 * and the viewer re-reads page 9.
 */
describe('what the handle offers (FR-39)', () => {
  it('gives the host a per-page invalidation, in the handle’s own numbering', () => {
    render(<Harness />);
    const handle = captured.controller?.handle;
    expect(handle, 'the controller built no handle').toBeTruthy();

    act(() => handle?.invalidatePages([8, 1]));
    expect(invalidatePages).toHaveBeenCalledWith([7, 0]);
  });

  it('takes an empty list without asking for anything', () => {
    render(<Harness />);
    act(() => captured.controller?.handle.invalidatePages([]));
    expect(invalidatePages, 'nothing named, nothing dropped').not.toHaveBeenCalled();
  });

  it('answers rather than failing for a controller that keeps its own index', () => {
    /*
     * `invalidatePages` is optional on `PdfFindController` — a host-written find strategy has one of its
     * own, and there is nothing in ours for it to drop. The handle must be a no-op there, not a TypeError
     * reaching a host that did nothing wrong.
     */
    const hostWritten: PdfFindController = {
      status: 'ready',
      progress: 1,
      query: '',
      options: { caseSensitive: false, wholeWord: false, regex: false },
      results: [],
      total: 0,
      counts: [],
      pagesWithMatches: 0,
      patternError: null,
      patternKind: null,
      activeIndex: -1,
      activeSeq: 0,
      complete: true,
      pagesIndexed: 0,
      pagesTotal: 0,
      search: vi.fn(),
      setActiveIndex: vi.fn(),
      nextMatch: vi.fn(),
      prevMatch: vi.fn(),
      clear: vi.fn(),
    } as unknown as PdfFindController;

    render(<Harness find={hostWritten} />);
    expect(() => captured.controller?.handle.invalidatePages([3])).not.toThrow();
    expect(invalidatePages, 'the built-in hook was not the one in use').not.toHaveBeenCalled();
  });
});
