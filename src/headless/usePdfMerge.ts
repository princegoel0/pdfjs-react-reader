import { useCallback, useEffect, useRef, useState } from 'react';
import { describeMergeSources, mergeDocuments } from '../lib/pdf-merge';
import { isCancellation, throwIfAborted } from '../lib/abort';
import type { MergePageRef, MergeResult, MergeSource } from '../lib/pdf-merge';
import type { WriteOptions } from '../lib/pdf-write';

export interface UsePdfMergeOptions {
  /**
   * The documents on offer, in the order the reader added them. A source is never written to, so a host can
   * keep holding the same bytes it opened with after a merge finishes.
   */
  sources: readonly MergeSource[];
  onError?: (error: Error) => void;
  /** Stops the page-count read, which is the only asynchronous thing before the merge itself. */
  signal?: AbortSignal;
}

export interface UsePdfMergeResult {
  /**
   * Pages per source, in `sources` order, `null` until the count has been read. A picker needs this before
   * it can offer page 6 of a document it has not opened yet, and it is the one thing about a PDF you cannot
   * guess from its size.
   */
  available: (number | null)[];
  /** The plan: which page comes next, in the order the output will hold them. */
  order: MergePageRef[];
  /** How many pages have been taken from each source, for a "3 of 14" line. */
  taken: number[];
  /** Appends one page. The same page may be added twice — that is how a cover ends up at the back. */
  add: (source: number, page: number) => void;
  /** Drops the plan entry at this position, not a page number. */
  remove: (at: number) => void;
  /** Moves the entry at `from` to occupy position `to`. */
  move: (from: number, to: number) => void;
  clear: () => void;
  /**
   * Writes the plan to a new file. Resolves `null` when the plan is empty or the merge was stopped, so a
   * caller never has to catch its own cancel button — and never receives bytes it did not ask for.
   */
  merge: (options?: WriteOptions) => Promise<MergeResult | null>;
  /** True while a merge is running: the same operation that can take seconds on a large pair. */
  busy: boolean;
}

/**
 * The state behind a merge picker: what each document holds, what the reader has chosen, and the write.
 *
 * It is a hook rather than a component because the interesting half of a merge is the *preview* — the list
 * of pages in the order they will appear, which the reader rearranges — and only the host knows what that
 * should look like inside its own chrome. What this owns is the part a host should not have to get right:
 * the plan as data, the counts as they arrive, and a merge that cannot touch a source.
 */
export function usePdfMerge(options: UsePdfMergeOptions): UsePdfMergeResult {
  const { sources, onError } = options;
  const [available, setAvailable] = useState<(number | null)[]>([]);
  const [order, setOrder] = useState<MergePageRef[]>([]);
  const [busy, setBusy] = useState(false);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const signalRef = useRef(options.signal);
  signalRef.current = options.signal;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  /*
   * Keyed on a signature of the sources rather than on the array, because a host that writes
   * `usePdfMerge({ sources: [a, b] })` inline makes a new array on every render — and an effect that
   * restarts on that does not re-read the documents once, it re-reads them forever. The same trap
   * `httpHeaders` was measured falling into in `0.9`, and byte length plus name is enough to tell two
   * genuinely different sets apart without asking the reader to memoise for us.
   */
  const signature = sources.map((source) => `${source.name ?? ''}:${source.bytes.byteLength}`).join('|');
  // A new set of documents invalidates a plan that refers to positions in the old one.
  useEffect(() => {
    setOrder([]);
    setAvailable(sources.map(() => null));
    let cancelled = false;
    (async () => {
      try {
        const counted = await describeMergeSources([...sources], { signal: signalRef.current });
        if (!cancelled) setAvailable(counted.map((doc) => doc.pages));
      } catch (error) {
        if (cancelled || isCancellation(error)) return;
        onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signature]);

  const add = useCallback((source: number, page: number) => {
    setOrder((plan) => [...plan, { source, page }]);
  }, []);

  const remove = useCallback((at: number) => {
    setOrder((plan) => plan.filter((_, position) => position !== at));
  }, []);

  const move = useCallback((from: number, to: number) => {
    setOrder((plan) => {
      if (from === to || from < 0 || from >= plan.length) return plan;
      const next = [...plan];
      const [entry] = next.splice(from, 1);
      if (!entry) return plan;
      next.splice(Math.max(0, Math.min(next.length, to)), 0, entry);
      return next;
    });
  }, []);

  const clear = useCallback(() => setOrder([]), []);

  const merge = useCallback(
    async (writeOptions: WriteOptions = {}) => {
      const plan = order;
      if (plan.length === 0) return null;
      setBusy(true);
      try {
        // The hook's own signal and the caller's both count: whichever stops it, nothing is written.
        throwIfAborted(signalRef.current, 'Merging was aborted.');
        return await mergeDocuments(
          { sources: [...sourcesRef.current], order: plan },
          { signal: signalRef.current, ...writeOptions },
        );
      } catch (error) {
        if (isCancellation(error)) return null;
        onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [order],
  );

  const taken = available.map((_, at) => order.reduce((n, ref) => (ref.source === at ? n + 1 : n), 0));

  return { available, order, taken, add, remove, move, clear, merge, busy };
}
