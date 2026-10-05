/*
 * FR-15's arithmetic, and FR-39's other half: what a document swap does to the index.
 *
 * Two clauses that live in the same hook and had the same kind of hole — a value the shell publishes and
 * nobody drives. `nextMatch` and `prevMatch` (FR-15: "next and previous") had appeared in tests only as
 * `vi.fn()` stubs, so the wrap-around at `usePdfSearch.ts:481-489` had no assertion: an inverted
 * direction, or an off-by-one at either end, kept the suite green. And "when the document itself is
 * replaced … the index built for the old one is discarded with it" (FR-39) was asserted nowhere at all,
 * even though the swap is the one thing that can put a stale page under a live result.
 *
 * The swap test is the interesting one, because the failure it guards is a race rather than a typo. The
 * walk is incremental, so pages of the *old* document can still be in flight when the new one arrives;
 * a late answer that lands in the new document's result list is a match on a page that does not exist,
 * and the counter would say "4 of 4" about three pages of it. Reads are therefore deferred by hand here:
 * the test decides when the old document's last page answers, which makes "it was dropped" a fact rather
 * than a hope the next microtask might win.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePdfSearch } from './usePdfSearch';
import type { TextItemLike } from '../lib/search';

const textItems = (text: string): TextItemLike[] => [{ str: text, hasEOL: true }];

/** A document that answers when the test says so, per page. */
function waitingDoc(texts: string[]) {
  const waiters = new Map<number, (items: TextItemLike[]) => void>();
  const asked: number[] = [];
  const doc = {
    numPages: texts.length,
    getPage: (pageNumber: number) => {
      const page = pageNumber - 1;
      asked.push(page);
      return Promise.resolve({
        getTextContent: async () => ({
          items: await new Promise<TextItemLike[]>((resolve) => {
            waiters.set(page, resolve);
          }),
        }),
      });
    },
  } as unknown as PDFDocumentProxy;
  return {
    doc,
    asked,
    /** Resolve every outstanding read, oldest page first, across the turns the walk needs. */
    async settleAll() {
      for (let round = 0; round < texts.length + 4; round += 1) {
        const pending = [...waiters.entries()];
        for (const [page, resolve] of pending) {
          waiters.delete(page);
          resolve(textItems(texts[page] ?? ''));
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (waiters.size === 0) break;
      }
    },
    /** Answer one page by hand, which is how a late arrival is staged. */
    release(page: number) {
      const resolve = waiters.get(page);
      if (!resolve) return false;
      waiters.delete(page);
      resolve(textItems(texts[page] ?? ''));
      return true;
    },
    outstanding: () => [...waiters.keys()],
  };
}

/** A document that has nothing to wait for. */
function readyDoc(texts: string[]): PDFDocumentProxy {
  return {
    numPages: texts.length,
    getPage: (pageNumber: number) =>
      Promise.resolve({
        getTextContent: async () => ({ items: textItems(texts[pageNumber - 1] ?? '') }),
      }),
  } as unknown as PDFDocumentProxy;
}

afterEach(() => vi.restoreAllMocks());

/**
 * Run a search and drain the walk.
 *
 * `complete` is true *before* a search starts and again after its first page publishes, so a test that
 * waits on it can read a half-indexed document as a finished one — which is how two of the cases below
 * first failed with a count of 2 where 3 was right. `status` reaches `'ready'` only at the end, and
 * draining inside `act` is how the existing search tests keep the walk's promises inside the test's own
 * turn.
 */
async function runSearch(
  result: { current: ReturnType<typeof usePdfSearch> },
  query: string,
  options?: Parameters<ReturnType<typeof usePdfSearch>['search']>[1],
) {
  await act(async () => {
    result.current.search(query, options);
  });
  await waitFor(() => expect(result.current.status).toBe('ready'));
}

describe('stepping through the answers (FR-15)', () => {
  const THREE = ['alpha on one', 'nothing here', 'alpha on three', 'nothing here', 'alpha on five'];

  it('walks forward, wraps past the last, and walks back through the same door', async () => {
    // Built once, outside the render callback. `usePdfSearch` resets its index whenever `doc` changes
    // identity, so a document constructed inside the callback is a new document on every publish —
    // which is an infinite loop over a five-page file and an out-of-memory worker over a big one.
    const doc = readyDoc(THREE);
    const { result } = renderHook(() => usePdfSearch({ doc, focusPage: 0 }));
    await runSearch(result, 'alpha');
    expect(result.current.total).toBe(3);
    expect(result.current.results.map((m) => m.pageIndex)).toEqual([0, 2, 4]);
    expect(result.current.activeIndex).toBe(0);

    const pagesVisited = async (steps: ('next' | 'prev')[]) => {
      const seen: number[] = [];
      for (const step of steps) {
        act(() => (step === 'next' ? result.current.nextMatch() : result.current.prevMatch()));
        const index = result.current.activeIndex;
        seen.push(result.current.results[index]?.pageIndex ?? -1);
      }
      return seen;
    };

    // Forward through all three, then over the end and back to the first: the wrap is the claim.
    expect(await pagesVisited(['next', 'next', 'next'])).toEqual([2, 4, 0]);
    // And backwards off the front, which is the other end an off-by-one can hide in.
    expect(await pagesVisited(['prev', 'prev'])).toEqual([4, 2]);
    // The counter the bar reads is this index plus one, and it never runs past the total: two steps
    // back from the first match lands on the second of three, which is position 2 of 3.
    expect(result.current.activeIndex + 1).toBe(2);
    expect(result.current.activeIndex + 1).toBeLessThanOrEqual(result.current.total);
    expect(result.current.activeIndex).toBeLessThan(result.current.total);
  });

  it('does not move a lone match, in either direction', async () => {
    const doc = readyDoc(['only alpha here', 'blank page']);
    const { result } = renderHook(() => usePdfSearch({ doc, focusPage: 0 }));
    await runSearch(result, 'alpha');
    expect(result.current.total).toBe(1);

    act(() => result.current.nextMatch());
    expect(result.current.activeIndex, 'one match is its own neighbour both ways').toBe(0);
    act(() => result.current.prevMatch());
    expect(result.current.activeIndex).toBe(0);
  });

  it('is inert when there is nothing to step through', async () => {
    const doc = readyDoc(['a', 'b']);
    const { result } = renderHook(() => usePdfSearch({ doc, focusPage: 0 }));
    await runSearch(result, 'zzz');
    expect(result.current.total).toBe(0);

    expect(() => {
      act(() => result.current.nextMatch());
      act(() => result.current.prevMatch());
    }).not.toThrow();
    expect(result.current.activeIndex, 'no cursor on an empty list').toBe(-1);
  });
});

describe('the options a search answers to (FR-15)', () => {
  it('takes fewer matches when case has to match too', async () => {
    const doc = readyDoc(['Alpha and alpha', 'ALPHA again', 'nothing']);
    const { result } = renderHook(() => usePdfSearch({ doc, focusPage: 0 }));

    await runSearch(result, 'alpha');
    expect(result.current.total, 'insensitive finds every spelling').toBe(3);

    await runSearch(result, 'alpha', { caseSensitive: true });
    expect(result.current.options.caseSensitive, 'and the published options say which ran').toBe(true);
    expect(result.current.total, 'sensitive finds only the exact one').toBe(1);
    expect(result.current.results.map((m) => m.pageIndex)).toEqual([0]);
  });

  it('takes fewer matches when the word has to be whole', async () => {
    const doc = readyDoc(['alphabet soup', 'the word alpha']);
    const { result } = renderHook(() => usePdfSearch({ doc, focusPage: 0 }));
    await runSearch(result, 'alpha');
    expect(result.current.total, 'a prefix inside a longer word counts').toBe(2);

    await runSearch(result, 'alpha', { wholeWord: true });
    expect(result.current.options.wholeWord, 'and the published options say which ran').toBe(true);
    expect(result.current.total, 'and stops counting when it does not').toBe(1);
    expect(result.current.results.map((m) => m.pageIndex)).toEqual([1]);
  });
});

describe('a document replaced under the index (FR-39)', () => {
  it('drops the matches it had, and answers only from the new one', async () => {
    const first = readyDoc(['alpha one', 'alpha two', 'nothing']);
    const { result, rerender } = renderHook(
      ({ d }: { d: PDFDocumentProxy }) => usePdfSearch({ doc: d, focusPage: 0 }),
      { initialProps: { d: first } },
    );
    await runSearch(result, 'alpha');
    expect(result.current.total).toBe(2);
    const before = result.current.results.map((m) => m.pageIndex);
    expect(before).toEqual([0, 1]);

    // A different document, in which the same query holds once. `numPages` differs too, which is what
    // makes a surviving result a lie rather than merely a stale one.
    const second = readyDoc(['alpha only here']);
    rerender({ d: second });
    await waitFor(() => expect(result.current.results).toHaveLength(0));

    expect(result.current.total, 'the old document’s answers are not this document’s').toBe(0);
    expect(result.current.query, 'the outstanding query went with the index').toBe('');
    expect(result.current.pagesTotal, 'nothing is being counted yet').toBe(0);

    await runSearch(result, 'alpha');
    expect(result.current.total).toBe(1);
    expect(result.current.pagesTotal, 'and the arithmetic re-based on the new file').toBe(1);
  });

  it('refuses a late page of the old document, even when it answers after the swap', async () => {
    /*
     * The race. The walk is sequential and each read is a promise, so a page can be outstanding at the
     * moment `doc` changes: the reset runs, the new document is in place, and then the old document's
     * third page finally hands back text that matches. Publishing it would put a match on a page of a
     * file that is no longer open under a counter that says this is the answer.
     */
    const slow = waitingDoc(['alpha here', 'nothing', 'alpha there']);
    const { result, rerender } = renderHook(
      ({ d }: { d: PDFDocumentProxy }) => usePdfSearch({ doc: d, focusPage: 0 }),
      { initialProps: { d: slow.doc } },
    );
    act(() => result.current.search('alpha'));
    await waitFor(() => expect(slow.outstanding().length).toBeGreaterThan(0));
    expect(result.current.complete, 'the walk was still running when the swap happened').toBe(false);

    rerender({ d: readyDoc(['nothing matches in this one']) });
    await waitFor(() => expect(result.current.results).toHaveLength(0));

    // Whatever the old document answers now arrives after its own run id was retired.
    for (let page = 0; page < 3; page += 1) slow.release(page);
    await slow.settleAll();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.results, 'a stale page cannot publish itself into a new document').toEqual([]);
    expect(result.current.total).toBe(0);
    /*
     * And it stopped *reading*. The discarded write is only half of what a swap has to do: the walk is a
     * loop over the old document's page list, and a run that is not retired keeps asking that file for
     * every page it has — a thousand `getTextContent()` round trips for a document nobody is looking at,
     * each answer dropped on the floor. `asked` is the count that shows the loop was stopped rather than
     * merely ignored, and it is the reason `runIdRef` moves on a swap and not only on a new search.
     */
    expect(slow.asked.length, 'the document that is gone is not still being read').toBe(1);
    /*
     * The state the retired walk would have left behind. Its loop publishes at the end of every page list
     * it finishes, and the last thing it does is declare the index complete — against `total`, which is the
     * page count of the file it was started on. With the run retired, none of that reaches the reader:
     * the swap reset the numbers and nothing after it republished them.
     */
    expect(result.current.pagesIndexed, 'not the old file’s page count, reported as progress').toBe(0);
    expect(result.current.status, 'the walk was superseded, not completed').toBe('idle');
  });

  it('publishes nothing stale when an invalidation follows the swap', async () => {
    /*
     * The same race one action later, on the path the *handle* now offers. A page of the old document lands
     * after the swap; the retired walk is stopped from publishing it; and then the host calls the
     * invalidation this tier exposes on `PdfViewerHandle`, whose publish step reads the slots as they stand.
     * It finds nothing, for two reasons the test names: an invalidation with no outstanding query returns
     * before it publishes, and a search of the new document starts from empty slots.
     *
     * Recorded honestly: a write-side guard in `scanPages` was tried for this case and removed. With the
     * publish-side check in place it had no reachable consequence — three counterfactuals to prove it, and
     * a line of code that cannot fail is a line that should not be there.
     */
    const slow = waitingDoc(['alpha here', 'nothing', 'alpha there']);
    const { result, rerender } = renderHook(
      ({ d }: { d: PDFDocumentProxy }) => usePdfSearch({ doc: d, focusPage: 0 }),
      { initialProps: { d: slow.doc } },
    );
    await act(async () => result.current.search('alpha'));
    await waitFor(() => expect(slow.outstanding().length).toBeGreaterThan(0));

    const replacement = waitingDoc(['nothing matches in this one at all']);
    rerender({ d: replacement.doc });
    // The old document's in-flight read comes home, and is dropped.
    for (let page = 0; page < 3; page += 1) slow.release(page);
    await slow.settleAll();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.results).toEqual([]);

    // Now the host says a page of the new document changed — the ordinary reason to call this at all.
    await act(async () => {
      result.current.invalidatePages([0]);
    });
    await replacement.settleAll();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.results, 'the next publish belongs to this document alone').toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('re-reads the new document rather than trusting the cache that named the old one', async () => {
    /*
     * The page text cache is keyed on the document object, so this case is about the second document
     * being *read* — not about a plausible-looking answer that came from nowhere. `asked` is the proof:
     * a swap that silently re-used the old file's text would search zero pages of the new one.
     */
    const first = waitingDoc(['alpha first document']);
    const { result, rerender } = renderHook(
      ({ d }: { d: PDFDocumentProxy }) => usePdfSearch({ doc: d, focusPage: 0 }),
      { initialProps: { d: first.doc } },
    );
    await act(async () => result.current.search('alpha'));
    await first.settleAll();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.total).toBe(1);

    const second = waitingDoc(['alpha second document', 'more', 'and more']);
    rerender({ d: second.doc });
    await act(async () => result.current.search('alpha'));
    await second.settleAll();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.total).toBe(1);
    expect(result.current.results[0]?.pageIndex).toBe(0);
    expect(second.asked.length, 'the new document was the one read').toBeGreaterThan(0);
    expect(result.current.pagesTotal).toBe(3);
  });
});
