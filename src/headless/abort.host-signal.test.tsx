/*
 * FR-36's two paths that took a token and had no test aborting it: the print loop and the attachments walk.
 *
 * The clause lists the operations by name — "load, page proxy fetch, render, text extraction, indexing,
 * thumbnail, print render, download, and every writer pass" — and #174 wired the render, the thumbnail and the
 * writer. Wiring is not the contract. Two of those names had nothing asserting the abort: `usePdfPrint`'s host
 * signal, whose only exercise was a ceilings test that cancels nothing, and `usePdfAttachments`'s, which no test
 * mentioned at all. The third gap in the row — the card's canvas — is guarded by `PdfThumbnail.abort.test.tsx`
 * beside this file, and the form half of the same component by `PdfThumbnail.xfa.test.tsx`.
 *
 * What the four sentences of the clause come to on these two paths:
 *
 *  - **an abort is the same event as `cancel()`**, so the loop stops at the page it is on and the pages after it
 *    are never fetched — a print that "cancelled" by walking every remaining page would be a cancel that only
 *    changed who pressed the button;
 *  - **cancellation is not a failure**: no `onError`, no `error` state, and the body class and the detached
 *    canvases cleaned up as they are on a completed job;
 *  - **an already-aborted token performs no work** — for print that means the whole loop, including the page
 *    fetch that sizes the plan, and for the attachment list the catalog round trip that starts it;
 *  - and the walk's partial answer is **not published as if it were the document's**. This is the one the read
 *    found rather than proved: an abort in flight used to write the pages it had reached into `files` and set
 *    `loading` false, while an unmount published nothing. FR-36 says the host's token and the component's own
 *    lifetime are the same cancellation, so the two doors now end the same way, and the case below is the one
 *    that would have caught it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

import { usePdfPrint } from './usePdfPrint';
import { usePdfAttachments } from './usePdfAttachments';
import { collectAnnotationAttachments } from '../lib/attachments';

/** A page whose render the test settles by hand, so an abort can land mid-paint. */
/**
 * The render tasks the fake page hands back. `cancel` stays typed as the spy it is, because the assertion that
 * matters here is how many times the engine's own cancellation was called — and the range arguments below are
 * the tuples the published option actually declares, not the string the toolbar parses.
 */
type PrintTask = { cancel: Mock; settle: () => void };

function deferredPage(number: number, tasks: PrintTask[]) {
  return {
    rotate: 0,
    cleanup: vi.fn(),
    getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({ width: 612 * scale, height: 792 * scale }),
    getAnnotations: async () => [],
    render: () => {
      let settle = (): void => undefined;
      const promise = new Promise<void>((resolve) => {
        settle = resolve;
      });
      promise.catch(() => undefined);
      const cancel = vi.fn(() => settle());
      tasks.push({ cancel, settle });
      return {
        promise,
        cancel,
      } as unknown as RenderTask;
    },
  } as unknown as PDFPageProxy;
}

function printDoc(numPages: number, tasks: PrintTask[]) {
  const getPage = vi.fn(async (pageNumber: number) => deferredPage(pageNumber, tasks));
  return {
    numPages,
    getPage,
    annotationStorage: null,
    getViewport: () => ({ width: 612, height: 792 }),
  } as unknown as PDFDocumentProxy & { getPage: ReturnType<typeof vi.fn> };
}

/** A document with one paperclip per page, which is the shape the walk exists to find. */
function attachmentsDoc(numPages: number, options: { carried?: number; pageDelayMs?: number } = {}) {
  const { carried = 1, pageDelayMs = 0 } = options;
  const getPage = vi.fn(async (pageNumber: number) => {
    // A real timer per page, so a host's abort can land *between* pages: a chain of already-resolved promises
    // is a microtask loop no timeout can interrupt, and the test would then be measuring the scheduler.
    if (pageDelayMs) await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
    return {
      getAnnotations: async () =>
        pageNumber <= carried
          ? [
              {
                subtype: 'FileAttachment',
                fileId: `attachmentRef:${pageNumber}R`,
                file: { filename: `p${pageNumber}.txt` },
              },
            ]
          : [],
    } as unknown as PDFPageProxy;
  });
  const getAttachments = vi.fn(async () => ({ 'named.pdf': { filename: 'named.pdf', content: new Uint8Array(4) } }));
  const doc = {
    numPages,
    getPage,
    getAttachments,
    getAttachmentContent: async () => new Uint8Array(4),
  } as unknown as PDFDocumentProxy & {
    getPage: ReturnType<typeof vi.fn>;
    getAttachments: ReturnType<typeof vi.fn>;
  };
  return { doc, getPage, getAttachments };
}

function aborted(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}

afterEach(() => {
  document.body.classList.remove('pjsr-printing');
  document
    .querySelectorAll('.pjsr-print-container')
    .forEach((node) => {
      node.remove();
    });
});

describe('FR-36: the print render is cancellable by its owner and by the host', () => {
  it('stops the loop mid-paint, cleans the sheet away, and reports nothing', async () => {
    const controller = new AbortController();
    const tasks: PrintTask[] = [];
    const doc = printDoc(6, tasks);
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfPrint({ doc, onError, signal: controller.signal }));

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.print({ range: [1, 6] });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.isPrinting, 'the job is running').toBe(true);
    expect(tasks.length, 'page 1 is being painted').toBeGreaterThan(0);
    const fetchedSoFar = doc.getPage.mock.calls.length;

    await act(async () => {
      controller.abort();
      await done;
    });

    expect(tasks[0]!.cancel, 'the host abort reached the running task').toHaveBeenCalled();
    expect(
      doc.getPage.mock.calls.length,
      'the pages after the abort were never opened — a cancel that walked them is not a cancel',
    ).toBeLessThan(6);
    expect(onError, 'abort is not an ordinary failure').not.toHaveBeenCalled();
    expect(result.current.error, 'and nothing is left in the error state').toBeNull();
    expect(result.current.isPrinting, 'the job settled').toBe(false);
    expect(document.querySelector('.pjsr-print-container'), 'the off-screen sheet went away').toBeNull();
    expect(document.body.classList.contains('pjsr-printing'), 'and the print body class went with it').toBe(false);
    expect(fetchedSoFar, 'the first page was fetched before the abort').toBeGreaterThan(0);
  });

  it('performs no work at all for a token that was already aborted', async () => {
    const tasks: PrintTask[] = [];
    const doc = printDoc(3, tasks);
    const { result } = renderHook(() => usePdfPrint({ doc, signal: aborted().signal }));

    await act(async () => {
      await result.current.print();
    });

    expect(doc.getPage, 'not even the page whose box sizes the plan').not.toHaveBeenCalled();
    expect(tasks).toHaveLength(0);
    expect(result.current.isPrinting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('treats the host signal as the same call the host could make by hand', async () => {
    const controller = new AbortController();
    const tasks: PrintTask[] = [];
    const doc = printDoc(4, tasks);
    const { result } = renderHook(() => usePdfPrint({ doc, signal: controller.signal }));

    let bySignal: Promise<void> = Promise.resolve();
    await act(async () => {
      bySignal = result.current.print({ range: [1, 4] });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      controller.abort();
      await bySignal;
    });
    const cancelledBySignal = tasks.filter((task) => task.cancel.mock.calls.length > 0).length;

    const controller2 = new AbortController();
    const direct: PrintTask[] = [];
    const second = renderHook(() => usePdfPrint({ doc: printDoc(4, direct), signal: controller2.signal }));
    let byHand: Promise<void> = Promise.resolve();
    await act(async () => {
      byHand = second.result.current.print({ range: [1, 4] });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      second.result.current.cancel();
      await byHand;
    });

    expect(direct.filter((task) => task.cancel.mock.calls.length > 0).length).toBe(cancelledBySignal);
  });
});

describe('FR-36: the attachment walk is cancellable, and stops being a list when it is', () => {
  it('reads no page for a token that was already aborted', async () => {
    const { doc, getPage, getAttachments } = attachmentsDoc(3);

    const found = await collectAnnotationAttachments(doc, aborted().signal);

    expect(found).toEqual([]);
    expect(getPage).not.toHaveBeenCalled();

    const { result } = renderHook(() => usePdfAttachments({ doc, signal: aborted().signal }));
    await act(async () => undefined);
    expect(getAttachments, 'the catalog round trip is work too').not.toHaveBeenCalled();
    expect(result.current.files, 'nothing is claimed about the document').toBeNull();
    expect(result.current.loading, 'and the panel is not left waiting').toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('stops the walk at the page the abort lands on', async () => {
    const controller = new AbortController();
    const { doc, getPage } = attachmentsDoc(40, { carried: 40, pageDelayMs: 1 });

    const walk = collectAnnotationAttachments(doc, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 8));
    controller.abort();
    const found = await walk;

    const pages = getPage.mock.calls.map((call) => call[0]);
    expect(pages.length, 'a walk over 40 pages did not finish in 8 ms').toBeLessThan(40);
    expect(pages, 'the pages were read in order, and the loop broke at its next check').toEqual(
      Array.from({ length: pages.length }, (_, i) => i + 1),
    );
    expect(found.map((entry) => entry.filename), 'what it found on the way is what it returns').toHaveLength(
      pages.length,
    );
  });

  it('publishes a partial walk as nothing, the same way an unmount does', async () => {
    const controller = new AbortController();
    const { doc, getPage } = attachmentsDoc(40, { carried: 40, pageDelayMs: 1 });
    const onError = vi.fn();
    const { result } = renderHook(() => usePdfAttachments({ doc, signal: controller.signal, onError }));

    await new Promise((resolve) => setTimeout(resolve, 8));
    await act(async () => {
      controller.abort();
    });
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 4_000 });

    const pages = getPage.mock.calls.map((call) => call[0]);
    expect(pages.length, 'the walk was cut short, which is the premise of the rest of this case').toBeLessThan(40);
    expect(result.current.files, 'a list cut off at page N is not the document’s files').toBeNull();
    expect(onError, 'and stopping is not a failure').not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.supported, 'the panel says nothing was listed, which is what happened').toBe(false);
  });

  it('lists the files a document carries when nobody interrupts the walk', async () => {
    const { doc } = attachmentsDoc(2, { carried: 2 });
    const { result } = renderHook(() => usePdfAttachments({ doc }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files?.map((entry) => entry.filename).sort()).toEqual([
      'named.pdf',
      'p1.txt',
      'p2.txt',
    ]);
    expect(result.current.supported).toBe(true);
  });
});
