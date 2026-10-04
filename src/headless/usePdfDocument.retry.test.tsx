/*
 * FR-35 end to end: the classifier decides, the hook obeys.
 *
 * `retry.test.ts` covers what is transient and what is not. This covers the parts that can only go wrong in
 * the hook: that a retry really re-enters the load, that a permanent failure really does not, that **every**
 * retryable attempt is reported including the last (so "gave up" is a fact a host is told rather than a
 * guess it makes), and that an abort takes effect during the wait rather than only after it.
 *
 * Delays are forced to zero except in the abort test, which needs a long one to cut short and therefore runs
 * on fake timers.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidPDFException, ResponseException, type PDFDocumentProxy } from 'pdfjs-dist';
import type { RetryAttemptInfo } from '../lib/retry';
import { isPdfError } from '../lib/errors';
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
const FAST = { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: false };

const fakeDoc = () =>
  ({
    numPages: 2,
    isPureXfa: false,
    getMetadata: async () => ({ info: {} }),
    hasJSActions: async () => false,
    destroy: async () => undefined,
  }) as unknown as PDFDocumentProxy;

/** Fail with `error` for the first `failures` attempts, then resolve. */
function failThenSucceed(error: unknown, failures: number) {
  let n = 0;
  calls.mockImplementation(() => {
    n += 1;
    return {
      onPassword: null,
      promise: n <= failures ? Promise.reject(error) : Promise.resolve(fakeDoc()),
      destroy: () => Promise.resolve(),
    };
  });
}

/** Fail every attempt. */
function alwaysFail(error: unknown) {
  calls.mockImplementation(() => ({
    onPassword: null,
    promise: Promise.reject(error),
    destroy: () => Promise.resolve(),
  }));
}

const reported: RetryAttemptInfo[] = [];

afterEach(() => {
  calls.mockReset();
  reported.length = 0;
});

describe('FR-35 retrying a load', () => {
  it('retries a 503 and succeeds on the third attempt', async () => {
    failThenSucceed(new ResponseException('Unexpected server response (503)', 503, false), 2);
    const { result } = renderHook(() =>
      usePdfDocument({ src: URL_SRC, retry: FAST, onRetryAttempt: (i) => reported.push(i) }),
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(calls, 'two failures plus the attempt that worked').toHaveBeenCalledTimes(3);
    expect(reported.map((r) => [r.attempt, r.status])).toEqual([
      [1, 503],
      [2, 503],
    ]);
    expect(reported[0]?.attempts).toBe(3);
  });

  it('never retries a 401, and surfaces it as a credential problem', async () => {
    const refusal = new ResponseException('Unexpected server response (401)', 401, false);
    alwaysFail(refusal);
    const { result } = renderHook(() =>
      usePdfDocument({ src: URL_SRC, retry: FAST, onRetryAttempt: (i) => reported.push(i) }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(calls, 'a refused credential must not be retried').toHaveBeenCalledTimes(1);
    expect(reported).toHaveLength(0);
    // Asserted so "exactly one call" cannot also be satisfied by an unrelated
    // failure — a mock wired wrong would make one call too, and pass. FR-54: the surfaced failure is a
    // `PdfError` carrying AUTH_ERROR, with the engine's own exception preserved underneath it rather than
    // replaced — the code is ours to promise, the message is the origin's to explain.
    expect(isPdfError(result.current.error, 'AUTH_ERROR'), 'the surfaced failure is the 401').toBe(true);
    expect((result.current.error as unknown as { cause: unknown }).cause).toBe(refusal);
  });

  it('never retries a 403 either', async () => {
    const refusal = new ResponseException('Unexpected server response (403)', 403, false);
    alwaysFail(refusal);
    const { result } = renderHook(() => usePdfDocument({ src: URL_SRC, retry: FAST }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(calls).toHaveBeenCalledTimes(1);
    // A 403 is the same decision as a 401 from the reader's side: their credential is not accepted, and
    // another attempt will not change that.
    expect(isPdfError(result.current.error, 'AUTH_ERROR')).toBe(true);
    expect((result.current.error as unknown as { cause: unknown }).cause).toBe(refusal);
  });

  it('never retries a corrupt document, which will not become parseable', async () => {
    alwaysFail(new InvalidPDFException('Invalid PDF structure'));
    const { result } = renderHook(() =>
      usePdfDocument({ src: URL_SRC, retry: FAST, onRetryAttempt: (i) => reported.push(i) }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(calls).toHaveBeenCalledTimes(1);
    expect(reported).toHaveLength(0);
  });

  it('reports the last attempt too, as the one that will not be followed', async () => {
    alwaysFail(new ResponseException('Unexpected server response (503)', 503, false));
    const { result } = renderHook(() =>
      usePdfDocument({
        src: URL_SRC,
        retry: { attempts: 2, baseDelayMs: 0, jitter: false },
        onRetryAttempt: (i) => reported.push(i),
      }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(calls).toHaveBeenCalledTimes(2);
    /*
     * Both attempts are heard about. The second carries `willRetry: false` and no delay, and it is the
     * reason this is a report rather than a countdown: a host that heard about attempt one and then nothing
     * cannot tell an exhausted retry from a request still in flight, and shows a spinner either way.
     */
    expect(reported.map((info) => [info.attempt, info.willRetry, info.delayMs])).toEqual([
      [1, true, 0],
      [2, false, 0],
    ]);
    expect(reported[1]).toMatchObject({ attempts: 2, status: 503 });
  });

  /*
   * FR-35's second clause, and the one an un-cancellable `setTimeout` fails quietly: the wait is where an
   * abort has to land, because a reader who closes the viewer during a thirty-second backoff would otherwise
   * leave it running — and then make a fortieth attempt at an origin that has been down for half a minute.
   *
   * Fake timers make the claim checkable rather than merely fast: the assertion is that no timer is left
   * after the abort, which is a different fact from "nothing happened yet".
   */
  it('takes an abort during the backoff wait, not only after it', async () => {
    vi.useFakeTimers();
    try {
      alwaysFail(new ResponseException('Unexpected server response (503)', 503, false));
      const controller = new AbortController();
      const { result } = renderHook(() =>
        usePdfDocument({
          src: URL_SRC,
          retry: { attempts: 3, baseDelayMs: 5_000, maxDelayMs: 5_000, jitter: false },
          signal: controller.signal,
          onRetryAttempt: (i) => reported.push(i),
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(reported.map((info) => info.attempt)).toEqual([1]);
      expect(calls).toHaveBeenCalledTimes(1);

      act(() => controller.abort());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.status, 'a stop the host asked for is `cancelled`').toBe('cancelled');
      expect(result.current.error, 'and never a failure').toBeNull();
      expect(vi.getTimerCount(), 'the pending 5 s wait is cleared, not left to fire').toBe(0);

      // The interval the abort cut short would have expired twice over by now.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(calls, 'no attempt starts after the reader stopped').toHaveBeenCalledTimes(1);
      expect(reported).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry at all when the host opts out', async () => {
    failThenSucceed(new ResponseException('Unexpected server response (503)', 503, false), 1);
    const { result } = renderHook(() =>
      usePdfDocument({ src: URL_SRC, retry: false, onRetryAttempt: (i) => reported.push(i) }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(calls).toHaveBeenCalledTimes(1);
    expect(reported).toHaveLength(0);
  });

  it('retries a request that never got a response, which is how offline arrives', async () => {
    failThenSucceed(new ResponseException('network error', 0, false), 1);
    const { result } = renderHook(() =>
      usePdfDocument({ src: URL_SRC, retry: FAST, onRetryAttempt: (i) => reported.push(i) }),
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(calls).toHaveBeenCalledTimes(2);
    expect(reported[0]).toMatchObject({ status: 0, reason: 'no response reached us' });
  });

  it('retries by default, since the engine does the fetch and a host cannot retry it themselves', async () => {
    failThenSucceed(new ResponseException('Unexpected server response (503)', 503, false), 1);
    const { result } = renderHook(() =>
      usePdfDocument({ src: URL_SRC, onRetryAttempt: (i) => reported.push(i) }),
    );

    await waitFor(() => expect(result.current.isReady).toBe(true), { timeout: 5_000 });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(reported[0]?.attempts, 'the documented default').toBe(3);
  });
});
