import { useCallback, useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfError, toPdfError } from '../lib/errors';
import { attachmentMimeType, normalizeAttachments, type AttachmentInfo } from '../lib/attachments';
import { downloadBytes } from '../lib/download';

export interface UsePdfAttachmentsOptions {
  doc: PDFDocumentProxy | null;
  onError?: (error: PdfError) => void;
}

export interface UsePdfAttachmentsResult {
  /** Attached files in name order; null until the first read finishes. */
  files: AttachmentInfo[] | null;
  loading: boolean;
  error: PdfError | null;
  supported: boolean;
  /** The file whose bytes are in flight, or null. */
  busyId: string | null;
  /** The last save that failed, keyed by file so only that row explains itself. */
  saveError: { id: string; message: string } | null;
  download: (id: string) => void;
}

/**
 * FR-20's sibling: the files a document carries, not the document itself.
 *
 * Contents are read one at a time, on demand. A document can embed a hundred
 * megabytes of report alongside the PDF it describes, and a list that prefetched
 * every entry to show a size column would pay for that before the reader asked.
 */
export function usePdfAttachments(options: UsePdfAttachmentsOptions): UsePdfAttachmentsResult {
  const { doc, onError } = options;
  const [files, setFiles] = useState<AttachmentInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PdfError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    setFiles(null);
    setError(null);
    if (!doc) return;
    let cancelled = false;
    setLoading(true);

    doc
      .getAttachments()
      .then((result) => {
        if (cancelled) return;
        setFiles(normalizeAttachments(result));
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(toPdfError(reason));
        setFiles(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [doc]);

  const download = useCallback(
    (id: string) => {
      if (!doc) return;
      const file = files?.find((entry) => entry.id === id);
      if (!file) return;
      setBusyId(id);
      setSaveError(null);

      // pdf.js 5.x already handed the bytes over with the list and cannot fetch one
      // later; 6.x says the opposite. One path covers both by asking the engine only
      // when the entry came without content.
      const ready = file.content
        ? Promise.resolve(file.content)
        : doc.getAttachmentContent(id);

      ready
        .then((content) => {
          if (!content || content.length === 0) {
            // The document says it holds this file and hands back nothing readable, which is the file being
            // damaged rather than the save failing — §3.6's `PDF_PARSE_ERROR`, stated here instead of leaving
            // the wrapper to guess `UNKNOWN_ERROR` from an unnameable Error.
            throw new PdfError('PDF_PARSE_ERROR', `"${file.filename}" has no readable content.`, {
              details: { filename: file.filename },
            });
          }
          downloadBytes(content as Uint8Array, file.filename, attachmentMimeType(file.filename));
        })
        .catch((reason: unknown) => {
          const failure = toPdfError(reason);
          setSaveError({ id, message: failure.message });
          onError?.(failure);
        })
        .finally(() => setBusyId(null));
    },
    [doc, files, onError],
  );

  return {
    files,
    loading,
    error,
    supported: Boolean(files && files.length > 0),
    busyId,
    saveError,
    download,
  };
}
