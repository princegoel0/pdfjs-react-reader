/*
 * FR-40: an index somebody else built, and the one thing that makes it dangerous.
 *
 * A host with the same document on a server can extract its text once and hand the result to every reader,
 * which is the whole point. The danger is that a well-formed index is indistinguishable from a stale one —
 * the same shape, the same field names, entirely different words — and a mark placed from a stale index
 * lands on text the reader can see is not what was matched. So the page count is checked against the
 * document before a single page is trusted, and a refusal is reported to the host rather than swallowed.
 *
 * The assertion that carries the requirement is the first one: with a usable index, `getPage` is never
 * called. Not "called less" — never. That is the difference between an optimisation and an alternative
 * source of truth.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import { buildTextIndex, validateTextIndex, type TextItemLike } from '../lib/search';
import { usePdfSearch } from './usePdfSearch';

const TOTAL = 6;
const NEEDLE = 'quux';

const itemsFor = (page: number): TextItemLike[] => [
  { str: page === 2 ? `${NEEDLE} appears here` : `page ${page + 1} heading`, hasEOL: true },
  { str: `page ${page + 1} body`, hasEOL: true },
];

function fakeDoc(options: { numPages?: number } = {}) {
  const numPages = options.numPages ?? TOTAL;
  const getPage = vi.fn((pageNumber: number) =>
    Promise.resolve({
      getTextContent: async () => ({ items: itemsFor(pageNumber - 1) }),
    }),
  );
  return { doc: { numPages, getPage } as unknown as PDFDocumentProxy, getPage };
}

const search = (doc: PDFDocumentProxy, index?: unknown) =>
  renderHook(() => usePdfSearch({ doc, index: index as never }));

describe('the published shape', () => {
  it('builds from the same items the viewer would have read', () => {
    const index = buildTextIndex([0, 1].map(itemsFor));
    expect(index.version).toBe(1);
    const { text, itemEnds } = index.pages[0]!;
    // The EOL newline belongs to the text and to no item, so the first boundary is the first item's length
    // plus one and the last is the whole text — the pair a mark is placed from.
    expect(text).toBe('page 1 heading\npage 1 body\n');
    expect(itemEnds).toEqual([15, text.length]);
    expect(validateTextIndex(index, 2).error).toBeNull();
  });

  it('refuses an index that does not describe this document', () => {
    const index = buildTextIndex([0, 1, 2].map(itemsFor));
    expect(validateTextIndex(index, 6)).toEqual({
      error: 'The index describes 3 pages; the document has 6.',
    });
    expect(validateTextIndex({ version: 2, pages: [] }, 0).error).toMatch(/version/);
    expect(validateTextIndex({ version: 1, pages: 'nope' }, 0).error).toMatch(/page list/);
    expect(validateTextIndex(null, 0).error).toMatch(/not an object/);
  });

  it('refuses boundaries that do not walk their own text', () => {
    const broken = {
      version: 1 as const,
      pages: [{ text: 'short', itemEnds: [2, 99] }],
    };
    expect(validateTextIndex(broken, 1).error).toMatch(/do not walk its text/);
    const backwards = { version: 1 as const, pages: [{ text: 'abcdef', itemEnds: [4, 2] }] };
    expect(validateTextIndex(backwards, 1).error).toMatch(/do not walk/);
  });

  it('accepts a page it does not describe, which is a gap rather than a lie', () => {
    const partial = { version: 1 as const, pages: [{ text: 'a', itemEnds: [1] }, null] };
    expect(validateTextIndex(partial, 2).error).toBeNull();
  });
});

describe('searching an index the viewer did not build', () => {
  it('answers from it without reading the document at all', async () => {
    const { doc, getPage } = fakeDoc();
    const index = buildTextIndex(Array.from({ length: TOTAL }, (_, page) => itemsFor(page)));
    const { result } = search(doc, index);

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(result.current.results.map((match) => match.pageIndex)).toEqual([2]);
    expect(result.current.indexError).toBeNull();
    expect(getPage).not.toHaveBeenCalled();
  });

  it('reports a stale index and searches the document instead', async () => {
    const { doc, getPage } = fakeDoc({ numPages: 9 });
    const stale = buildTextIndex(Array.from({ length: TOTAL }, (_, page) => itemsFor(page)));
    const { result } = search(doc, stale);

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(result.current.indexError).toMatch(/describes 6 pages; the document has 9/);
    // The reader still gets an answer: refusing the index is not refusing the search.
    expect(result.current.results.map((match) => match.pageIndex)).toEqual([2]);
    expect(getPage).toHaveBeenCalled();
  });

  it('reads the pages the index left out, and only those', async () => {
    const { doc, getPage } = fakeDoc();
    const built = buildTextIndex(Array.from({ length: TOTAL }, (_, page) => itemsFor(page)));
    const withAHole = { ...built, pages: built.pages.map((page, at) => (at === 2 ? null : page)) };
    const { result } = search(doc, withAHole);

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(result.current.results.map((match) => match.pageIndex)).toEqual([2]);
    expect(getPage.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([3]);
  });

  it('keeps working when no index is supplied at all', async () => {
    const { doc, getPage } = fakeDoc();
    const { result } = search(doc);

    act(() => result.current.search(NEEDLE));
    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(result.current.indexError).toBeNull();
    expect(result.current.results).toHaveLength(1);
    expect(getPage).toHaveBeenCalledTimes(TOTAL);
  });
});
