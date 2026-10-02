/*
 * FR-37's page-side clause — the retry §3.5 promises is an API, not an internal of the virtualizer — and
 * FR-54's "retry/requeue transitions are deterministic".
 *
 * A page that reached `error` has no way back on its own: its row stays mounted, so nothing re-runs, and
 * every dependency a repaint would otherwise need (scale, rotation, which page is open) is a thing the
 * reader would have to disturb to get one page painted again. The answer is one counter per page.
 *
 * This tests the counter's effect on the component, which is where the requirement is either met or not:
 * a `retryToken` that changed must fetch the page proxy again — that fetch is what re-queues the page and
 * resets the failure latch — and must do it *every* time it changes, because a page can fail twice and a
 * boolean would only allow the first retry.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import type { PdfPageStatus } from '../lib/status';

/** A document whose every page fetch fails, which is the state a retry is for. */
function failingDoc(): PDFDocumentProxy {
  return { getPage: vi.fn(async () => { throw new Error('the page is not readable'); }) } as unknown as PDFDocumentProxy;
}

afterEach(cleanup);

describe('PdfPage retryToken', () => {
  it('re-queues a page that had reached error, and reports the sequence in order', async () => {
    const doc = failingDoc();
    const seen: PdfPageStatus[] = [];
    const record = (_page: number, status: PdfPageStatus) => {
      if (seen.at(-1) !== status) seen.push(status);
    };

    const { rerender } = render(<PdfPage doc={doc} pageNumber={3} scale={1} onStatusChange={record} />);
    await act(async () => undefined);
    expect(seen).toEqual(['queued', 'error']);

    // The first retry: the same document, the same page number, nothing else changed but the token.
    rerender(<PdfPage doc={doc} pageNumber={3} scale={1} onStatusChange={record} retryToken={1} />);
    await act(async () => undefined);
    expect(seen, 'a retry starts the page again rather than reporting a second failure').toEqual([
      'queued',
      'error',
      'queued',
      'error',
    ]);
    expect(doc.getPage).toHaveBeenCalledTimes(2);

    // And a second retry is still a change, which is why the prop is a counter and not a flag.
    rerender(<PdfPage doc={doc} pageNumber={3} scale={1} onStatusChange={record} retryToken={2} />);
    await act(async () => undefined);
    expect(doc.getPage).toHaveBeenCalledTimes(3);
  });

  it('leaves the page alone when the token does not change, so a re-render is not a retry', async () => {
    const doc = failingDoc();
    const { rerender } = render(<PdfPage doc={doc} pageNumber={3} scale={1} retryToken={4} />);
    await act(async () => undefined);
    rerender(<PdfPage doc={doc} pageNumber={3} scale={1} retryToken={4} />);
    await act(async () => undefined);
    expect(doc.getPage).toHaveBeenCalledTimes(1);
  });
});
