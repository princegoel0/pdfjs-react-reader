import { useCallback, useMemo, useState } from 'react';
import type { PageMatch, PdfFindController } from 'pdfjs-react-reader/headless';

/**
 * Stands in for a host-side find — the case `PdfViewer`'s `find` prop exists for.
 *
 * A real one asks a server, a search index, or a stemmed matcher; the point is that
 * it answers with **pages and offsets** and the viewer draws the bar, the marks and
 * the navigation from that answer. So this returns a fixed table: three matches for
 * "trace", none for anything else. That is deliberately fewer than the engine's own
 * text search finds, which is what makes it checkable: if the counter and the marks
 * come from here, the numbers cannot be the built-in's.
 */
const HOST_INDEX: Record<string, { pageIndex: number; beginIdx: number; beginOffset: number }[]> = {
  trace: [
    { pageIndex: 0, beginIdx: 2, beginOffset: 0 },
    { pageIndex: 1, beginIdx: 0, beginOffset: 12 },
    { pageIndex: 2, beginIdx: 6, beginOffset: 3 },
  ],
};

export function useHostIndexFind(): PdfFindController {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndexState] = useState(-1);
  const [activeSeq, setActiveSeq] = useState(0);

  const results = useMemo<PageMatch[]>(
    () =>
      (HOST_INDEX[query.toLowerCase()] ?? []).map((entry) => ({
        pageIndex: entry.pageIndex,
        beginIdx: entry.beginIdx,
        beginOffset: entry.beginOffset,
        endIdx: entry.beginIdx,
        endOffset: entry.beginOffset + query.length,
      })),
    [query],
  );

  const counts = useMemo(() => {
    const perPage = new Array<number>(14).fill(0);
    for (const match of results) perPage[match.pageIndex] = (perPage[match.pageIndex] ?? 0) + 1;
    return perPage;
  }, [results]);

  const search = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    // The first match becomes the active one straight away, so the first Enter after
    // a search moves to match two rather than rediscovering match one.
    const hits = HOST_INDEX[nextQuery.toLowerCase()] ?? [];
    setActiveIndexState(hits.length > 0 ? 0 : -1);
    setActiveSeq((s) => s + 1);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      const total = results.length;
      if (total === 0) return;
      const current = activeIndex;
      const next = current < 0 ? (direction === 1 ? 0 : total - 1) : (current + direction + total) % total;
      setActiveIndexState(next);
      setActiveSeq((s) => s + 1);
    },
    [results.length, activeIndex],
  );

  return {
    status: query ? 'ready' : 'idle',
    progress: 1,
    query,
    options: { caseSensitive: false, wholeWord: false, regex: false },
    results,
    total: results.length,
    counts,
    pagesWithMatches: counts.filter((count) => count > 0).length,
    patternError: null,
    patternKind: null,
    activeIndex: results.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), results.length - 1),
    activeSeq,
    search,
    setActiveIndex: (index) => {
      setActiveIndexState(Math.min(Math.max(0, index), Math.max(0, results.length - 1)));
      setActiveSeq((s) => s + 1);
    },
    nextMatch: useCallback(() => step(1), [step]),
    prevMatch: useCallback(() => step(-1), [step]),
    clear: useCallback(() => {
      setQuery('');
      setActiveIndexState(-1);
    }, []),
  };
}
