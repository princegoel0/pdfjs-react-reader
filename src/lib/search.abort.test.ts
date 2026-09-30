/*
 * FR-36 on the indexing path — the one operation whose cancellation takes seconds rather than frames.
 *
 * `extractAllText` is also the only long loop in the package with no test of its own before this, which is
 * worth saying: the requirement to stop it is worth less than a test proving the stop is honoured per page
 * rather than checked once before a thousand-page walk.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractAllText } from './search';
import { isAbortError } from './abort';

/** A document whose pages each contribute one word, so a partial index is observable. */
function fakeDoc(numPages: number, onPage?: (n: number) => void) {
  const items = (n: number) => [
    { str: `word${n}`, dir: 'ltr', transform: [1, 0, 0, 1, 0, 0], width: 40, height: 10 },
  ];
  return {
    numPages,
    getPage: async (n: number) => {
      onPage?.(n);
      return { getTextContent: async () => ({ items: items(n), styles: {} }) };
    },
  } as unknown as PDFDocumentProxy;
}

describe('extractAllText with a signal', () => {
  it('reads every page when nothing aborts it', async () => {
    const seen: number[] = [];
    const pages = await extractAllText(fakeDoc(3, (n) => seen.push(n)));
    expect(seen).toEqual([1, 2, 3]);
    expect(pages).toHaveLength(3);
  });

  it('stops at the page boundary after an abort, rather than finishing the document', async () => {
    const seen: number[] = [];
    const controller = new AbortController();
    // Aborted partway: the loop checks before each page, so it must not read past the abort.
    const doc = fakeDoc(50, (n) => {
      if (n === 4) controller.abort();
      seen.push(n);
    });

    await expect(extractAllText(doc, undefined, controller.signal)).rejects.toSatisfy(isAbortError);
    expect(seen.length, 'no more than one page beyond the abort').toBeLessThanOrEqual(5);
    expect(seen.length, 'it must have done some work to prove the check is inside the loop').toBeGreaterThan(1);
  });

  it('refuses to start for a signal that already fired', async () => {
    const getPage = vi.fn();
    const doc = { numPages: 10, getPage } as unknown as PDFDocumentProxy;
    const controller = new AbortController();
    controller.abort();

    await expect(extractAllText(doc, undefined, controller.signal)).rejects.toSatisfy(isAbortError);
    expect(getPage, 'an aborted caller must not touch the worker').not.toHaveBeenCalled();
  });

  it('reports progress as it goes, which the abort must not erase', async () => {
    const fractions: number[] = [];
    const pages = await extractAllText(fakeDoc(4), (f) => fractions.push(f));
    expect(pages).toHaveLength(4);
    expect(fractions.at(-1)).toBe(1);
  });
});
