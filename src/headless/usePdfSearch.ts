import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  extractAllText,
  findQueryMatches,
  type PageMatch,
  type ResolvedSearchOptions,
  type SearchOptions,
} from '../lib/search';

export type SearchStatus = 'idle' | 'indexing' | 'ready' | 'error';

export interface UsePdfSearchOptions {
  doc: PDFDocumentProxy | null;
  onError?: (error: Error) => void;
}

export interface UsePdfSearchResult {
  status: SearchStatus;
  /** Text-extraction progress 0..1 while status is 'indexing'. */
  progress: number;
  /** The query from the most recent search call. */
  query: string;
  options: ResolvedSearchOptions;
  /** All matches in document order. */
  results: PageMatch[];
  total: number;
  /** Index into results of the current match, -1 when there are none. */
  activeIndex: number;
  /**
   * Increments every time the active match is (re)selected, including when a
   * search completes. Parents can watch this to scroll the active match into
   * view, including when the index itself did not change.
   */
  activeSeq: number;
  search: (query: string, options?: SearchOptions) => void;
  setActiveIndex: (index: number) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  clear: () => void;
}

const DEFAULT_OPTIONS: ResolvedSearchOptions = { caseSensitive: false, wholeWord: false };

export function usePdfSearch(options: UsePdfSearchOptions): UsePdfSearchResult {
  const { doc, onError } = options;
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [query, setQuery] = useState('');
  const [resolvedOptions, setResolvedOptions] = useState<ResolvedSearchOptions>(DEFAULT_OPTIONS);
  const [results, setResults] = useState<PageMatch[]>([]);
  const [activeIndex, setActiveIndexState] = useState(-1);
  const [activeSeq, setActiveSeq] = useState(0);

  // Latest-value refs so async completions and callbacks never see stale data.
  const runIdRef = useRef(0);
  const resultsRef = useRef<PageMatch[]>([]);
  resultsRef.current = results;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // A new document invalidates everything outstanding.
  useEffect(() => {
    runIdRef.current++;
    setStatus('idle');
    setProgress(0);
    setQuery('');
    setResults([]);
    setActiveIndexState(-1);
  }, [doc]);

  const search = useCallback(
    (nextQuery: string, searchOptions?: SearchOptions) => {
      const runId = ++runIdRef.current;
      const resolved: ResolvedSearchOptions = {
        caseSensitive: searchOptions?.caseSensitive ?? false,
        wholeWord: searchOptions?.wholeWord ?? false,
      };
      setQuery(nextQuery);
      setResolvedOptions(resolved);
      setActiveIndexState(-1);

      if (!doc || nextQuery.length === 0) {
        setStatus(doc ? 'ready' : 'idle');
        setProgress(0);
        setResults([]);
        return;
      }

      setStatus('indexing');
      setProgress(0);

      (async () => {
        try {
          const pages = await extractAllText(doc, (fraction) => {
            if (runIdRef.current === runId) setProgress(fraction);
          });
          if (runIdRef.current !== runId) return;

          const flat: PageMatch[] = [];
          for (let i = 0; i < pages.length; i++) {
            for (const match of findQueryMatches(pages[i]!, nextQuery, resolved)) {
              match.pageIndex = i;
              flat.push(match);
            }
          }
          setStatus('ready');
          setResults(flat);
          setActiveIndexState(flat.length > 0 ? 0 : -1);
          setActiveSeq((s) => s + 1);
        } catch (err) {
          if (runIdRef.current !== runId) return;
          setStatus('error');
          setResults([]);
          onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    },
    [doc],
  );

  const setActiveIndex = useCallback((index: number) => {
    const count = resultsRef.current.length;
    if (count === 0) return;
    const clamped = Math.min(Math.max(0, index), count - 1);
    if (clamped !== activeIndexRef.current) setActiveIndexState(clamped);
    setActiveSeq((s) => s + 1);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      const count = resultsRef.current.length;
      if (count === 0) return;
      const current = activeIndexRef.current;
      const next = current < 0 ? (direction === 1 ? 0 : count - 1) : (current + direction + count) % count;
      setActiveIndexState(next);
      setActiveSeq((s) => s + 1);
    },
    [],
  );

  const nextMatch = useCallback(() => step(1), [step]);
  const prevMatch = useCallback(() => step(-1), [step]);

  const clear = useCallback(() => {
    runIdRef.current++;
    setStatus(doc ? 'ready' : 'idle');
    setProgress(0);
    setQuery('');
    setResults([]);
    setActiveIndexState(-1);
  }, [doc]);

  return {
    status,
    progress,
    query,
    options: resolvedOptions,
    results,
    total: results.length,
    activeIndex,
    activeSeq,
    search,
    setActiveIndex,
    nextMatch,
    prevMatch,
    clear,
  };
}
