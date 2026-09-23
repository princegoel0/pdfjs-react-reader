import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  PasswordResponses,
  version as pdfjsVersion,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import { normalizeSource, type PdfSource } from '../lib/source';
import { configureWorker } from '../lib/worker';

export type PasswordReason = 'need-password' | 'incorrect-password';

/**
 * Resolves the pending password request: pass the password, or an `Error` to
 * abort loading (pdf.js rejects the loading task with it).
 */
export type PasswordSubmit = (password: string | Error) => void;

export interface UsePdfDocumentOptions {
  src: PdfSource;
  /** Worker script location. Auto-detected when omitted; pdf.js falls back to its main-thread worker if resolution fails. */
  workerSrc?: string;
  /** Called when the document is encrypted. Invoke the provided callback with the password to continue. */
  onPasswordRequired?: (submit: PasswordSubmit, reason: PasswordReason) => void;
  /** Base URL for CMap files. Defaults to the matching pdfjs-dist version on unpkg. */
  cMapUrl?: string;
  /** Base URL for standard font files. Defaults to the matching pdfjs-dist version on unpkg. */
  standardFontUrl?: string;
}

export interface UsePdfDocumentResult {
  doc: PDFDocumentProxy | null;
  numPages: number;
  isReady: boolean;
  error: Error | null;
  /** Re-runs loading, optionally with a new source. */
  reload: (src?: PdfSource) => void;
}

const DEFAULT_CMAP_URL = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/cmaps/`;
const DEFAULT_STANDARD_FONT_URL = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/standard_fonts/`;

export function usePdfDocument(options: UsePdfDocumentOptions): UsePdfDocumentResult {
  const { src, workerSrc, onPasswordRequired, cMapUrl, standardFontUrl } = options;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const srcRef = useRef(src);
  srcRef.current = src;

  // Callbacks are held in refs: an inline arrow from the host component gets a
  // new identity every render, which would otherwise tear down and restart the
  // document load on each parent re-render.
  const onPasswordRequiredRef = useRef(onPasswordRequired);
  onPasswordRequiredRef.current = onPasswordRequired;

  const reload = useCallback((nextSrc?: PdfSource) => {
    if (nextSrc !== undefined) srcRef.current = nextSrc;
    setDoc(null);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;

    setDoc(null);
    setError(null);

    (async () => {
      try {
        configureWorker(workerSrc);
        const normalized = await normalizeSource(srcRef.current);
        if (cancelled) return;

        task = getDocument({
          ...(normalized.kind === 'url' ? { url: normalized.url } : { data: normalized.data }),
          cMapUrl: cMapUrl ?? DEFAULT_CMAP_URL,
          cMapPacked: true,
          standardFontDataUrl: standardFontUrl ?? DEFAULT_STANDARD_FONT_URL,
        });

        task.onPassword = (submit: PasswordSubmit, reason: number) => {
          if (cancelled) return;
          onPasswordRequiredRef.current?.(
            submit,
            reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect-password' : 'need-password',
          );
        };

        const loaded = await task.promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        setDoc(loaded);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
    // src identity is tracked through srcRef so reload() with a new source re-runs this effect via nonce.
  }, [workerSrc, cMapUrl, standardFontUrl, nonce]);

  return { doc, numPages: doc?.numPages ?? 0, isReady: doc !== null, error, reload };
}
