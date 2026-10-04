/*
 * FR-39's clause where a reader actually meets it: the counter. FR-15 is the other half of the same widget —
 * case, whole-word, next and previous, and a live "n of m" that distinguishes a partial index from a finished
 * one.
 *
 * A number that is still growing has to say it is growing — that is the whole requirement, and it lives in
 * one string. So these tests are about which template the box picks, in four states that are easy to
 * confuse: nothing found yet, something found and still reading, everything found, and a host-written
 * controller that predates the flag and has nothing to say about partiality.
 *
 * The last one is the compatibility clause made visible. `complete` is optional on `PdfFindController`,
 * which means `undefined` for every controller written before `0.11`, and the box must not read that as
 * "still working" — it must show a finished count, because that is what such a controller produces.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchBox } from './SearchBox';
import { DEFAULT_LABELS, formatLabel } from '../lib/labels';
import type { PdfFindController } from '../headless/usePdfSearch';
import type { PageMatch } from '../lib/search';

const match = (pageIndex: number): PageMatch => ({
  pageIndex,
  beginIdx: 0,
  endIdx: 0,
  beginOffset: 0,
  endOffset: 4,
});

function stub(over: Partial<PdfFindController>): PdfFindController {
  return {
    status: 'ready',
    progress: 1,
    query: 'quux',
    options: { caseSensitive: false, wholeWord: false, regex: false },
    results: [match(2), match(7), match(11)],
    total: 3,
    counts: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    pagesWithMatches: 3,
    patternError: null,
    patternKind: null,
    activeIndex: 0,
    activeSeq: 1,
    complete: true,
    pagesIndexed: 12,
    pagesTotal: 12,
    search: vi.fn(),
    setActiveIndex: vi.fn(),
    nextMatch: vi.fn(),
    prevMatch: vi.fn(),
    clear: vi.fn(),
    invalidatePages: vi.fn(),
    ...over,
  };
}

const counter = (container: HTMLElement) =>
    container.querySelector('.pjsr-search-count')?.textContent ?? '';
// The catalog's own template rather than an English string typed into this file, so a reworded label
// moves the assertion instead of failing it for the wrong reason.
const PARTIAL = DEFAULT_LABELS.searchMatchOnPagePartial;

afterEach(cleanup);

describe('the match counter', () => {
  it('says so far while the document is still being read', () => {
    const { container } = render(
      <SearchBox state={stub({ status: 'indexing', complete: false, pagesIndexed: 4, pagesTotal: 60 })} />,
    );
    expect(counter(container)).toBe(formatLabel(PARTIAL, { current: 1, total: 3, page: 3 }));
    expect(counter(container)).toMatch(/so far/);
  });

  it('says nothing of the sort once the reading is done', () => {
    const { container } = render(<SearchBox state={stub({})} />);
    expect(counter(container)).toBe('1 of 3 · p3');
  });

  /*
   * The compatibility case, and the reason `complete` is optional rather than defaulted: a host that
   * wrote its own controller in `0.5` answers in one call, and a counter that read `undefined` as
   * "still working" would start qualifying numbers that were never partial.
   */
  it('treats a controller that does not report partiality as finished', () => {
    const { complete: _complete, ...hostWritten } = stub({});
    const { container } = render(<SearchBox state={hostWritten as PdfFindController} />);
    expect(counter(container)).toBe('1 of 3 · p3');
  });

  it('shows progress rather than a count while there is nothing to count', () => {
    const { container } = render(
      <SearchBox
        state={stub({
          status: 'indexing',
          complete: false,
          results: [],
          total: 0,
          activeIndex: -1,
          counts: [],
          pagesWithMatches: 0,
          progress: 0.25,
          pagesIndexed: 15,
          pagesTotal: 60,
        })}
      />,
    );
    expect(counter(container)).toBe('Indexing 25%');
  });
});
