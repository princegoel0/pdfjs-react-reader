import { useEffect, useRef, useState } from 'react';
import type { PdfFindController } from '../headless/usePdfSearch';
import { formatLabel } from '../lib/labels';
import { useLabels } from './labels-context';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';

export interface SearchBoxProps {
  state: PdfFindController;
  onClose?: () => void;
}

/** Typing restarts full-document text extraction, so coalesce keystrokes. */
const SEARCH_DEBOUNCE_MS = 200;

export function SearchBox({ state, onClose }: SearchBoxProps) {
  const labels = useLabels();
  const [input, setInput] = useState(state.query);
  const [caseSensitive, setCaseSensitive] = useState(state.options.caseSensitive);
  const [wholeWord, setWholeWord] = useState(state.options.wholeWord);
  const [regex, setRegex] = useState(state.options.regex);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      state.search(input, { caseSensitive, wholeWord, regex });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [state.search, input, caseSensitive, wholeWord, regex]);

  // Enter must not wait out the debounce: run the pending query now.
  const flushPendingSearch = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    state.search(input, { caseSensitive, wholeWord, regex });
  };

  const { status, progress, total, activeIndex, results, patternError, complete } = state;
  const activePage = activeIndex >= 0 ? results[activeIndex]?.pageIndex : undefined;
  // A host-written controller predates this member and says nothing about partiality, which is correct:
  // such a controller answers in one go. Only `false` means "still reading".
  const partial = complete === false;
  // Derived once as a state name rather than inline in three places: the
  // counter's colour used to be chosen by comparing the rendered text against
  // 'No results', which silently mis-styled the empty state under any
  // translation of that string.
  const counterKind = !input
    ? 'idle'
    : status === 'indexing' && total === 0
      ? 'indexing'
      : patternError
        ? 'invalid'
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
        : counterKind === 'invalid'
          ? labels.searchInvalidPattern
          : counterKind === 'error'
            ? labels.searchFailed
            : counterKind === 'empty'
              ? labels.searchNoResults
              : activePage === undefined
                ? formatLabel(
                    partial ? labels.searchMatchSummaryPartial : labels.searchMatchSummary,
                    { current: activeIndex + 1, total },
                  )
                : formatLabel(
                    partial ? labels.searchMatchOnPagePartial : labels.searchMatchOnPage,
                    {
                      current: activeIndex + 1,
                      total,
                      page: activePage + 1,
                    },
                  );
  // Zero matches is an empty state, not a failure: only a real error gets the
  // danger colour. A pattern that will not compile is a mistake in the box, so it
  // is reported as one rather than as "no results", which would be a lie about
  // having looked.
  const counterState =
    counterKind === 'error' || counterKind === 'invalid'
      ? 'error'
      : counterKind === 'empty'
        ? 'empty'
        : undefined;

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
        className="pjsr-button pjsr-button--text"
        aria-label={labels.regexMode}
        aria-pressed={regex}
        title={labels.regexMode}
        onClick={() => setRegex((v) => !v)}
      >
        .*</button>
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
