/*
 * FR-34: the network contract.
 *
 * The engine has accepted `httpHeaders` and `withCredentials` since long before this package existed;
 * what it could not do was receive them from a React component, because a hook that forwards an object
 * prop has to decide whether that object is a dependency. Get it wrong and
 * `httpHeaders={{ Authorization: token }}` — a fresh literal on every render — restarts the document
 * load on every keystroke of the parent, which is the failure `src` was already ref-tracked to avoid.
 *
 * So these tests assert both halves: the options arrive, and arriving does not make them reactive.
 *
 * The second half was proven by breaking it on purpose. Adding `httpHeaders` to the load effect's
 * dependency array does not restart the load once per render — it loops without bound, because each load
 * sets state, the state re-renders the host, the re-render mints a new literal, and the literal re-runs
 * the effect. Measured: **2,666 `getDocument` calls** in the re-render test and **60,417** in the reload
 * one, against the 1 and 2 they assert. That is the number this file exists to keep at those two values.
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

/** A document that satisfies `reportCapabilities` and the effect's teardown, and nothing more. */
const fakeDoc = () =>
  ({
    numPages: 3,
    isPureXfa: false,
    getMetadata: async () => ({ info: {} }),
    hasJSActions: async () => false,
    destroy: async () => undefined,
  }) as unknown as PDFDocumentProxy;

/** `getDocument` is called synchronously by the hook, so it must hand back a live loading task. */
function taskReturning(doc: PDFDocumentProxy) {
  calls.mockImplementation(() => ({
    onPassword: null,
    promise: Promise.resolve(doc),
    destroy: () => Promise.resolve(),
  }));
}

/** Every parameter object `getDocument` was called with, most recent last. */
const params = () => calls.mock.calls.map((c) => c[0] as Record<string, unknown>);
const last = () => params().at(-1) ?? {};

afterEach(() => {
  calls.mockReset();
});

describe('FR-34 network contract', () => {
  it('forwards headers, credentials and the range controls to the engine', async () => {
    taskReturning(fakeDoc());
    const { result } = renderHook(() =>
      usePdfDocument({
        src: 'https://files.example.com/contract.pdf',
        httpHeaders: { Authorization: 'Bearer t0ken', 'X-Tenant': 'acme' },
        withCredentials: true,
        rangeChunkSize: 32_768,
        disableStream: true,
      }),
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(last()).toMatchObject({
      url: 'https://files.example.com/contract.pdf',
      httpHeaders: { Authorization: 'Bearer t0ken', 'X-Tenant': 'acme' },
      withCredentials: true,
      rangeChunkSize: 32_768,
      disableStream: true,
    });
    // Omitted means the engine's own default, not an explicit false.
    expect(last()).not.toHaveProperty('disableRange');
  });

  it('sends no network options for a byte source, where they would be meaningless', async () => {
    taskReturning(fakeDoc());
    const { result } = renderHook(() =>
      usePdfDocument({
        src: new Uint8Array([1, 2, 3]),
        httpHeaders: { Authorization: 'Bearer t0ken' },
        withCredentials: true,
      }),
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(last()).toHaveProperty('data');
    expect(last()).not.toHaveProperty('httpHeaders');
    expect(last()).not.toHaveProperty('withCredentials');
  });

  it('does not reload when the host re-renders with a fresh headers literal', async () => {
    const doc = fakeDoc();
    taskReturning(doc);
    const { result, rerender } = renderHook(
      ({ token }: { token: string }) =>
        usePdfDocument({
          src: 'https://files.example.com/contract.pdf',
          httpHeaders: { Authorization: `Bearer ${token}` },
        }),
      { initialProps: { token: 'a' } },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(calls).toHaveBeenCalledTimes(1);

    // Three re-renders, three new object identities, one load. This is the trap:
    // `httpHeaders` in the effect's dependency array would make this three.
    for (const token of ['b', 'c', 'd']) {
      rerender({ token });
    }
    await act(async () => undefined);
    expect(calls, 'an inline literal must not restart the load').toHaveBeenCalledTimes(1);
  });

  it('picks up new headers on reload, which a closure captured at effect time would not', async () => {
    const doc = fakeDoc();
    taskReturning(doc);
    const { result, rerender } = renderHook(
      ({ token }: { token: string }) =>
        usePdfDocument({
          src: 'https://files.example.com/contract.pdf',
          httpHeaders: { Authorization: `Bearer ${token}` },
        }),
      { initialProps: { token: 'before' } },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(last().httpHeaders).toEqual({ Authorization: 'Bearer before' });

    rerender({ token: 'after' });
    act(() => result.current.reload());
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(2));

    expect(last().httpHeaders, 'a rotated token must reach the next load').toEqual({
      Authorization: 'Bearer after',
    });
  });
});
