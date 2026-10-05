/*
 * FR-26: the find bar, the marks and the counter are driven by a **host-supplied** controller.
 *
 * The seam is real and one line wide — `const search = find ?? builtInSearch` in `ViewerController` — and until
 * now it had never been exercised from the shell. `ViewerController.search.test.tsx`'s `PdfFindController` is
 * that file's own mock return value for `usePdfSearch`, so it proves the shell works with the built-in; the
 * host-shaped stub in `SearchBox.counter.test.tsx` is handed straight to `SearchBox`, so it proves the counter
 * follows injected state. Neither proves the clause: that a host which supplies its own strategy keeps the
 * built-in bar, the in-page marks and the page counts *instead of forking the shell*, and that the document is
 * not read for a search the shell was told not to run.
 *
 * Five claims:
 *
 *  - the object the shell publishes **is** the host's, by identity — a wrapper would be a second opinion on
 *    every field, and the bar reads whatever the shell publishes;
 *  - the maps that say **which page gets which marks** are built from the host's results, and the local index
 *    that lights the active one from the host's `activeIndex`;
 *  - a query asked of the shell reaches the host's `search` and **the document is never read** for it: no
 *    page's text content is asked for, which is the difference between "the host's strategy ran" and "both
 *    did, and the built-in's answer is what showed";
 *  - without a host controller the same question *does* read the document, so the third claim is not the
 *    story of a search that silently did nothing;
 *  - a host that publishes new results re-marks the pages on the next render, without the shell being asked
 *    again — the marks follow the controller, not the other way round.
 *
 * The dimension sweep calls `getPage` on its own, so "was the document read" is measured on the page proxy's
 * text methods rather than on the proxy fetch.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import { useViewerController } from './ViewerController';
import type { PdfFindController } from '../headless/usePdfSearch';
import type { PageMatch } from '../lib/search';

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

/** jsdom ships no scrolling at all, and the shell scrolls to the active match the moment there is one. */
const scrolledTo = vi.hoisted(() => [] as Array<{ top: number }>);
Element.prototype.scrollTo = function scrollTo(this: Element, options: unknown) {
  scrolledTo.push(typeof options === 'object' && options !== null ? (options as { top: number }) : { top: -1 });
} as typeof Element.prototype.scrollTo;

const state = vi.hoisted(() => ({
  find: null as PdfFindController | null,
  textRead: [] as number[],
}));

/** A two-page document whose only observable behaviour is whether anybody read a page's text. */
const doc = {
  numPages: 2,
  getPage: async (pageNumber: number) =>
    ({
      rotate: 0,
      getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({ width: 612 * scale, height: 792 * scale }),
      getTextContent: async () => {
        state.textRead.push(pageNumber);
        return { items: [{ str: 'MARKER one' }, { str: 'MARKER two' }], styles: {} };
      },
      streamTextContent: () => {
        state.textRead.push(pageNumber);
        return Promise.resolve({ items: [], close: () => {} });
      },
      getAnnotations: async () => [],
      cleanup: () => {},
    }) as unknown as PDFPageProxy,
  getOptionalContentConfig: () => Promise.reject(new Error('no /OCProperties')),
  getOutline: async () => null,
  getPageLabels: async () => null,
  getMetadata: async () => ({ info: {}, metadata: null }),
  cleanup: () => {},
} as unknown as PDFDocumentProxy;

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'ready',
    doc,
    numPages: 2,
    isReady: true,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: () => undefined,
  }),
}));

const match = (pageIndex: number, start: number): PageMatch =>
  ({ pageIndex, start, end: start + 6, length: 6, text: 'MARKER' }) as unknown as PageMatch;

/** A host strategy: it answers in one go, keeps its own state, and records what the shell asked it to do. */
function hostFind(initial: { results?: PageMatch[]; activeIndex?: number } = {}) {
  const controller: PdfFindController = {
    status: 'ready',
    progress: 1,
    query: '',
    options: { caseSensitive: false, wholeWord: false, regex: false },
    results: initial.results ?? [],
    total: (initial.results ?? []).length,
    counts: [0, 0],
    pagesWithMatches: 0,
    patternError: null,
    patternKind: null,
    indexError: null,
    activeIndex: initial.activeIndex ?? -1,
    activeSeq: 0,
    search: vi.fn(),
    setActiveIndex: vi.fn(),
    nextMatch: vi.fn(),
    prevMatch: vi.fn(),
    clear: vi.fn(),
    invalidatePages: vi.fn(),
  };
  return controller;
}

const probe: { controller: ReturnType<typeof useViewerController> | null } = { controller: null };

function Probe() {
  const controller = useViewerController({
    src: '/fixtures/page-order-sample.pdf',
    defaultScale: 1,
    ...(state.find ? { find: state.find } : null),
  });
  probe.controller = controller;
  // The virtualizer needs a scroll container, and the shell's page region normally supplies one.
  return <div ref={controller.containerRef as { current: HTMLDivElement | null }} />;
}

async function mount(find: PdfFindController | null) {
  state.find = find;
  await act(async () => {
    render(<Probe />);
  });
  await act(async () => undefined);
  if (!probe.controller) throw new Error('the probe never published its controller');
  // The controller value is replaced on every render, so a captured one is a snapshot of the render it came
  // from and cannot show what the host published next.
  return { live: () => probe.controller as ReturnType<typeof useViewerController> };
}

beforeEach(() => {
  state.textRead.length = 0;
  probe.controller = null;
});

afterEach(() => {
  cleanup();
  state.find = null;
});

describe('FR-26: a host-supplied find controller drives the bar and the marks', () => {
  it('publishes the host’s object itself, so every surface reads the same strategy', async () => {
    const host = hostFind();
    const { live } = await mount(host);

    expect(live().search, 'not a wrapper, not a merge — the object the host handed in').toBe(host);
  });

  it('marks the pages the host found matches on, and lights the one the host calls active', async () => {
    const host = hostFind({ results: [match(0, 4), match(0, 40), match(1, 2)], activeIndex: 1 });
    const { live } = await mount(host);

    const grouped = [...live().matchesByPage.entries()].map(([page, list]) => [page, list.length] as [number, number]);
    expect(grouped.sort((a, b) => a[0] - b[0]), 'the marks the pages are given').toEqual([
      [0, 2],
      [1, 1],
    ]);
    expect(
      [...live().activeLocalByPage.entries()],
      'the host’s second match is the second on its own page, which is what a page marks as the current one',
    ).toEqual([[0, 1]]);
  });

  it('asks the host to search, and reads no page of the document to answer', async () => {
    const host = hostFind();
    const { live } = await mount(host);

    act(() => {
      live().search.search('MARKER', { caseSensitive: true });
    });

    expect(host.search).toHaveBeenCalledWith('MARKER', { caseSensitive: true });
    expect(
      state.textRead,
      'the built-in index would have had to read the text; a host strategy must not be run as well',
    ).toEqual([]);
  });

  it('reads the document itself when no host controller was supplied, which is what makes the claim above mean it', async () => {
    const { live } = await mount(null);

    act(() => {
      live().search.search('MARKER');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(state.textRead.length, 'the built-in strategy did open the pages').toBeGreaterThan(0);
    expect(state.textRead).toContain(1);
  });

  it('re-marks the pages when the host publishes new results, without being asked again', async () => {
    const host = hostFind({ results: [match(0, 4)] });
    const { live } = await mount(host);
    expect([...live().matchesByPage.keys()]).toEqual([0]);

    host.results = [match(0, 4), match(1, 9)];
    host.activeIndex = 1;
    await act(async () => {
      render(<Probe />);
    });
    await act(async () => undefined);

    expect(
      [...live().matchesByPage.entries()]
        .map(([page, list]) => [page, list.length] as [number, number])
        .sort((a, b) => a[0] - b[0]),
      'the second page gained its marks from the host’s new list alone',
    ).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect([...live().activeLocalByPage.keys()], 'and the active match moved with it').toEqual([1]);
  });
});
