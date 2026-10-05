/*
 * FR-54 on the two load paths whose codes had no production-site assertion.
 *
 * `§3.6`'s list is a promise about what a consumer can *branch on*, and a code that only appears in a mapping
 * table is a promise nobody has tested a producer for: `errors.test.ts` proved `toPdfError` would name
 * `WORKER_ERROR` given an error with that name, and `PASSWORD_REQUIRED` given a hint — neither of which shows
 * that the load path ever asks for either. This drives the two paths through `usePdfDocument` itself.
 *
 * The worker path is the engine's own synchronous throw with no `workerSrc` reachable — measured in a browser
 * in FR-02's pass, quoted here as the message the classifier looks for. What separates this code from every
 * other parse failure is a conjunction, and both halves turned out to need their own case: the host must not
 * have pinned a worker, *and* the failure must be about a worker. The first draft of this file asserted the
 * pinning half and left the message half alone, and dropping the message test from the condition stayed green —
 * every failed load on an undetected worker would have reported `WORKER_ERROR` and told the host to pin a worker
 * it had already pinned. Two cases below are the two halves of that condition, each red on its own mutation.
 *
 * The password path is the reader dismissing the prompt. A dismissed prompt is the host *saying* they gave up,
 * by handing back an `Error` instead of a string, and it is the one terminal state on that path that is neither
 * a network failure nor an unclassified one — which is why it needs its own code, and why the case asserts the
 * code rather than the sentence.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePdfDocument } from './usePdfDocument';
import { isPdfError } from '../lib/errors';

const getDocument = vi.hoisted(() => vi.fn());
const detection = vi.hoisted(() => ({ failed: false }));

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDocument: (params: unknown) => getDocument(params),
}));

vi.mock('../lib/worker', () => ({
  ensureWorker: vi.fn(async () => undefined),
  createPdfWorker: vi.fn(async () => null),
  workerAutoDetectionFailed: () => detection.failed,
  configuredWorkerSrc: () => '',
  claimWorkerSrc: () => ({ ok: true, release: () => {} }),
}));

const ENGINE_MESSAGE = 'No "GlobalWorkerOptions.workerSrc" specified.';

afterEach(() => {
  detection.failed = false;
  getDocument.mockReset();
});

describe('FR-54: the load path produces the codes §3.6 publishes', () => {
  it('reports WORKER_ERROR from the site that diagnoses a missing worker, with the engine error as the cause', async () => {
    detection.failed = true;
    getDocument.mockImplementation(() => {
      throw new Error(ENGINE_MESSAGE);
    });

    const { result } = renderHook(() => usePdfDocument({ src: 'https://files.example.com/report.pdf' }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(isPdfError(result.current.error, 'WORKER_ERROR'), 'branchable, not just worded').toBe(true);
    // The diagnosis is written onto the engine's own error before it is wrapped, so the cause carries both
    // sentences and a host that logs the cause still sees what the engine said.
    expect((result.current.error?.cause as Error | undefined)?.message).toContain(ENGINE_MESSAGE);
    expect(result.current.error?.message).toMatch(/Pin it with `workerSrc`/);
  });

  it('leaves the code to the classifier when the host did pin a worker, which is the control above needs', async () => {
    getDocument.mockImplementation(() => {
      throw new Error(ENGINE_MESSAGE);
    });

    const { result } = renderHook(() =>
      usePdfDocument({
        src: 'https://files.example.com/report.pdf',
        workerSrc: 'https://cdn.example.com/pdf.worker.min.mjs',
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(
      result.current.error?.code,
      'the host pinned a URL: this is a failed fetch, not a worker that was never configured',
    ).not.toBe('WORKER_ERROR');
    expect(result.current.error?.message).toBe(ENGINE_MESSAGE);
  });

  it('keeps the worker advice off a failure the worker was not part of, even when detection had failed', async () => {
    // The counterfactual that found this case: with the message test dropped from the condition, every failed
    // load on an undetected worker reported `WORKER_ERROR` and told the host to pin a worker that was already
    // pinned correctly. A damaged file is not a configuration problem, and the advice is the bug.
    detection.failed = true;
    getDocument.mockImplementation(() => {
      throw new Error('damaged header');
    });

    const { result } = renderHook(() => usePdfDocument({ src: 'https://files.example.com/report.pdf' }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error?.code, 'the diagnosis is about a worker; this failure is not').not.toBe(
      'WORKER_ERROR',
    );
    expect(result.current.error?.message).toBe('damaged header');
  });

  it('reports PASSWORD_REQUIRED when the reader dismisses the prompt, on the path that produces it', async () => {
    let engineSubmit: ((password: string | Error) => void) | null = null;
    getDocument.mockImplementation(() => {
      let rejectLoad: (error: unknown) => void = () => undefined;
      const promise = new Promise<never>((_resolve, reject) => {
        rejectLoad = reject;
      });
      promise.catch(() => undefined);
      return {
        promise,
        destroy: () => Promise.resolve(),
        onProgress: null,
        set onPassword(handler: (submit: (password: string | Error) => void, reason: number) => void) {
          handler((password) => rejectLoad(password), 1);
        },

      };
    });

    const { result } = renderHook(() => usePdfDocument({ src: '/fixtures/encrypted-sample.pdf' }));
    await waitFor(() => expect(result.current.status).toBe('password-required'));
    const request = (result.current as { passwordRequest?: { submit: (p: string | Error) => void } }).passwordRequest;
    expect(request, 'the prompt is published so a built-in or a host can answer it').toBeTruthy();
    engineSubmit = request!.submit;

    // The dismissal, spelled the way the built-in control spells it: an Error, not a password.
    await act(() => {
      engineSubmit!(new Error('dismissed'));
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(isPdfError(result.current.error, 'PASSWORD_REQUIRED')).toBe(true);
    expect(result.current.error?.message, 'the host’s own reason survives the wrap').toBe('dismissed');
  });
});
