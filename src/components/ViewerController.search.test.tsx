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

const seen = vi.hoisted(() => ({ focusPage: [] as number[] }));

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
      invalidatePages: vi.fn(),
    };
    return controller;
  },
}));

function Harness() {
  const controller = useViewerController({ src: '/fixtures/outline-sample.pdf', labels: DEFAULT_LABELS });
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
