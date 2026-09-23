import { useEffect, useRef, useState } from 'react';
import type { UsePdfSearchResult } from '../headless/usePdfSearch';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';

export interface SearchBoxProps {
  state: UsePdfSearchResult;
  onClose?: () => void;
}

/** Typing restarts full-document text extraction, so coalesce keystrokes. */
const SEARCH_DEBOUNCE_MS = 200;

export function SearchBox({ state, onClose }: SearchBoxProps) {
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
  const counter = !input
    ? ''
    : status === 'indexing'
      ? `Indexing ${Math.round(progress * 100)}%`
      : status === 'error'
        ? 'Search failed'
        : total === 0
          ? 'No results'
          : `${activeIndex + 1} of ${total}${activePage === undefined ? '' : ` · p${activePage + 1}`}`;
  // Zero matches is an empty state, not a failure: only a real error gets the
  // danger colour.
  const counterState =
    status === 'error' ? 'error' : counter === 'No results' ? 'empty' : undefined;

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        className="pjsr-search-input"
        role="searchbox"
        aria-label="Find in document"
        placeholder="Find in document…"
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
        aria-label="Match case"
        aria-pressed={caseSensitive}
        title="Match case"
        onClick={() => setCaseSensitive((v) => !v)}
      >
        Aa
      </button>
      <button
        type="button"
        className="pjsr-button pjsr-button--text"
        aria-label="Whole words only"
        aria-pressed={wholeWord}
        title="Whole words only"
        onClick={() => setWholeWord((v) => !v)}
      >
        ab
      </button>
      <button
        type="button"
        className="pjsr-button"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={total === 0}
        onClick={() => state.prevMatch()}
      >
        <ChevronLeftIcon />
      </button>
      <button
        type="button"
        className="pjsr-button"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={total === 0}
        onClick={() => state.nextMatch()}
      >
        <ChevronRightIcon />
      </button>
      <button
        type="button"
        className="pjsr-button"
        aria-label="Close search"
        title="Close search (Esc)"
        onClick={() => onClose?.()}
      >
        <CloseIcon />
      </button>
    </>
  );
}
