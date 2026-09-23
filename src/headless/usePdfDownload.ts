import { useCallback, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { downloadBytes, pdfFileName } from '../lib/download';

export interface UsePdfDownloadOptions {
  doc: PDFDocumentProxy | null;
  /** Name for the saved file, with or without the extension. */
  fileName?: string;
  onError?: (error: Error) => void;
}

export interface PdfDownloadOptions {
  /**
   * Embed the current form values instead of saving the file as loaded.
   *
   * pdf.js writes an incremental update with the stored values and regenerated
   * appearance streams, so the fields stay interactive: this is "save", not a
   * true flatten (flattening needs a PDF writer, which this library is not).
   */
  withFormValues?: boolean;
}

export interface UsePdfDownloadResult {
  download: (options?: PdfDownloadOptions) => Promise<void>;
  isBusy: boolean;
  error: Error | null;
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
}: UsePdfDownloadOptions): UsePdfDownloadResult {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const docRef = useRef(doc);
  docRef.current = doc;
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const busyRef = useRef(false);

  const download = useCallback(async (options: PdfDownloadOptions = {}) => {
    const current = docRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      const bytes = options.withFormValues
        ? await current.saveDocument()
        : await current.getData();
      downloadBytes(bytes, pdfFileName(fileNameRef.current));
    } catch (err) {
      const next = err instanceof Error ? err : new Error(String(err));
      setError(next);
      onErrorRef.current?.(next);
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  }, []);

  return { download, isBusy, error, fileName: pdfFileName(fileName) };
}
