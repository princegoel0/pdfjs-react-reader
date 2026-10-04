/*
 * The commit guard, tested both ways — and the reason the guard says anything at all.
 *
 * `saveDocument()` on a pure-XFA document does not merely fail to carry the form's values: it rejects, with
 * `UnknownErrorException: Cannot read properties of null (reading 'get')`, measured against all three `/XFA`
 * container shapes the fixtures are written in. So the commit is refused before it is attempted, and a reader
 * pressing Download on a LiveCycle form gets a file rather than an error dialog.
 *
 * What is *not* the reason is field binding, which an earlier version of this header asserted and a
 * measurement reversed: typing into these packets does reach `annotationStorage` (size 0 → 1 on a keystroke),
 * because `XfaLayer.setAttributes` computes a `dataId` for every field and deliberately leaves it out of the
 * DOM. The absence of a `data-id` attribute measures nothing. The save is refused because the writer cannot
 * rebuild an XFA packet — which is why the file that comes back is the loaded one, and why `FR-33` asks for a
 * *reason*: a reader who typed into a form and got a pristine copy deserves to be told, and until the outcome
 * carried `refused` the only party in a position to say so — the caller — knew nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePdfDownload, type PdfDownloadOutcome } from './usePdfDownload';
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

/*
 * FR-33's last clause: the refusal has a reason, and the reason reaches someone.
 *
 * The file is the right one — a pristine copy beats nothing — so this is not an error and does not travel as
 * one. It is a fact about what the caller is holding, and three parties need it: the code that awaited the
 * promise, a host that would rather be told by callback than by inspecting a result, and the reader, who
 * gets it from the control they just pressed.
 */
describe('FR-33: the XFA save refusal names its reason', () => {
  it('resolves with the refusal and says the file is not committed', async () => {
    const current = doc({ isPureXfa: true });
    const { result } = renderHook(() => usePdfDownload({ doc: current, fileName: 'a' }));
    let outcome: PdfDownloadOutcome | null = null;
    await act(async () => {
      outcome = await result.current.download({ saveEdits: true });
    });

    expect(outcome).toEqual({ fileName: 'a.pdf', committed: false, refused: 'xfa' });
    expect(result.current.refused, 'the state a host-written control reads').toBe('xfa');
  });

  it('calls onRefused and not onError, because a refusal is not a failure', async () => {
    const onRefused = vi.fn();
    const onError = vi.fn();
    const current = doc({ isPureXfa: true });
    const { result } = renderHook(() =>
      usePdfDownload({ doc: current, fileName: 'contract', onRefused, onError }),
    );
    await act(async () => {
      await result.current.download({ saveEdits: true });
    });

    expect(onRefused).toHaveBeenCalledWith('xfa', { fileName: 'contract.pdf' });
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    // And the file still left, which is the part the clause does not take away.
    expect(bytes()).toEqual(ONE);
  });

  it('says nothing was refused on the two cases where nothing was: a committed save, and a plain download', async () => {
    const committed = doc();
    const { result: commitResult } = renderHook(() =>
      usePdfDownload({ doc: committed, fileName: 'a' }),
    );
    let outcome: PdfDownloadOutcome | null = null;
    await act(async () => {
      outcome = await commitResult.current.download({ saveEdits: true });
    });
    expect(outcome).toEqual({ fileName: 'a.pdf', committed: true, refused: null });
    expect(commitResult.current.refused).toBeNull();

    const plain = doc({ isPureXfa: true });
    const { result: plainResult } = renderHook(() => usePdfDownload({ doc: plain, fileName: 'a' }));
    await act(async () => {
      outcome = await plainResult.current.download();
    });
    // An XFA document asked for its original bytes was never owed a commit, so there is nothing to refuse.
    expect(outcome).toEqual({ fileName: 'a.pdf', committed: false, refused: null });
  });

  it('clears the refusal when the next download succeeds', async () => {
    const current = doc({ isPureXfa: true });
    const { result } = renderHook(() => usePdfDownload({ doc: current, fileName: 'a' }));
    await act(async () => {
      await result.current.download({ saveEdits: true });
    });
    expect(result.current.refused).toBe('xfa');

    await act(async () => {
      await result.current.download();
    });
    expect(result.current.refused, 'a stale reason on a control reads as a live one').toBeNull();
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

  it('performs no work at all, so the caller is not charged for a file they cancelled', async () => {
    // The clause is "an already-aborted signal performs no work", and the work here is the round trip:
    // `getData()` asks the worker for the whole document, which on a large file is the seconds the caller is
    // giving up on. Checking the signal after that await — which is what this did — still wrote no file, but
    // it had already paid for the bytes, so the abort arrived too late to answer anything. The test below
    // keeps the other side honest: an un-aborted signal must still produce the file.
    const current = doc();
    const controller = new AbortController();
    controller.abort();
    const { result } = renderHook(() =>
      usePdfDownload({ doc: current, fileName: 'a', signal: controller.signal }),
    );

    await act(async () => {
      await result.current.download();
    });

    expect(current.getData).not.toHaveBeenCalled();
    expect(current.saveDocument).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(result.current.isBusy, 'a download that never started is not busy').toBe(false);
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
