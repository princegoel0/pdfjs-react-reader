import { useCallback, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfError } from '../lib/errors';
import { toPdfError } from '../lib/errors';
import { downloadBytes, pdfFileName } from '../lib/download';

/** Why a save could not carry the reader's changes. One member today; the name is the contract. */
export type PdfSaveRefusal = 'xfa';

/** What a download actually did, resolved to the caller that asked for it. */
export interface PdfDownloadOutcome {
  /** The name the file was written under. */
  fileName: string;
  /** True when the bytes carry what the reader changed. */
  committed: boolean;
  /**
   * Why the changes are not in the file, when they are not — `null` when there was nothing to refuse.
   *
   * `FR-33` is the clause: a pure-XFA document cannot be committed, and the save is refused rather than
   * attempted. Falling back to the loaded bytes is the right file to hand over, but a reader who typed into
   * a form and got a pristine copy needs someone to be told why, and until now no one was: the fallback was
   * silent, and the only party in the room who can say so is the one that made the call.
   */
  refused: PdfSaveRefusal | null;
}

export interface UsePdfDownloadOptions {
  doc: PDFDocumentProxy | null;
  /** Name for the saved file, with or without the extension. */
  fileName?: string;
  onError?: (error: PdfError) => void;
  /**
   * Called when a save the caller asked for was refused — the same fact the resolved outcome carries, for a
   * host that is not awaiting it. A refusal is not an error, so it does not reach `onError`.
   */
  onRefused?: (refusal: PdfSaveRefusal, detail: { fileName: string }) => void;
  /**
   * Abandon a download in progress. Collecting the bytes of a large document is a round trip to the worker
   * that can take seconds, and until now the only way out was to unmount. An abort writes no file and
   * reports no error — the host asked to stop, which is not a failure.
   */
  signal?: AbortSignal;
}

export interface PdfDownloadOptions {
  /**
   * Write what the reader changed into the file instead of handing back the bytes it
   * was loaded from.
   *
   * pdf.js answers this with an incremental update built from the document's
   * `annotationStorage`, which is where *both* kinds of edit land: the value of a
   * form field and a highlight a reader made. Callers therefore pick this branch on
   * "is anything pending", not on which feature made the change. The fields stay
   * interactive and the marks stay selectable — this is "save", not a true flatten,
   * which needs a PDF writer and so lives in `pdfjs-react-reader/edit`, outside the
   * zero-dependency boundary of the core.
   */
  saveEdits?: boolean;
}

export interface UsePdfDownloadResult {
  /**
   * Write the file. Resolves to what happened, or to `null` when nothing was written — no document, a
   * download already running, or a signal that had already fired.
   */
  download: (options?: PdfDownloadOptions) => Promise<PdfDownloadOutcome | null>;
  isBusy: boolean;
  error: PdfError | null;
  /** Why the last download could not carry the reader's edits, or `null`. Cleared when the next one starts. */
  refused: PdfSaveRefusal | null;
  /** The name the next download will use. */
  fileName: string;
}

/**
 * FR-20: save the document the viewer is showing.
 *
 * The bytes come from the engine (`getData`) rather than a re-fetch, so this
 * works identically for URLs, `File`s, buffers and base64 sources.
 */
export function usePdfDownload({
  doc,
  fileName,
  onError,
  onRefused,
  signal,
}: UsePdfDownloadOptions): UsePdfDownloadResult {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<PdfError | null>(null);
  const [refused, setRefused] = useState<PdfSaveRefusal | null>(null);

  const docRef = useRef(doc);
  docRef.current = doc;
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onRefusedRef = useRef(onRefused);
  onRefusedRef.current = onRefused;
  const signalRef = useRef(signal);
  signalRef.current = signal;
  const busyRef = useRef(false);

  const download = useCallback(async (options: PdfDownloadOptions = {}) => {
    const current = docRef.current;
    if (!current || busyRef.current) return null;
    /*
     * FR-36: an already-aborted signal performs no work, and this is the operation where that is expensive —
     * the work is a round trip to the worker for the whole file, which on a large document is the seconds a
     * host is giving up on. Checking after the await (as this did) still wrote no file, but it had already
     * paid for the bytes, so the abort arrived too late to be an answer to anything.
     */
    if (signalRef.current?.aborted) return null;
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    setRefused(null);
    const name = pdfFileName(fileNameRef.current);
    try {
      /*
       * An XFA document cannot be committed. `saveDocument()` is measured against all three
       * `/XFA` container shapes the fixtures are written in: the single stream rejects either
       * way — on `xfa-sample.pdf` it throws `Cannot read properties of null (reading
       * 'toString')` from inside the engine — and an array rejects while `annotationStorage`
       * is empty. What is *not* the reason is the field binding: typing into these packets
       * does reach storage (`annotationStorage.size` goes 0 → 1 on a keystroke), because
       * `XfaLayer.setAttributes` computes a `dataId` for every field and deliberately leaves
       * it out of the DOM, so the absence of a `data-id` attribute measures nothing. The save
       * is refused because the writer cannot rebuild a packet, not because the edit was lost
       * before it got there.
       *
       * Falling back to the loaded bytes is still the right file to hand over — a reader who
       * cannot save their edits should not also lose the document. What was missing is the
       * `FR-33` half of the clause: a refusal has to *name its reason*, and a silent fallback
       * left the one party who can say so — the caller — knowing nothing.
       */
      const refusedNow: PdfSaveRefusal | null =
        options.saveEdits && current.isPureXfa === true ? 'xfa' : null;
      const commits = options.saveEdits === true && refusedNow === null;
      const bytes = commits ? await current.saveDocument() : await current.getData();
      // Checked after the await and before the write: the point of aborting a download is to not produce
      // a file, and by here the bytes have already arrived.
      if (signalRef.current?.aborted) return null;
      downloadBytes(bytes, name);
      if (refusedNow) {
        setRefused(refusedNow);
        onRefusedRef.current?.(refusedNow, { fileName: name });
      }
      return { fileName: name, committed: commits, refused: refusedNow };
    } catch (err) {
      const next = toPdfError(err);
      setError(next);
      onErrorRef.current?.(next);
      return null;
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }, []);

  return { download, isBusy, error, refused, fileName: pdfFileName(fileName) };
}
