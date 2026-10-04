/*
 * FR-27's last clause at the level a reader actually meets: a pattern problem is reported as one, and never
 * quietly becomes "no matches".
 *
 * The distinction is worth a whole file because the two states look identical from the field that matters
 * most — `results` is empty either way. What separates them is `status` and the reason beside it, and a
 * search UI that reads only the count tells a reader their document has no hits when in fact their query was
 * never run. So the assertions below are about the labelling, about the two reasons being distinguishable
 * from each other, and about the pattern being planned before any page is read — a malformed expression
 * should cost nothing, not a walk through the whole file.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_PATTERN_UNITS } from '../lib/search';
import { usePdfSearch } from './usePdfSearch';

const PAGES = 3;

/** A document whose pages all hold the word `clause`, so a working pattern always has something to find. */
function fakeDoc(): PDFDocumentProxy & { getPage: ReturnType<typeof vi.fn> } {
  return {
    numPages: PAGES,
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [{ str: `page ${pageNumber} has a clause in it`, hasEOL: true }],
        styles: {},
      }),
      cleanup: () => undefined,
    })),
  } as unknown as PDFDocumentProxy & { getPage: ReturnType<typeof vi.fn> };
}

async function run(query: string, options?: Parameters<ReturnType<typeof usePdfSearch>['search']>[1]) {
  const doc = fakeDoc();
  const hook = renderHook(() => usePdfSearch({ doc }));
  await act(async () => {
    hook.result.current.search(query, options);
  });
  return { ...hook.result.current, doc };
}

describe('a pattern problem stays a pattern problem', () => {
  it('reports an uncompilable expression as an error rather than as an empty result set', async () => {
    const { status, patternError, patternKind, total, results, complete } = await run('clause(', {
      regex: true,
    });

    expect(status).toBe('error');
    expect(patternKind).toBe('invalid');
    expect(patternError).toBeTruthy();
    expect(total).toBe(0);
    expect(results).toEqual([]);
    // `complete` is true here — the search really is over — which is exactly why a surface cannot tell a
    // refused pattern from a genuine no-match without the status and the kind.
    expect(complete).toBe(true);
  });

  it('refuses an over-long expression before reading a single page', async () => {
    const doc = fakeDoc();
    const hook = renderHook(() => usePdfSearch({ doc }));
    await act(async () => {
      hook.result.current.search('a'.repeat(DEFAULT_MAX_PATTERN_UNITS + 1) + '$', { regex: true });
    });

    expect(hook.result.current.patternKind).toBe('too-long');
    expect(hook.result.current.patternError).toContain(String(DEFAULT_MAX_PATTERN_UNITS));
    expect(doc.getPage).not.toHaveBeenCalled();
    // The two reasons are different words in the field and different values in the kind, so a host can say
    // "shorten it" for one and "that is not an expression" for the other without reading prose.
    expect(hook.result.current.patternKind).not.toBe('invalid');
  });

  it('takes the ceiling from the caller, both ways', async () => {
    // `clause` is exactly six units and matches every page; `clauses` is seven and is refused outright.
    const refused = await run('clauses', { regex: true, maxPatternUnits: 6 });
    expect(refused.patternKind).toBe('too-long');
    expect(refused.status).toBe('error');
    expect(refused.doc.getPage).not.toHaveBeenCalled();

    const fits = await run('clause', { regex: true, maxPatternUnits: 6 });
    expect(fits.patternKind).toBeNull();
    expect(fits.status).toBe('ready');
    expect(fits.total).toBe(PAGES);
  });

  it('clears the problem when a later query compiles', async () => {
    const doc = fakeDoc();
    const hook = renderHook(() => usePdfSearch({ doc }));
    await act(async () => {
      hook.result.current.search('clause(', { regex: true });
    });
    await waitFor(() => expect(hook.result.current.status).toBe('error'));

    await act(async () => {
      hook.result.current.search('clause', { regex: true });
    });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(hook.result.current.patternError).toBeNull();
    expect(hook.result.current.patternKind).toBeNull();
    expect(hook.result.current.total).toBeGreaterThan(0);
  });

  it('says nothing about a long literal query, because nothing was compiled', async () => {
    const long = 'clause '.repeat(60);
    const { patternKind, status, total } = await run(long);
    expect(patternKind).toBeNull();
    expect(status).toBe('ready');
    expect(total).toBeGreaterThan(0);
  });
});
