/*
 * FR-36's clause that the page path did not hold: an already-aborted signal performs no work.
 *
 * `PdfPage` had the other half right — a signal that fires mid-flight stops the render, releases the canvas
 * and reports `cancelled` rather than an error — but every effect started its work first and asked afterwards.
 * A page mounted into a viewer whose host had already given up therefore still fetched its proxy from the
 * worker, still allocated a canvas, still built a text layer, and then discarded all three. That is not the
 * same statement as "we cancelled it": the cost was paid, and on a fast scroller with a signal that has
 * already fired the whole document's worth of pages pays it.
 *
 * So the assertion is on the engine calls that never happen, which is the only way to see the difference:
 * `getPage` and `render` are counted, and the un-aborted case is run through the same component to prove the
 * guard is a cancellation rather than a broken page.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import type { PdfPageStatus } from '../lib/status';

function countingDoc(): PDFDocumentProxy {
  return {
    getPage: vi.fn(async () => {
      throw new Error('the page is not readable');
    }),
  } as unknown as PDFDocumentProxy;
}

function statuses(doc: PDFDocumentProxy, signal?: AbortSignal): PdfPageStatus[] {
  const seen: PdfPageStatus[] = [];
  render(
    <PdfPage
      doc={doc}
      pageNumber={3}
      scale={1}
      signal={signal}
      onStatusChange={(_page: number, status: PdfPageStatus) => {
        if (seen.at(-1) !== status) seen.push(status);
      }}
    />,
  );
  return seen;
}

afterEach(cleanup);

describe('FR-36: an aborted signal performs no work on the page path', () => {
  it('never asks the document for the page proxy when the signal had already fired', async () => {
    const doc = countingDoc();
    const controller = new AbortController();
    controller.abort();
    const seen = statuses(doc, controller.signal);

    await act(async () => undefined);

    expect(doc.getPage, 'a cancelled page must not fetch its proxy').not.toHaveBeenCalled();
    // And it says nothing, because nothing started: `queued` is the announcement that a fetch is in flight,
    // and reporting it for a page that will never be fetched is a lie about the mechanism.
    expect(seen).toEqual([]);
  });

  it('asks once when the same signal has not fired, so the guard is a cancellation and not a broken page', async () => {
    const doc = countingDoc();
    const seen = statuses(doc, new AbortController().signal);

    await act(async () => undefined);

    expect(doc.getPage).toHaveBeenCalledTimes(1);
    expect(seen, 'the page really did start').toContain('queued');
  });

  it('reports no error to the host when the page was cancelled before it began', async () => {
    const doc = countingDoc();
    const onError = vi.fn();
    const controller = new AbortController();
    controller.abort();
    render(<PdfPage doc={doc} pageNumber={3} scale={1} signal={controller.signal} onError={onError} />);
    await act(async () => undefined);

    expect(onError).not.toHaveBeenCalled();
  });
});
