/*
 * FR-13: "Indexing reports progress and never blocks interaction: it yields to the event loop on a bounded
 * interval."
 *
 * This had no observation at all, and the reason it needed one is a case the code did not cover. Reading a page
 * from the worker is a round trip, so the shell's walk handed the thread back between pages *by accident of the
 * engine*. A host-supplied index (FR-40) has no round trip: every page resolves from an object, each `await` is
 * a microtask, and a chain of microtasks never lets a macrotask run. A 1,000-page supplied index could therefore
 * hold the main thread through the entire scan while calling `setProgress` on a path that no paint could observe
 * — which is the clause inverted, and it was invisible to every test written before it.
 *
 * Two instruments, because one claim has two halves:
 *
 * - the walk calls `yieldToEventLoop` exactly once per `YIELD_PAGES` (the **bound**), proved by a partial mock
 *   that records the call and returns the *real* promise, so an `await` on an already-resolved value could not
 *   pass for it;
 * - and a macrotask of the test's own runs between those calls (the **thread actually came back**), proved by a
 *   re-arming `setTimeout` whose count is sampled at each yield.
 *
 * The whole-document utility is tested against the same two properties through its own path, because it is the
 * other thing a host can call and it shares the constant rather than a copy of the rule.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTextIndex, extractAllText, YIELD_PAGES, type TextItemLike } from '../lib/search';
import { usePdfSearch } from './usePdfSearch';

/**
 * The yield, counted where it is called.
 *
 * `../lib/search` is partially mocked so `yieldToEventLoop` records each call *and returns the real promise*,
 * which is the only way to tell a bounded yield from an `await` on anything: a wrapper that resolved immediately
 * would satisfy every promise-chain assertion in this file while giving the event loop nothing. What is recorded
 * alongside the call is how many of the test's own macrotasks had run by then.
 */
const yieldProbe = vi.hoisted(() => ({
  calls: [] as number[],
  ticksAtCall: (() => 0) as () => number,
}));

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual.yieldToEventLoop as () => Promise<void>;
  return {
    ...actual,
    yieldToEventLoop: () => {
      yieldProbe.calls.push(yieldProbe.ticksAtCall());
      return real();
    },
  };
});

const NEEDLE = 'quux';

/** A page's text: the needle on the pages named in `hits`, ordinary prose elsewhere. */
function itemsFor(page: number, hits: Set<number>): TextItemLike[] {
  return [
    { str: hits.has(page) ? `${NEEDLE} on page ${page + 1}` : `page ${page + 1} heading`, hasEOL: true },
    { str: `page ${page + 1} body`, hasEOL: true },
  ];
}

/** A document whose every page answers at once, so nothing but the walk's own yield frees the thread. */
function instantDoc(
  total: number,
  hits = new Set<number>(),
  sample?: (page: number) => void,
): PDFDocumentProxy {
  return {
    numPages: total,
    getPage: async (pageNumber: number) => {
      const page = pageNumber - 1;
      sample?.(page);
      return {
        getTextContent: async () => ({ items: itemsFor(page, hits) }),
      };
    },
  } as unknown as PDFDocumentProxy;
}

/** A supplied index for the whole document: the case with no worker round trip to yield on. */
function fullIndex(total: number, hits: Set<number>) {
  return buildTextIndex(Array.from({ length: total }, (_, page) => itemsFor(page, hits)));
}

/**
 * A macrotask that keeps re-arming while the walk runs.
 *
 * It can only advance on a turn of the event loop, so the value sampled at each yield climbing is proof the loop
 * got that turn rather than that a promise happened to resolve.
 */
function startTicker() {
  const state = { ticks: 0, running: true };
  const tick = () => {
    state.ticks += 1;
    if (state.running) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return {
    get ticks(): number {
      return state.ticks;
    },
    stop: () => {
      state.running = false;
    },
  };
}

afterEach(() => {
  yieldProbe.calls = [];
  yieldProbe.ticksAtCall = () => 0;
});

describe('the shell’s own walk yields on a bound (FR-13)', () => {
  it('hands the loop a turn every YIELD_PAGES pages, on the path with no worker round trip', async () => {
    const total = 4 * YIELD_PAGES;
    const hits = new Set([0, total - 1]);
    const ticker = startTicker();
    yieldProbe.ticksAtCall = () => ticker.ticks;
    const doc = instantDoc(total);

    const { result } = renderHook(() =>
      usePdfSearch({ doc, index: fullIndex(total, hits) as never }),
    );
    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(result.current.complete).toBe(true));
    ticker.stop();

    // The bound itself: one yield per five pages, and no more — a yield every page would be a slower walk and a
    // different sentence than the one the requirement asks for.
    expect(yieldProbe.calls, 'the walk did not hand the thread back').toHaveLength(total / YIELD_PAGES);
    // And every hand-back was a distinct turn of the loop, not the same turn counted four times.
    expect(yieldProbe.calls, `the loop turned ${new Set(yieldProbe.calls).size} times across the walk`).toEqual(
      [...yieldProbe.calls].sort((a, b) => a - b),
    );
    expect(new Set(yieldProbe.calls).size).toBe(yieldProbe.calls.length);
    // The index was the source all the way through: a supplied index never reaches the document.
    expect(result.current.results.map((match) => match.pageIndex)).toEqual([0, total - 1]);
  });

  it('publishes progress that a host could paint, not only values readable at the end', async () => {
    /*
     * Deferred rather than timed: "progress was observable mid-walk" has to be a fact the test controls, so the
     * page reads are promises the test settles. Page 1 answered, pages 2 and 3 not yet — a walk that reported
     * only 0 and 1 would have nothing to show here, and one that reported 1 would be claiming a finished index
     * it had not built.
     */
    const waiters = new Map<number, (content: { items: TextItemLike[] }) => void>();
    const doc = {
      numPages: 3,
      getPage: (pageNumber: number) =>
        Promise.resolve({
          getTextContent: () =>
            new Promise<{ items: TextItemLike[] }>((resolve) => {
              waiters.set(pageNumber - 1, resolve);
            }),
        }),
    } as unknown as PDFDocumentProxy;

    const { result } = renderHook(() => usePdfSearch({ doc }));
    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(waiters.has(0)).toBe(true));

    act(() => {
      waiters.get(0)?.({ items: itemsFor(0, new Set([0])) });
      waiters.delete(0);
    });
    await waitFor(() => expect(result.current.progress).toBeGreaterThan(0));
    expect(result.current.complete, 'a two-page gap was called a finished index').toBe(false);
    expect(result.current.progress).toBeLessThan(1);

    act(() => {
      waiters.get(1)?.({ items: itemsFor(1, new Set()) });
      waiters.delete(1);
    });
    // Page 3 is only asked for once page 2 has been answered, so its waiter has to be waited for rather than
    // assumed to exist — resolving a page the walk has not reached yet would leave the scan waiting forever.
    await waitFor(() => expect(waiters.has(2)).toBe(true));
    act(() => {
      waiters.get(2)?.({ items: itemsFor(2, new Set([2])) });
      waiters.delete(2);
    });
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.progress).toBe(1);
    expect(result.current.results.map((match) => match.pageIndex)).toEqual([0, 2]);
  });
});

describe('the whole-document utility yields on the same bound (FR-13)', () => {
  it('hands the loop a turn every YIELD_PAGES pages of extraction', async () => {
    const total = 3 * YIELD_PAGES + 2;
    const ticker = startTicker();
    const sampled: number[] = [];
    /*
     * Sampled at the page read rather than by the probe above, because the utility's own call to
     * `yieldToEventLoop` is an in-module binding that a mock of the module cannot reach — only an *importer's*
     * call goes through the wrapper. So this asserts the same property from the other side: a macrotask of the
     * test's own got a turn between pages, and got one every few pages rather than once at the end.
     */
    const pages = await extractAllText(instantDoc(total, new Set(), () => sampled.push(ticker.ticks)));
    ticker.stop();

    expect(pages).toHaveLength(total);
    expect(sampled).toHaveLength(total);
    expect(sampled[0], 'a macrotask ran before the first page').toBe(0);
    expect(
      sampled[sampled.length - 1],
      `the extraction held the thread for all ${total} pages`,
    ).toBeGreaterThanOrEqual(Math.floor(total / YIELD_PAGES) - 1);
    expect(new Set(sampled).size, 'the loop turned only once, at the end').toBeGreaterThan(1);
    expect(sampled, 'a turn of the loop went backwards').toEqual([...sampled].sort((a, b) => a - b));
  });

  it('reports the progress fraction for every page it reads', async () => {
    const fractions: number[] = [];
    await extractAllText(instantDoc(7), (fraction) => fractions.push(fraction));

    expect(fractions).toHaveLength(7);
    expect(fractions.map((f) => Math.round(f * 7))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fractions.at(-1)).toBe(1);
  });
});
