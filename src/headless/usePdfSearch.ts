import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  countPerPage,
  extractPageText,
  validateTextIndex,
  YIELD_PAGES,
  yieldToEventLoop,
  type ExternalTextIndex,
  findPageMatches,
  invalidatePageText,
  outwardPageOrder,
  planFind,
  type FindPlan,
  type FindPlanError,
  type PageMatch,
  type ResolvedSearchOptions,
  type SearchOptions,
} from '../lib/search';
import type { PdfError } from '../lib/errors';
import { toPdfError } from '../lib/errors';
import { abortError, isCancellation } from '../lib/abort';
import type { PageTextIndex } from '../lib/search';

export type SearchStatus = 'idle' | 'indexing' | 'ready' | 'error';

export interface UsePdfSearchOptions {
  doc: PDFDocumentProxy | null;
  onError?: (error: PdfError) => void;
  /**
   * Stop an in-flight index. Indexing is the longest thing this package does on the main thread, and until
   * now the only way to stop it was to unmount. Aborting returns the hook to `idle` and reports no error:
   * a cancellation is not a failure (FR-04), and a caller that cancelled has already stopped caring.
   */
  signal?: AbortSignal;
  /**
   * The page the reader is looking at, 0-based. Indexing starts there and walks outward, so the first
   * answer comes from the part of the document the reader can actually see (FR-39).
   *
   * Read when a search starts and never watched afterwards. A hook that restarted on every scroll would
   * never finish on the documents this exists for, and the reader would watch the counter reset each time
   * they moved.
   */
  focusPage?: number;
  /**
   * A text index somebody else built — on a server, once, for every reader — instead of the viewer
   * re-extracting the same words in every browser (FR-40).
   *
   * Validated against the document's page count before it is used, and refused if it does not agree: a
   * stale index has exactly the right shape and entirely wrong words, which is the one failure that would
   * paint marks onto text that is not there. A page the index does not describe is read from the document
   * rather than skipped, so a partial index degrades to the built-in path page by page.
   */
  index?: ExternalTextIndex | null;
}

export interface UsePdfSearchResult {
  status: SearchStatus;
  /** Pages whose text has been read, over `pagesTotal`. */
  progress: number;
  /** The query from the most recent search call. */
  query: string;
  options: ResolvedSearchOptions;
  /**
   * All matches found so far, in document order — reading order, not the order the pages were indexed
   * in, which is why a match never moves once the reader has it.
   */
  results: PageMatch[];
  total: number;
  /**
   * Matches per page, index 0 being page 1, zeros included. A results list groups by
   * this instead of recounting, and a page with no match still occupies a slot.
   */
  counts: number[];
  /** Pages holding at least one match — the honest answer to "found on how many pages". */
  pagesWithMatches: number;
  /**
   * Why a regex query produced no pattern, or `null`. Both this sentence and `patternKind` below come from
   * one internal value, so the wording a reader sees cannot disagree with the kind a host branches on — and
   * branching on the wording is the thing `patternKind` exists to avoid.
   */
  patternError: string | null;
  /**
   * `'too-long'` when the pattern is over `maxPatternUnits`, `'invalid'` when the engine refused to compile
   * it. The two want different answers on screen — one is "shorten it", the other "that is not an
   * expression" — and neither is the empty result, which is what a search that never ran would otherwise
   * look like.
   */
  patternKind: FindPlanError | null;
  /**
   * Why a supplied `index` was not used, or `null`. The search still runs — the document is read instead —
   * so this is a diagnostic for the host that built the index, not a failure the reader sees.
   */
  indexError: string | null;
  /** Index into results of the current match, -1 when there are none. */
  activeIndex: number;
  /**
   * Increments every time the active match is (re)selected, including when a
   * search completes. Parents can watch this to scroll the active match into
   * view, including when the index itself did not change.
   */
  activeSeq: number;
  /**
   * False while pages are still being read, which makes `total`, `counts` and `pagesWithMatches` floors
   * rather than totals. FR-39's clause is that a partial answer says so, and this is the value every
   * surface that shows one of those numbers has to branch on — `undefined` from a host-written
   * controller means that controller answers in one go, which is what it was doing before this existed.
   */
  complete: boolean;
  /** Pages whose text has been read for the current query. */
  pagesIndexed: number;
  /** Pages in the document, so a surface can say "17 so far, in the first 40 of 1,000". */
  pagesTotal: number;
  search: (query: string, options?: SearchOptions) => void;
  setActiveIndex: (index: number) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  clear: () => void;
  /**
   * Drop the cached text for these pages and re-scan just them.
   *
   * The measured limit, stated here because it is the opposite of what this looks like: the text the index
   * holds is the page's content stream and nothing else. On `form-sample.pdf` `getTextContent()` returns
   * `Full name:` and `Notes:` — the labels — and never the value a reader typed, and the call takes no
   * `annotationStorage` at all, so a sticky note's text is not in it either. An edit therefore does not
   * become searchable by calling this, and the shell does not call it on form changes. What a host gets is
   * the cheaper half of FR-39: say "page 7 is not what you indexed" and have the re-read cost one page
   * rather than the file, which on `long-sample.pdf` is the difference between frames and seconds.
   */
  invalidatePages: (pages: number[]) => void;
}

const DEFAULT_OPTIONS: ResolvedSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/*
 * Publishing is a React render, and a render re-marks every mounted page. One per page would be a
 * thousand renders on `long-sample.pdf` — slower than the single render it replaces — so results go out
 * on the first page (that is the whole point), then at whichever of these two limits comes first.
 */
const FLUSH_PAGES = 25;
const FLUSH_MS = 120;

/**
 * The contract the viewer's find UI is built on.
 *
 * `usePdfSearch` returns exactly this, and `PdfViewer`'s `find` prop accepts any
 * object that does — so a host with its own matching strategy (a server-side index,
 * a stemmed or fuzzy search, a synonym list) supplies the behaviour and keeps the
 * built-in find bar, marks and page counts instead of forking the shell. It is
 * structural on purpose: there is no interface to implement, only these members to
 * provide.
 *
 * The four incremental members are optional here and only here, because a host that wrote a controller
 * before `0.11` has nothing to say about partial answers and must not have to add them to keep compiling.
 * The shell reads `complete === false`, which such a controller never reports.
 */
export interface PdfFindController
  extends Omit<
    UsePdfSearchResult,
    'complete' | 'pagesIndexed' | 'pagesTotal' | 'invalidatePages' | 'indexError'
  > {
  indexError?: string | null;
  complete?: boolean;
  pagesIndexed?: number;
  pagesTotal?: number;
  invalidatePages?: (pages: number[]) => void;
}

export function usePdfSearch(options: UsePdfSearchOptions): UsePdfSearchResult {
  const { doc, onError, signal, focusPage = 0, index } = options;
  // Ref-read like the other callbacks: `search` is memoised on `[doc]`, so a host holding a fresh
  // controller per render must not get a new `search` — and must not get a restart either.
  const signalRef = useRef(signal);
  signalRef.current = signal;
  const focusRef = useRef(focusPage);
  focusRef.current = focusPage;
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [query, setQuery] = useState('');
  const [resolvedOptions, setResolvedOptions] = useState<ResolvedSearchOptions>(DEFAULT_OPTIONS);
  const [results, setResults] = useState<PageMatch[]>([]);
  const [counts, setCounts] = useState<number[]>([]);
  const [patternProblem, setPatternProblem] = useState<{
    message: string;
    kind: FindPlanError;
  } | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [activeIndex, setActiveIndexState] = useState(-1);
  const [activeSeq, setActiveSeq] = useState(0);
  const [complete, setComplete] = useState(true);
  const [pagesIndexed, setPagesIndexed] = useState(0);
  const [pagesTotal, setPagesTotal] = useState(0);

  // Latest-value refs so async completions and callbacks never see stale data.
  const runIdRef = useRef(0);
  const resultsRef = useRef<PageMatch[]>([]);
  resultsRef.current = results;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  /**
   * Matches as they land, indexed by page rather than appended, so the published list can be rebuilt in
   * document order however the pages arrived. The active match is held by object identity for the same
   * reason: a list that grows in front of the reader's cursor must not move it.
   */
  const byPageRef = useRef<Array<PageMatch[] | undefined>>([]);
  const activeMatchRef = useRef<PageMatch | null>(null);
  const queryRef = useRef('');
  const completeRef = useRef(true);
  const planRef = useRef<FindPlan | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  /** The supplied index, once it has been checked against this document. `null` means read the pages. */
  const usableIndexRef = useRef<ExternalTextIndex | null>(null);
  /** Consecutive pages served from that index rather than the worker — what FR-13's yield counts. */
  const suppliedRunRef = useRef(0);

  /*
   * Everything a search leaves behind, in one function. Three paths clear it — a new document, the reader
   * dismissing the search, and a walk the host abandoned — and a list of setters maintained three times is
   * a list where one of them forgets a field.
   */
  const reset = useCallback((nextStatus: SearchStatus) => {
    runIdRef.current++;
    byPageRef.current = [];
    activeMatchRef.current = null;
    planRef.current = null;
    queryRef.current = '';
    resultsRef.current = [];
    setStatus(nextStatus);
    setProgress(0);
    setQuery('');
    setResults([]);
    setCounts([]);
    setPatternProblem(null);
    setIndexError(null);
    usableIndexRef.current = null;
    suppliedRunRef.current = 0;
    setActiveIndexState(-1);
    setComplete(true);
    completeRef.current = true;
    setPagesIndexed(0);
  }, []);

  /** Rebuilds the reading-order list from the per-page slots and publishes it. */
  const publish = useCallback((indexed: number, total: number, done: boolean) => {
    const flat: PageMatch[] = [];
    for (const found of byPageRef.current) {
      if (!found) continue;
      for (const match of found) flat.push(match);
    }
    resultsRef.current = flat;
    setResults(flat);
    setCounts(countPerPage(flat, total));
    setPagesIndexed(indexed);
    setProgress(total === 0 ? 0 : indexed / total);
    setComplete(done);
    completeRef.current = done;

    const held = activeMatchRef.current;
    if (held) {
      // Same object, new position — or gone, which only happens when something invalidated the page it
      // was on, and then the first match is the nearest thing to where the reader was.
      const at = flat.indexOf(held);
      setActiveIndexState(at >= 0 ? at : flat.length > 0 ? 0 : -1);
    } else if (flat.length > 0) {
      // Nobody has moved the cursor, so it goes to the first match — and is then held, because a later
      // publish that re-selected would scroll the reader back to the top of a list that only grew.
      activeMatchRef.current = flat[0]!;
      setActiveIndexState(0);
      setActiveSeq((seq) => seq + 1);
    } else {
      setActiveIndexState(-1);
    }
  }, []);

  /*
   * A new document invalidates everything outstanding — and this is the line where that claim was false.
   *
   * `reset()` already moved `runIdRef`, so a swap did retire the walk. What it did not do was *stop* it:
   * both of the loop's run-id checks sat before an `await`, so the page already in flight came home after
   * the reset and the walk went on to publish — the old document's matches folded out of the slots it had
   * just refilled, and the old document's page count reported as this one's progress. Measured by
   * `usePdfSearch.controls.test.tsx`, which fails in that shape when the check is moved back.
   *
   * FR-39's "when the document itself is replaced … the index built for the old one is discarded with it"
   * is the requirement, and a discard that happens one publish too late is not a discard.
   */
  useEffect(() => {
    reset('idle');
    setPagesTotal(0);
  }, [doc, reset]);

  /**
   * One page of text, from the published index where it has one and from the document where it does not.
   *
   * `items` stays empty for an indexed page: nothing downstream reads it — a match is placed by `itemEnds`,
   * which is precisely the part a host has to supply — and inventing one item per span here would be a
   * second answer to a question the index already answered.
   */
  /**
   * One page's text, from whoever has it.
   *
   * FR-13's bounded yield lives here rather than in the walk, because only one of these two branches needs it.
   * A worker read is a round trip: its `await` is a macrotask, so the thread comes back every page and the
   * interval is one page. A host-supplied index (FR-40) is a property lookup on an object — the promise below is
   * already resolved, its `await` continues in a microtask, and a chain of microtasks never lets a macrotask run,
   * so a 1,000-page supplied index would hold the main thread through the whole scan while publishing progress
   * nothing could paint. Counting those reads puts the bound back where the engine did not provide one.
   */
  const readPage = useCallback(
    async (pageIndex: number): Promise<PageTextIndex> => {
      const supplied = usableIndexRef.current?.pages[pageIndex];
      if (!supplied) {
        suppliedRunRef.current = 0;
        return extractPageText(doc!, pageIndex);
      }
      suppliedRunRef.current += 1;
      const text: PageTextIndex = { items: [], text: supplied.text, itemEnds: supplied.itemEnds };
      // Yielded *after* the page is in hand and before it is returned, so the walk's own bookkeeping sees the
      // same page it would have seen immediately — only later, with a turn of the loop in between.
      if (suppliedRunRef.current % YIELD_PAGES === 0) await yieldToEventLoop();
      return text;
    },
    [doc],
  );

  /** Scans the given pages into the per-page slots. Returns nothing; the caller publishes. */
  const scanPages = useCallback(async (pages: readonly number[]) => {
    const plan = planRef.current;
    if (!doc || !plan || plan.error) return;
    for (const page of pages) {
      if (page < 0 || page >= doc.numPages) continue;
      const found = findPageMatches(await readPage(page), plan);
      // `findPageMatches` reports -1: it knows a page's text, not which page it was.
      for (const match of found) match.pageIndex = page;
      byPageRef.current[page] = found;
    }
  }, [doc]);

  const search = useCallback(
    (nextQuery: string, searchOptions?: SearchOptions) => {
      const runId = ++runIdRef.current;
      const resolved: ResolvedSearchOptions = {
        caseSensitive: searchOptions?.caseSensitive ?? false,
        wholeWord: searchOptions?.wholeWord ?? false,
        regex: searchOptions?.regex ?? false,
        // Read at the start of the search and never re-read: one query is planned against one ceiling,
        // the same rule FR-34 sets for headers and FR-35 for the retry policy.
        ...(searchOptions?.maxPatternUnits === undefined
          ? null
          : { maxPatternUnits: searchOptions.maxPatternUnits }),
      };
      queryRef.current = nextQuery;
      activeMatchRef.current = null;
      setQuery(nextQuery);
      setResolvedOptions(resolved);
      setActiveIndexState(-1);
      setPatternProblem(null);

      if (!doc || nextQuery.length === 0) {
        setStatus(doc ? 'ready' : 'idle');
        setProgress(0);
        setComplete(true);
        completeRef.current = true;
        byPageRef.current = [];
        setPagesIndexed(0);
        setResults([]);
        return;
      }

      setStatus('indexing');
      setProgress(0);
      setComplete(false);
      completeRef.current = false;
      byPageRef.current = [];
      setPagesIndexed(0);
      setPagesTotal(doc.numPages);

      (async () => {
        try {
          // Planned before the expensive part, so a malformed expression is reported
          // immediately instead of after every page has been read for nothing.
          // Checked against the document rather than trusted because it is well-formed: the shape a stale
          // index has is exactly the shape a good one has.
          setIndexError(null);
          usableIndexRef.current = null;
          if (indexRef.current) {
            const checked = validateTextIndex(indexRef.current, doc.numPages);
            if (checked.error !== null) setIndexError(checked.error);
            else usableIndexRef.current = checked.index;
          }

          const plan: FindPlan = planFind(nextQuery, resolved);
          planRef.current = plan;
          if (plan.error) {
            if (runIdRef.current !== runId) return;
            setPatternProblem({ message: plan.error, kind: plan.errorKind ?? 'invalid' });
            setStatus('error');
            setProgress(0);
            setComplete(true);
            completeRef.current = true;
            setResults([]);
            setCounts([]);
            return;
          }

          const total = doc.numPages;
          const order = outwardPageOrder(total, focusRef.current);
          let indexed = 0;
          let sinceFlush = 0;
          let lastFlush = Date.now();
          for (const page of order) {
            // Checked per page rather than up front: this loop is the longest thing the package does on
            // the main thread, and a host that cancels a thousand-page index should wait at most one
            // page, not the file.
            if (runIdRef.current !== runId) return;
            if (signalRef.current?.aborted) throw abortError('Text indexing was aborted.', 'SEARCH_CANCELLED');
            await scanPages([page]);
            /*
             * Checked again after the read, because a run can be superseded while a page is in flight, and
             * a retired walk has nothing left to publish: `total` in the numbers below is the page count of
             * the document this pass started on, so publishing it into the state a new document owns is the
             * same lie as keeping its matches — progress about an index that was discarded. `invalidatePages`
             * already re-checks after its own await; this loop is the one that was missing it.
             */
            if (runIdRef.current !== runId) return;
            indexed++;
            sinceFlush++;
            const now = Date.now();
            // The first page always publishes: an answer that waits for the batching window is the
            // behaviour this whole change exists to remove.
            if (indexed === 1 || sinceFlush >= FLUSH_PAGES || now - lastFlush >= FLUSH_MS) {
              lastFlush = now;
              sinceFlush = 0;
              publish(indexed, total, indexed === total);
            }
          }
          if (runIdRef.current !== runId) return;
          setStatus('ready');
          publish(indexed, total, true);
        } catch (err) {
          if (runIdRef.current !== runId) return;
          // A host that cancelled is not a host that hit a fault: back to idle, no error surfaced, no
          // onError. This is FR-04's rule applied to the one operation whose cancellation takes seconds
          // rather than frames.
          // Idle means nothing on screen: a half-shown list with a cursor in it is a result the reader
          // asked to stop having.
          if (isCancellation(err)) {
            reset('idle');
            return;
          }
          setStatus('error');
          setComplete(true);
          completeRef.current = true;
          setResults([]);
          setCounts([]);
          onErrorRef.current?.(toPdfError(err));
        }
      })();
    },
    [doc, publish, scanPages],
  );

  const invalidatePages = useCallback(
    (pages: number[]) => {
      if (!doc || pages.length === 0) return;
      invalidatePageText(doc, pages);
      // No query outstanding means nothing to re-derive; the next search reads the fresh text.
      if (!queryRef.current || !planRef.current) return;
      const runId = runIdRef.current;
      (async () => {
        await scanPages(pages);
        if (runIdRef.current !== runId) return;
        const indexed = byPageRef.current.reduce((done, found) => (found ? done + 1 : done), 0);
        publish(indexed, doc.numPages, completeRef.current);
      })().catch(() => {
        // A page the engine can no longer read is a page with no matches on it, which is what the slot
        // already says. A failed re-scan is not a fault to report to a reader who did nothing wrong.
      });
    },
    [doc, publish, scanPages],
  );

  const setActiveIndex = useCallback((index: number) => {
    const count = resultsRef.current.length;
    if (count === 0) return;
    const clamped = Math.min(Math.max(0, index), count - 1);
    if (clamped !== activeIndexRef.current) setActiveIndexState(clamped);
    activeMatchRef.current = resultsRef.current[clamped] ?? null;
    setActiveSeq((s) => s + 1);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      const count = resultsRef.current.length;
      if (count === 0) return;
      const current = activeIndexRef.current;
      const next = current < 0 ? (direction === 1 ? 0 : count - 1) : (current + direction + count) % count;
      setActiveIndexState(next);
      activeMatchRef.current = resultsRef.current[next] ?? null;
      setActiveSeq((s) => s + 1);
    },
    [],
  );

  const nextMatch = useCallback(() => step(1), [step]);
  const prevMatch = useCallback(() => step(-1), [step]);

  const clear = useCallback(() => {
    reset(doc ? 'ready' : 'idle');
  }, [doc, reset]);

  return {
    status,
    progress,
    query,
    options: resolvedOptions,
    results,
    total: results.length,
    counts,
    pagesWithMatches: counts.reduce((done, count) => (count > 0 ? done + 1 : done), 0),
    patternError: patternProblem?.message ?? null,
    patternKind: patternProblem?.kind ?? null,
    indexError,
    activeIndex,
    activeSeq,
    complete,
    pagesIndexed,
    pagesTotal,
    search,
    setActiveIndex,
    nextMatch,
    prevMatch,
    clear,
    invalidatePages,
  };
}
