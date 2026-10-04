/*
 * FR-36 on the load path.
 *
 * The interesting cases are the two that are easy to get backwards: aborting must look like an unmount and
 * not like a failure (FR-04's promise is that a cancellation never reaches an error surface), and a host
 * swapping which controller it holds must not tear down a document it never asked to reload.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfDocument } from './usePdfDocument';

const calls = vi.hoisted(() => vi.fn());

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDocument: (params: unknown) => calls(params),
}));

vi.mock('../lib/worker', () => ({
  ensureWorker: vi.fn(async () => undefined),
  createPdfWorker: vi.fn(async () => null),
  workerAutoDetectionFailed: () => false,
  // FR-02: the hook claims the realm's worker URL for the lifetime of a load. These tests
  // are about something else, and an empty configuration has nothing to claim and nothing to
  // conflict with.
  configuredWorkerSrc: () => '',
  claimWorkerSrc: () => ({ ok: true, release: () => {} }),
}));

const URL_SRC = 'https://files.example.com/contract.pdf';
const destroy = vi.fn(() => Promise.resolve());

/** A load that starts and never finishes, so there is always something to cancel. */
function pendingLoad() {
  destroy.mockClear();
  calls.mockImplementation(() => ({
    onPassword: null,
    promise: new Promise<PDFDocumentProxy>(() => undefined),
    destroy,
  }));
}

function resolvingLoad() {
  destroy.mockClear();
  calls.mockImplementation(() => ({
    onPassword: null,
    promise: Promise.resolve({
      numPages: 1,
      isPureXfa: false,
      getMetadata: async () => ({ info: {} }),
      hasJSActions: async () => false,
      destroy: async () => undefined,
    } as unknown as PDFDocumentProxy),
    destroy,
  }));
}

afterEach(() => {
  calls.mockReset();
});

describe('FR-36 aborting a load', () => {
  it('destroys the task and reports no error, because a cancellation is not a failure', async () => {
    pendingLoad();
    const controller = new AbortController();
    const { result } = renderHook(() => usePdfDocument({ src: URL_SRC, signal: controller.signal }));

    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeNull();

    act(() => controller.abort());
    await act(async () => undefined);

    expect(destroy, 'the same teardown an unmount runs').toHaveBeenCalled();
    expect(result.current.isReady).toBe(false);
    expect(result.current.doc).toBeNull();
    expect(result.current.error, 'FR-04: a cancellation must not reach an error surface').toBeNull();
  });

  it('does not deliver a document that was already in flight when the host aborted', async () => {
    let settle: ((doc: PDFDocumentProxy) => void) | undefined;
    calls.mockImplementation(() => ({
      onPassword: null,
      promise: new Promise<PDFDocumentProxy>((resolve) => {
        settle = resolve;
      }),
      destroy,
    }));

    const controller = new AbortController();
    const { result } = renderHook(() => usePdfDocument({ src: URL_SRC, signal: controller.signal }));
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));

    act(() => controller.abort());
    // The engine resolves *after* the abort. Late arrival must be discarded, not painted.
    await act(async () => {
      settle?.({
        numPages: 3,
        isPureXfa: false,
        getMetadata: async () => ({ info: {} }),
        hasJSActions: async () => false,
      } as unknown as PDFDocumentProxy);
      await Promise.resolve();
    });

    expect(result.current.isReady, 'a superseded load may not write into state').toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('never reports an error for a signal that had already fired before the hook mounted', async () => {
    resolvingLoad();
    const controller = new AbortController();
    controller.abort();

    const { result } = renderHook(() => usePdfDocument({ src: URL_SRC, signal: controller.signal }));
    await act(async () => undefined);

    expect(result.current.error).toBeNull();
    expect(result.current.isReady).toBe(false);
  });

  it('follows a swapped signal without restarting the load', async () => {
    // The FR-34 trap wearing a different clothes: `signal` in the load effect's dependencies would make a
    // host that builds a controller per render reload the document on every render.
    pendingLoad();
    const first = new AbortController();
    const second = new AbortController();

    const { rerender, result } = renderHook(
      ({ signal }: { signal: AbortSignal }) => usePdfDocument({ src: URL_SRC, signal }),
      { initialProps: { signal: first.signal } },
    );

    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    rerender({ signal: second.signal });
    await act(async () => undefined);

    expect(calls, 'changing which signal we follow is not a reason to reload').toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();

    // ...and the new signal is the one now in charge.
    act(() => second.abort());
    expect(destroy).toHaveBeenCalled();
  });

  it('loads again after reload() when the new signal is not aborted', async () => {
    resolvingLoad();
    const dead = new AbortController();
    dead.abort();
    const alive = new AbortController();

    const { result, rerender } = renderHook(
      ({ signal }: { signal: AbortSignal }) => usePdfDocument({ src: URL_SRC, signal }),
      { initialProps: { signal: dead.signal } },
    );
    await act(async () => undefined);
    expect(result.current.isReady).toBe(false);

    rerender({ signal: alive.signal });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.isReady).toBe(true));
  });
});
