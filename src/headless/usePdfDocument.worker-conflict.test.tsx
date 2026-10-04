/*
 * FR-02 / FR-55's conflict clause, on the path a host actually takes: two viewers in one page.
 *
 * The requirement says conflicting active worker URLs "must surface as a `PdfError` whose code is
 * `CONFIGURATION_ERROR`, naming both origins". This is the half that decides *who is told* — the
 * module test beside it covers the claim itself. Two things are easy to get backwards here, and
 * both are asserted:
 *
 * - The viewer that arrives second is the one that fails. The first is already running on the URL
 *   in force, and re-pointing a live viewer is exactly the silent hazard the clause exists for.
 * - A relative URL and its absolute spelling are the same worker, because pdf.js resolves the value it is
 *   given against the page. Which value that is depends on the realm: pdf.js ships `'./pdf.worker.mjs'` in
 *   Node and `''` in a browser, so the case below — two viewers that configured nothing agreeing — is the
 *   Node row, and `worker.default.test.tsx` says why. A browser reaches the same agreement a beat later,
 *   once the probe has written a candidate URL; until then the field is empty and an empty field claims
 *   nothing, which is what keeps two unconfigured viewers from refusing each other in either realm.
 *
 * `getDocument` is the witness: a refused load must not have reached the engine.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfDocument } from './usePdfDocument';
import { isPdfError } from '../lib/errors';

const calls = vi.hoisted(() => vi.fn());

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDocument: (params: unknown) => calls(params),
}));

const doc = {
  numPages: 1,
  isPureXfa: false,
  getMetadata: async () => ({ info: {} }),
  hasJSActions: async () => false,
  destroy: async () => undefined,
} as unknown as PDFDocumentProxy;

function loads() {
  calls.mockImplementation(() => ({
    onPassword: null,
    promise: Promise.resolve(doc),
    destroy: async () => undefined,
  }));
}

afterEach(() => calls.mockReset());

const A = 'https://cdn.example.com/pdf.worker.min.mjs';
const B = 'https://files.other.example/pdf.worker.min.mjs';

function useLoad(workerSrc?: string) {
  return renderHook(() =>
    usePdfDocument({ src: 'https://files.example.com/contract.pdf', ...(workerSrc ? { workerSrc } : null) }),
  );
}

describe('two viewers, one realm (FR-02)', () => {
  it('refuses the second URL with CONFIGURATION_ERROR and never reaches the engine', async () => {
    loads();
    const first = useLoad(A);
    await waitFor(() => expect(first.result.current.status).toBe('ready'));

    const second = useLoad(B);
    await waitFor(() => expect(second.result.current.status).toBe('error'));
    const error = second.result.current.error;
    expect(isPdfError(error, 'CONFIGURATION_ERROR')).toBe(true);
    expect(error?.message).toContain('https://cdn.example.com');
    expect(error?.message).toContain('https://files.other.example');
    expect(error?.details).toEqual({
      problem: 'worker-conflict',
      requestedOrigin: 'https://files.other.example',
      activeOrigin: 'https://cdn.example.com',
    });
    // The refusal happened before the load, not after it.
    expect(calls).toHaveBeenCalledTimes(1);
    // And the viewer that was already working kept working.
    expect(first.result.current.status).toBe('ready');

    second.unmount();
    first.unmount();
  });

  it('lets two viewers share one URL', async () => {
    loads();
    const first = useLoad(A);
    const second = useLoad(A);
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(calls).toHaveBeenCalledTimes(2);
    second.unmount();
    first.unmount();
  });

  it('treats a relative URL and its absolute spelling as the same worker', async () => {
    loads();
    // jsdom's document base is http://localhost:3000/, which is what makes these two the same file.
    const first = useLoad('/pdf.worker.min.mjs');
    const second = useLoad('http://localhost:3000/pdf.worker.min.mjs');
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(second.result.current.error).toBeNull();
    second.unmount();
    first.unmount();
  });

  it('frees the realm when the first viewer unmounts', async () => {
    loads();
    const first = useLoad(A);
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    const second = useLoad(B);
    await waitFor(() => expect(second.result.current.status).toBe('error'));

    first.unmount();
    const retry = useLoad(B);
    await waitFor(() => expect(retry.result.current.status).toBe('ready'));
    retry.unmount();
    second.unmount();
  });

  it('claims the engine’s own default when nobody configured anything', async () => {
    loads();
    const first = useLoad();
    const second = useLoad();
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    // Two viewers with no `workerSrc` agree on pdf.js's default, so neither is refused — and the pair
    // still counts as one configuration, which is why a third with a real URL is not. Where this file runs
    // that default is the relative `'./pdf.worker.mjs'`; in a browser it is empty, and an empty field
    // claims nothing at all, so a third viewer there simply takes the realm.
    const third = useLoad(A);
    await waitFor(() => expect(third.result.current.status).toBe('error'));
    expect(isPdfError(third.result.current.error, 'CONFIGURATION_ERROR')).toBe(true);
    third.unmount();
    second.unmount();
    first.unmount();
  });
});
