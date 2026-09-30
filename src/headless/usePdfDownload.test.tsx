/*
 * The commit guard, tested both ways.
 *
 * `saveDocument()` on a pure-XFA document does not merely fail to carry the form's values — it
 * rejects, with `UnknownErrorException: Cannot read properties of null (reading 'get')`, measured
 * against all three `/XFA` container shapes the fixtures are written in. Anything that reaches for
 * a commit therefore has to know, and a reader pressing Download on a LiveCycle form should get a
 * file rather than an error dialog. Falling back to the loaded bytes is not a degraded outcome for
 * these documents: their fields bind without a `dataId`, so `XfaLayer.setupStorage` never attaches
 * and nothing a reader types enters the storage a commit would have written.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePdfDownload } from './usePdfDownload';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const saved = vi.hoisted(() => vi.fn());

vi.mock('../lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/download')>()),
  downloadBytes: (bytes: Uint8Array, name: string) => saved(bytes, name),
}));

const ONE = new Uint8Array([1, 2, 3]);
const TWO = new Uint8Array([4, 5, 6]);

const doc = (over: Record<string, unknown> = {}) =>
  ({
    getData: vi.fn(async () => ONE),
    saveDocument: vi.fn(async () => TWO),
    ...over,
  }) as unknown as PDFDocumentProxy;

const bytes = () => saved.mock.calls.at(-1)?.[0] as Uint8Array;

afterEach(() => {
  saved.mockClear();
});

describe('usePdfDownload with saveEdits', () => {
  it('commits the reader’s edits on an ordinary document', async () => {
    const current = doc();
    const { result } = renderHook(() => usePdfDownload({ doc: current, fileName: 'a' }));
    await act(async () => {
      await result.current.download({ saveEdits: true });
    });
    expect(current.saveDocument).toHaveBeenCalledTimes(1);
    expect(current.getData).not.toHaveBeenCalled();
    expect(bytes()).toEqual(TWO);
  });

  it('takes the loaded bytes for an XFA document, which cannot be committed', async () => {
    const current = doc({ isPureXfa: true });
    const { result } = renderHook(() => usePdfDownload({ doc: current, fileName: 'a' }));
    await act(async () => {
      await result.current.download({ saveEdits: true });
    });
    expect(current.saveDocument, 'the call that rejects must not be made').not.toHaveBeenCalled();
    expect(current.getData).toHaveBeenCalledTimes(1);
    expect(bytes()).toEqual(ONE);
  });

  it('reports nothing as an error, because the fallback is the correct answer', async () => {
    const onError = vi.fn();
    const current = doc({ isPureXfa: true });
    const { result } = renderHook(() => usePdfDownload({ doc: current, fileName: 'a', onError }));
    await act(async () => {
      await result.current.download({ saveEdits: true });
    });
    await waitFor(() => expect(result.current.isBusy).toBe(false));
    expect(result.current.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('still asks for the plain file when the caller did not want edits', async () => {
    const current = doc();
    const { result } = renderHook(() => usePdfDownload({ doc: current, fileName: 'a' }));
    await act(async () => {
      await result.current.download();
    });
    expect(current.saveDocument).not.toHaveBeenCalled();
    expect(current.getData).toHaveBeenCalledTimes(1);
  });
});

describe('usePdfDownload with an aborted signal (FR-36)', () => {
  it('writes no file, and reports no error, because the caller asked to stop', async () => {
    const onError = vi.fn();
    const current = doc();
    const controller = new AbortController();
    controller.abort();
    const { result } = renderHook(() =>
      usePdfDownload({ doc: current, fileName: 'a', onError, signal: controller.signal }),
    );

    await act(async () => {
      await result.current.download();
    });

    expect(saved, 'a cancelled download must not produce a file').not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isBusy).toBe(false));
  });

  it('still pays the worker round trip for the bytes, which is the honest boundary here', async () => {
    // Recording the limit rather than the feature: the signal is checked before the write, so an abort
    // costs the caller nothing observable but does not interrupt a `getData` already in flight. Making
    // that interruptible is the engine's fetch to cancel, not this one's, and FR-36 is satisfied by
    // never producing the file — not by pretending the round trip can be recalled.
    const current = doc();
    const controller = new AbortController();
    controller.abort();
    const { result } = renderHook(() =>
      usePdfDownload({ doc: current, fileName: 'a', signal: controller.signal }),
    );

    await act(async () => {
      await result.current.download();
    });

    expect(current.getData).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
  });

  it('writes the file when nothing aborted it, so the guard is not simply blocking everything', async () => {
    const current = doc();
    const { result } = renderHook(() =>
      usePdfDownload({ doc: current, fileName: 'a', signal: new AbortController().signal }),
    );

    await act(async () => {
      await result.current.download();
    });

    expect(saved).toHaveBeenCalledTimes(1);
    expect(bytes()).toEqual(ONE);
  });
});
