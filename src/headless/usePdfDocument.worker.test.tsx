/*
 * FR-02's other half: what a host is told when nothing resolved.
 *
 * A browser cannot fall back to a main-thread worker from an empty configuration — `worker.fallback.test.ts`
 * measures that, and the real-browser pass found the engine throwing `No "GlobalWorkerOptions.workerSrc"
 * specified.` synchronously, before a single page loads. So the package's remaining duty on this path is
 * diagnostic: the failure has to name the option that fixes it, because a reader who sees only the engine's
 * sentence has no way to know that auto-detection ran and failed rather than never ran.
 *
 * The second test is the control that makes the first mean something. `workerAutoDetectionFailed()` is the
 * only thing separating "we looked and found nothing" from "the host pinned a URL that does not work", and
 * an unconditioned suffix would give both of them the same advice — including the instruction to pin the
 * thing they already pinned.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePdfDocument } from './usePdfDocument';

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
}));

/** The engine's own wording, measured in a browser with an unset `workerSrc`. */
const ENGINE_MESSAGE = 'No "GlobalWorkerOptions.workerSrc" specified.';

afterEach(() => {
  detection.failed = false;
  getDocument.mockReset();
});

/** `getDocument` throws the way the engine does on this path: synchronously, from the call itself. */
function throwsEngineError() {
  getDocument.mockImplementation(() => {
    throw new Error(ENGINE_MESSAGE);
  });
}

describe('a load that has no worker to run on', () => {
  it('names the option the host has to pin when auto-detection is what failed', async () => {
    detection.failed = true;
    throwsEngineError();
    const { result } = renderHook(() =>
      usePdfDocument({ src: 'https://files.example.com/report.pdf' }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    const message = result.current.error?.message ?? '';
    expect(message).toContain(ENGINE_MESSAGE);
    expect(message).toMatch(/worker was not found automatically/);
    expect(message).toMatch(/Pin it with `workerSrc`/);
  });

  it('leaves the engine\'s sentence alone when detection did not fail', async () => {
    throwsEngineError();
    const { result } = renderHook(() =>
      usePdfDocument({
        src: 'https://files.example.com/report.pdf',
        workerSrc: 'https://cdn.example.com/pdf.worker.min.mjs',
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe(ENGINE_MESSAGE);
  });
});
