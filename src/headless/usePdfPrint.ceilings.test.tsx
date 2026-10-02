/*
 * FR-54's resource-limit row, on the one path that reaches a ceiling by arithmetic rather than by a
 * platform refusing to allocate: printing. `src/lib/print.test.ts` already proves the planner returns
 * `null` when nothing fits; this is the half that decides what a *host* is told when that happens.
 *
 * It matters that the answer is a code and not only a sentence. A host that offers "print in two batches"
 * needs `neededBytes` and `fits`; a host that logs needs to group `RESOURCE_LIMIT` apart from a document
 * that failed to parse. Reading either out of the message would be parsing prose, which §3.6 exists to stop.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isPdfError } from '../lib/errors';
import { PRINT_MEMORY_BUDGET, estimatePrintBytes } from '../lib/print';
import { usePdfPrint } from './usePdfPrint';

/** A letter page, 612 x 792 in PDF units, reported the way pdf.js reports a viewport. */
const fakePage = {
  rotate: 0,
  cleanup: vi.fn(),
  getViewport: () => ({ width: 612, height: 792 }),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
};

const fakeDoc = (numPages: number): PDFDocumentProxy =>
  ({
    numPages,
    getPage: async () => fakePage,
  }) as unknown as PDFDocumentProxy;

describe('usePdfPrint ceilings', () => {
  it('refuses a document with no pages to print, as a configuration failure', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfPrint({ doc: fakeDoc(0), onError }));
    await act(async () => {
      await result.current.print();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(isPdfError(result.current.error, 'CONFIGURATION_ERROR')).toBe(true);
    expect(result.current.error?.details).toEqual({ pages: 0 });
  });

  it('codes the print-memory ceiling as RESOURCE_LIMIT, with the numbers a host needs', async () => {
    // 400 letter pages: the smallest scale tried still costs more than the budget, so `planPrintScale`
    // returns null and the hook has to say what it could not do.
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfPrint({ doc: fakeDoc(400), onError }));
    await act(async () => {
      await result.current.print();
    });

    const failure = result.current.error;
    expect(isPdfError(failure, 'RESOURCE_LIMIT')).toBe(true);
    expect(failure?.details).toMatchObject({
      neededBytes: estimatePrintBytes({ width: 612, height: 792 }, 1, 400),
      budgetBytes: PRINT_MEMORY_BUDGET,
      pages: 400,
    });
    // The same object reached the callback: a host wiring `onError` and one reading the state must not be
    // told about one failure twice, in two shapes.
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('prints what fits, so the ceiling is a ceiling and not a wall', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfPrint({ doc: fakeDoc(3), onError }));
    await act(async () => {
      await result.current.print();
    });
    expect(result.current.error).toBeNull();
    // jsdom's `window.print` returns without firing `afterprint`, so the hook's own 250 ms race is what
    // ends the job. This asserts the guarded path stays quiet, not that any ink reached a page.
    expect(fakePage.render).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });
});
