/*
 * FR-12's read, and FR-36's rule applied to a new async operation.
 *
 * The interesting part of the answer is not the table, it is what the engine says when a document has no
 * table: `null`, not an empty one, and not an error. That is the ordinary case, so the hook's default and
 * its "nothing to say" case are the same value — which is exactly why the toolbar has to decide the control
 * from the *contents* of the table (`labelsDifferFromNumbers`) rather than from whether one arrived.
 *
 * The cancellation half is here because a new async site has to answer the same question every other one
 * does: what happens when the host stops caring. `signal` already aborted means the round trip is never
 * made; aborting mid-flight means the answer arrives and is dropped, so nothing moves the page box after
 * the reader has left it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';

import { usePdfPageLabels } from './usePdfPageLabels';

/** A document handle whose only job is to answer the label question, and say how often it was asked. */
function fakeDoc(
  answer: string[] | null | (() => Promise<string[] | null>),
): { doc: PDFDocumentProxy; getPageLabels: ReturnType<typeof vi.fn> } {
  const getPageLabels = vi.fn(() =>
    typeof answer === 'function' ? answer() : Promise.resolve(answer),
  );
  return { doc: { numPages: 10, getPageLabels } as unknown as PDFDocumentProxy, getPageLabels };
}

const LABELS = ['i', 'ii', 'iii', '1', '2', '3', '4', '5', 'A-1', 'A-2'];

describe('reading what the pages are called', () => {
  it('publishes the table the document reports, once', async () => {
    const { doc, getPageLabels } = fakeDoc(LABELS);
    const { result } = renderHook(() => usePdfPageLabels(doc));
    expect(result.current, 'nothing is known until the document says').toBeNull();

    await waitFor(() => expect(result.current).toEqual(LABELS));
    expect(getPageLabels).toHaveBeenCalledTimes(1);
  });

  it('publishes null for a document that declares no numbering', async () => {
    const { doc } = fakeDoc(null);
    const { result } = renderHook(() => usePdfPageLabels(doc));
    await act(async () => undefined);
    expect(result.current).toBeNull();
  });

  // The engine answers `null` when there is no `/PageLabels`, but an empty table has to mean the same
  // thing: a hook whose "nothing" is `[]` would let the toolbar test the array and find it not-empty.
  it('publishes null for a document whose table is empty', async () => {
    const { doc } = fakeDoc([]);
    const { result } = renderHook(() => usePdfPageLabels(doc));
    await act(async () => undefined);
    expect(result.current).toBeNull();
  });

  it('treats a document that cannot answer as one with no labels, rather than as a failure', async () => {
    const { doc } = fakeDoc(() => Promise.reject(new Error('damaged catalog')));
    const { result } = renderHook(() => usePdfPageLabels(doc));
    await act(async () => undefined);
    expect(result.current).toBeNull();
  });

  /*
   * `replaceDocument` puts new bytes on screen, and a reordered or extracted document has its own
   * numbering. Keyed on the handle, so the box cannot keep the previous file's labels — the failure mode
   * being a reader typing the label they can see and landing on a page of the document they closed.
   */
  it('re-reads when the handle changes, and keeps the new document’s table', async () => {
    const first = fakeDoc(LABELS);
    const second = fakeDoc(['1', '2']);
    const { result, rerender } = renderHook(
      ({ handle }: { handle: PDFDocumentProxy | null }) => usePdfPageLabels(handle),
      { initialProps: { handle: first.doc as PDFDocumentProxy | null } },
    );
    await waitFor(() => expect(result.current).toEqual(LABELS));

    rerender({ handle: second.doc });
    expect(first.getPageLabels).toHaveBeenCalledTimes(1);
    expect(second.getPageLabels).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current).toEqual(['1', '2']));

    rerender({ handle: null });
    await act(async () => undefined);
    expect(result.current, 'no document means no table, not the last one').toBeNull();
  });

  it('never asks the document when the host has already stopped caring', async () => {
    const controller = new AbortController();
    controller.abort();
    const { doc, getPageLabels } = fakeDoc(LABELS);
    const { result } = renderHook(() =>
      usePdfPageLabels(doc, controller.signal),
    );
    await act(async () => undefined);
    expect(getPageLabels).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('drops an answer that arrives after the host aborted', async () => {
    let deliver: (labels: string[] | null) => void = () => undefined;
    const { doc } = fakeDoc(() => new Promise<string[] | null>((resolve) => { deliver = resolve; }));
    const controller = new AbortController();
    const { result } = renderHook(() => usePdfPageLabels(doc, controller.signal));

    act(() => controller.abort());
    act(() => deliver(LABELS));
    await act(async () => undefined);
    expect(result.current).toBeNull();
  });

  it('re-reads for a fresh signal, the way every other cancellable operation here does', async () => {
    const { doc, getPageLabels } = fakeDoc(LABELS);
    const stopped = new AbortController();
    stopped.abort();
    const { result, rerender } = renderHook(
      ({ signal }: { signal: AbortSignal }) => usePdfPageLabels(doc, signal),
      { initialProps: { signal: stopped.signal } },
    );
    await act(async () => undefined);
    expect(getPageLabels).not.toHaveBeenCalled();

    const running = new AbortController();
    rerender({ signal: running.signal });
    await waitFor(() => expect(result.current).toEqual(LABELS));
    expect(getPageLabels).toHaveBeenCalledTimes(1);
  });
});
