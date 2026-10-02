/*
 * FR-37's re-queue from the shell's side: `PdfViewerHandle.retryPage(page)` is the published way back out of
 * a page's `error`, and FR-54 requires the transition to be deterministic.
 *
 * Two things are worth pinning here rather than in the browser. The counter is *per page* — re-queuing page
 * 3 must not repaint page 5 — and the handle keeps its identity across a retry, because a host that reads
 * the handle in an effect dependency would otherwise have every page in the document re-run on the click of
 * one Retry button.
 *
 * `usePdfDocument` is mocked to a loading document: this is about the shell's own state, and a ready
 * document would mount real pages, which jsdom cannot paint.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useViewerController } from './ViewerController';

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'loading',
    doc: null,
    numPages: 0,
    isReady: false,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: vi.fn(),
  }),
}));

describe('the shell re-queues a page', () => {
  it('counts one page without touching another, and keeps the handle stable', () => {
    const { result, rerender } = renderHook(() => useViewerController({ src: 'a.pdf' }));
    const handle = result.current.handle;

    act(() => handle.retryPage(3));
    rerender();
    expect(result.current.pageRetries).toEqual({ 3: 1 });

    act(() => result.current.handle.retryPage(3));
    rerender();
    expect(result.current.pageRetries, 'a second retry of the same page is still a change').toEqual({ 3: 2 });

    act(() => result.current.handle.retryPage(5));
    rerender();
    expect(result.current.pageRetries).toEqual({ 3: 2, 5: 1 });
    expect(result.current.handle).toBe(handle);
  });
});
