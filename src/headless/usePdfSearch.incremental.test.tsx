/*
 * FR-39: the answer starts before the reading does, and says so while it is doing it.
 *
 * The requirement is not "faster" — that is a side effect. It is that a partial result must never present
 * itself as final, which is a claim about three separate things the tests below keep apart: the order
 * pages are read in (nearest first, so the first answer is the one the reader can see), the order matches
 * are *published* in (document order, always, so a hit never moves under the cursor), and the flag every
 * surface branches on while the walk is still running.
 *
 * Page reads are deferred by hand rather than timed, because "answered after one page of sixty" has to be
 * a fact the test controls, not a race it hopes to win. `getPage` records every page it was asked for, and
 * several of these assertions are about that list rather than about the DOM.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { outwardPageOrder, type TextItemLike } from '../lib/search';
import { usePdfSearch } from './usePdfSearch';

const TOTAL = 60;
/** The word that appears on exactly the pages named here. */
const NEEDLE = 'quux';

interface FakeDoc {
  doc: PDFDocumentProxy;
  /** Pages in the order they were asked for, 0-based. */
  asked: number[];
  /** Resolves the read of one page, so the test decides when a page is finished. */
  settle: (pageIndex: number, text?: string) => void;
  /** Drains the walk: settles each page as it is asked for, until nothing is outstanding. */
  settleAll: () => Promise<void>;
  /** Lets a test keep running after a rejected settle, whose rejection it has already asserted. */
  swallow: () => void;
}

function fakeDoc(hits: Record<number, string> = {}): FakeDoc {
  const asked: number[] = [];
  const waiters = new Map<number, (items: TextItemLike[]) => void>();
  const rejected = new Set<number>();

  // A page with no hit still has text — it just does not hold the needle, which is the difference
  // between "read and found nothing" and "never read", and the walk has to keep them apart.
  const textFor = (page: number): TextItemLike[] => [
    { str: hits[page] ?? `page ${page + 1} heading`, hasEOL: true },
    { str: `page ${page + 1} body`, hasEOL: true },
  ];

  const doc = {
    numPages: TOTAL,
    getPage: (pageNumber: number) => {
      const page = pageNumber - 1;
      asked.push(page);
      const pending = waiters.get(page);
      if (pending) {
        // A second read of a page means the test asked for it to be re-read; serve it at once.
        pending(textFor(page));
      }
      return Promise.resolve({
        getTextContent: async () => {
          if (rejected.has(page)) throw new Error(`page ${page + 1} was re-read after being dropped`);
          return {
            items: await new Promise<TextItemLike[]>((resolve) => {
              waiters.set(page, resolve);
            }),
          };
        },
      });
    },
  } as unknown as PDFDocumentProxy;

  const settleOne = (page: number, text?: string) => {
    const resolve = waiters.get(page);
    if (!resolve) return;
    waiters.delete(page);
    resolve(text === undefined ? textFor(page) : [{ str: text, hasEOL: true }]);
  };

  return {
    doc,
    asked,
    settle: (page, text) => {
      if (text !== undefined) rejected.add(page);
      settleOne(page, text);
    },
    // The walk is sequential, so one drain pass only ever answers the page it is standing on; it has to
    // keep going across turns until the last page has been read.
    settleAll: async () => {
      for (let round = 0; round < TOTAL + 5; round++) {
        const pending = [...waiters.keys()];
        for (const page of pending) settleOne(page);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (pending.length === 0 && waiters.size === 0) break;
      }
    },
    swallow: () => {
      // The walk is abandoned by now, so whatever it is still awaiting is never observed.
    },
  };
}

/** A document in which only these pages hold the needle. */
function docWithHits(hits: number[]): FakeDoc {
  const map: Record<number, string> = {};
  for (const page of hits) map[page] = `${NEEDLE} appears here`;
  return fakeDoc(map);
}

const noop = () => undefined;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('answering before the document is finished', () => {
  it('reads the page in view first, and answers from it alone', async () => {
    const doc = docWithHits([30]);
    const { result } = renderHook(() =>
      usePdfSearch({ doc: doc.doc, focusPage: 30 }),
    );

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(doc.asked[0]).toBe(30));
    act(() => doc.settle(30));

    // One page of sixty read, and the reader already has the answer and the caveat.
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.status).toBe('indexing');
    expect(result.current.complete).toBe(false);
    expect(result.current.pagesIndexed).toBe(1);
    expect(result.current.pagesTotal).toBe(TOTAL);
    expect(result.current.total).toBe(1);

    act(() => {
      result.current.clear();
    });
    doc.settleAll();
  });

  it('walks outward from where the reader is, forward before backward', async () => {
    const doc = docWithHits([]);
    const { result } = renderHook(() => usePdfSearch({ doc: doc.doc, focusPage: 10 }));

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(doc.asked.length).toBeGreaterThan(0));
    await doc.settleAll();
    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(doc.asked.slice(0, 7)).toEqual([10, 11, 9, 12, 8, 13, 7]);
    expect(doc.asked).toEqual(outwardPageOrder(TOTAL, 10));
  });

  it('publishes in document order even though the pages arrive in another', async () => {
    const doc = docWithHits([4, 18, 2]);
    const { result } = renderHook(() => usePdfSearch({ doc: doc.doc, focusPage: 18 }));

    act(() => result.current.search(NEEDLE));
    await doc.settleAll();
    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(result.current.results.map((match) => match.pageIndex)).toEqual([2, 4, 18]);
    // The counts are per page, so a results list can group by them without recounting.
    expect(result.current.counts[18]).toBe(1);
    expect(result.current.pagesWithMatches).toBe(3);
  });

  it('keeps the reader on their match while earlier pages fill in', async () => {
    const doc = docWithHits([0, 18]);
    const { result } = renderHook(() => usePdfSearch({ doc: doc.doc, focusPage: 18 }));

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(doc.asked.length).toBeGreaterThan(0));
    act(() => doc.settle(18));
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.results[0]!.pageIndex).toBe(18);

    // Page 0 lands in front of the cursor. The cursor is a position, so it has to move for the reader
    // not to; the identity of the match they were looking at is what stays put.
    act(() => doc.settle(0));
    await doc.settleAll();
    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(result.current.results.map((match) => match.pageIndex)).toEqual([0, 18]);
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.results[result.current.activeIndex]!.pageIndex).toBe(18);
  });

  it('comes back to idle with no error when the host stops caring', async () => {
    const doc = docWithHits([3]);
    const onError = vi.fn();
    const controller = new AbortController();
    const { result } = renderHook(() =>
      usePdfSearch({ doc: doc.doc, onError, signal: controller.signal, focusPage: 3 }),
    );

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(doc.asked.length).toBeGreaterThan(0));
    act(() => controller.abort());
    await doc.settleAll();

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.complete).toBe(true);
    expect(result.current.results).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  /*
   * FR-39's per-page invalidation, titled for what it proves. It used to say "re-reads only the page a
   * form field was typed into", which is a claim about *why* a host calls this and about form values in
   * particular — and the amended clause says plainly that a typed value never enters the index, because
   * `getTextContent()` reports a field's label and not what the reader wrote. What the assertion shows is
   * narrower and is the whole offer: one page named, one page re-read, the other fifty-nine untouched.
   */
  it('re-reads the one page it was named and none of the others', async () => {
    const doc = docWithHits([7]);
    const { result } = renderHook(() => usePdfSearch({ doc: doc.doc, focusPage: 0 }));

    act(() => result.current.search(NEEDLE));
    await doc.settleAll();
    await waitFor(() => expect(result.current.complete).toBe(true));
    const before = doc.asked.filter((page) => page === 7).length;
    const readSoFar = doc.asked.length;

    act(() => result.current.invalidatePages([7]));
    await waitFor(() => expect(doc.asked.filter((page) => page === 7).length).toBe(before + 1));
    // The text is now one that does not hold the needle, and the engine refuses a second read of it —
    // so the count of pages asked for is the assertion, and it is exact.
    act(() => doc.settle(7, 'nothing matches here any more'));
    await waitFor(() => expect(result.current.results).toHaveLength(0));
    // The clause in full: one page re-read, and the other fifty-nine not touched again.
    expect(doc.asked.length - readSoFar).toBe(1);
    doc.swallow();
  });

  it('does nothing on its own until a query is typed', async () => {
    const doc = docWithHits([1]);
    const { result } = renderHook(() => usePdfSearch({ doc: doc.doc, focusPage: 1 }));
    await act(async () => undefined);

    expect(result.current.status).toBe('idle');
    expect(result.current.complete).toBe(true);
    expect(doc.asked).toEqual([]);
  });
});
