import { useEffect, useRef, useState } from 'react';
import type { UsePdfSearchResult } from '../headless/usePdfSearch';
import { formatLabel } from '../lib/labels';
import { useLabels } from './labels-context';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';

export interface SearchBoxProps {
  state: UsePdfSearchResult;
  onClose?: () => void;
}

/** Typing restarts full-document text extraction, so coalesce keystrokes. */
const SEARCH_DEBOUNCE_MS = 200;

export function SearchBox({ state, onClose }: SearchBoxProps) {
  const labels = useLabels();
  const [input, setInput] = useState(state.query);
  const [caseSensitive, setCaseSensitive] = useState(state.options.caseSensitive);
  const [wholeWord, setWholeWord] = useState(state.options.wholeWord);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      state.search(input, { caseSensitive, wholeWord });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [state.search, input, caseSensitive, wholeWord]);

  // Enter must not wait out the debounce: run the pending query now.
  const flushPendingSearch = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    state.search(input, { caseSensitive, wholeWord });
  };

  const { status, progress, total, activeIndex, results } = state;
  const activePage = activeIndex >= 0 ? results[activeIndex]?.pageIndex : undefined;
  // Derived once as a state name rather than inline in three places: the
  // counter's colour used to be chosen by comparing the rendered text against
  // 'No results', which silently mis-styled the empty state under any
  // translation of that string.
  const counterKind = !input
    ? 'idle'
    : status === 'indexing'
      ? 'indexing'
      : status === 'error'
        ? 'error'
        : total === 0
          ? 'empty'
          : 'matches';
  const counter =
    counterKind === 'idle'
      ? ''
      : counterKind === 'indexing'
        ? formatLabel(labels.searchIndexing, { percent: Math.round(progress * 100) })
        : counterKind === 'error'
          ? labels.searchFailed
          : counterKind === 'empty'
            ? labels.searchNoResults
            : activePage === undefined
              ? formatLabel(labels.searchMatchSummary, { current: activeIndex + 1, total })
              : formatLabel(labels.searchMatchOnPage, {
                  current: activeIndex + 1,
                  total,
                  page: activePage + 1,
                });
  // Zero matches is an empty state, not a failure: only a real error gets the
  // danger colour.
  const counterState =
    counterKind === 'error' ? 'error' : counterKind === 'empty' ? 'empty' : undefined;

  const hint = (label: string, shortcut: string) =>
    formatLabel(labels.withShortcut, { label, shortcut });

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        className="pjsr-search-input"
        role="searchbox"
        aria-label={labels.findInDocument}
        placeholder={labels.searchPlaceholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            flushPendingSearch();
            if (e.shiftKey) state.prevMatch();
            else state.nextMatch();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose?.();
          }
        }}
      />
      <span
        className="pjsr-search-count"
        data-state={counterState}
        aria-live="polite"
      >
        {counter}
      </span>
      <button
        type="button"
        className="pjsr-button pjsr-button--text"
        aria-label={labels.matchCase}
        aria-pressed={caseSensitive}
        title={labels.matchCase}
        onClick={() => setCaseSensitive((v) => !v)}
      >
        Aa
      </button>
      <button
        type="button"
        className="pjsr-button pjsr-button--text"
        aria-label={labels.wholeWordsOnly}
        aria-pressed={wholeWord}
        title={labels.wholeWordsOnly}
        onClick={() => setWholeWord((v) => !v)}
      >
        ab
      </button>
      <button
        type="button"
        className="pjsr-button"
        aria-label={labels.previousMatch}
        title={hint(labels.previousMatch, 'Shift+Enter')}
        disabled={total === 0}
        onClick={() => state.prevMatch()}
      >
        <ChevronLeftIcon />
      </button>
      <button
        type="button"
        className="pjsr-button"
        aria-label={labels.nextMatch}
        title={hint(labels.nextMatch, 'Enter')}
        disabled={total === 0}
        onClick={() => state.nextMatch()}
      >
        <ChevronRightIcon />
      </button>
      <button
        type="button"
        className="pjsr-button"
        aria-label={labels.closeSearch}
        title={hint(labels.closeSearch, 'Esc')}
        onClick={() => onClose?.()}
      >
        <CloseIcon />
      </button>
    </>
  );
}
