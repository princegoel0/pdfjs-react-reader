import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  PasswordResponses,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import { normalizeSource, type PdfSource } from '../lib/source';
import { pdfAssetUrls, type AssetUrl } from '../lib/assets';
import {
  createPdfWorker,
  ensureWorker,
  workerAutoDetectionFailed,
  type OwnedPdfWorker,
} from '../lib/worker';

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
  /**
   * Root of the pdf.js support assets (cMaps, standard fonts, wasm). `'cdn'`
   * (the default) uses unpkg pinned to the engine version; any other string is
   * a root you serve yourself, such as `'/pdfjs-dist/'`.
   */
  assetUrl?: AssetUrl;
  /** Base URL for CMap files. Overrides the `cMapUrl` derived from `assetUrl`. */
  cMapUrl?: string;
  /** Base URL for standard font files. Overrides the `standardFontDataUrl` derived from `assetUrl`. */
  standardFontUrl?: string;
  /**
   * URLs the document may be loaded from: URL prefixes, bare origins, or
   * same-origin paths (`['/files/', 'https://cdn.example.com']`). Byte inputs
   * are always accepted. Unset means no restriction. Read when a load starts, so
   * changing it does not reload an already-open document.
   */
  allowedSources?: readonly string[];
  /**
   * Render XFA forms. Defaults to true, which is what pdf.js's own viewer does;
   * a dynamic XFA document has no page content of its own, so turning this off
   * leaves those documents blank rather than safe.
   */
  enableXfa?: boolean;
}

/**
 * What the opened document actually is, so a host app can say "fill it in
 * somewhere else" instead of discovering it on a blank page.
 *
 * `form` and `hasJSActions` come from the document's own declarations, so they
 * are true even with `enableXfa` off. `renderedFromXfa` is the answer to a
 * different question: whether the pages on screen were composed from the XFA
 * template rather than from the PDF's content streams, which also means text
 * selection and search run over the rendered form.
 */
export interface PdfCapabilities {
  form: 'none' | 'acroform' | 'xfa' | 'mixed';
  renderedFromXfa: boolean;
  hasJSActions: boolean;
}

export interface UsePdfDocumentResult {
  doc: PDFDocumentProxy | null;
  numPages: number;
  isReady: boolean;
  error: Error | null;
  /** Null until the document is open. */
  capabilities: PdfCapabilities | null;
  /** Re-runs loading, optionally with a new source. */
  reload: (src?: PdfSource) => void;
}

/** What the viewer can and cannot do with this document once it is open. */
async function reportCapabilities(doc: PDFDocumentProxy): Promise<PdfCapabilities> {
  const { info } = await doc.getMetadata();
  const declared = info as { IsAcroFormPresent?: boolean; IsXFAPresent?: boolean };
  const { IsAcroFormPresent: acro, IsXFAPresent: xfa } = declared;
  const form: PdfCapabilities['form'] =
    xfa && acro ? 'mixed' : xfa ? 'xfa' : acro ? 'acroform' : 'none';
  return {
    form,
    renderedFromXfa: doc.isPureXfa,
    hasJSActions: await doc.hasJSActions().catch(() => false),
  };
}

export function usePdfDocument(options: UsePdfDocumentOptions): UsePdfDocumentResult {
  const {
    src,
    workerSrc,
    onPasswordRequired,
    assetUrl,
    cMapUrl,
    standardFontUrl,
    allowedSources,
    enableXfa,
  } = options;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [capabilities, setCapabilities] = useState<PdfCapabilities | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const srcRef = useRef(src);
  srcRef.current = src;

  // Callbacks are held in refs: an inline arrow from the host component gets a
  // new identity every render, which would otherwise tear down and restart the
  // document load on each parent re-render.
  const onPasswordRequiredRef = useRef(onPasswordRequired);
  onPasswordRequiredRef.current = onPasswordRequired;

  // Same reason, and the policy is only consulted when a load starts.
  const allowedSourcesRef = useRef(allowedSources);
  allowedSourcesRef.current = allowedSources;

  const reload = useCallback((nextSrc?: PdfSource) => {
    if (nextSrc !== undefined) srcRef.current = nextSrc;
    setDoc(null);
    setCapabilities(null);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let owned: OwnedPdfWorker | null = null;

    setDoc(null);
    setCapabilities(null);
    setError(null);

    (async () => {
      try {
        await ensureWorker(workerSrc);
        const normalized = await normalizeSource(srcRef.current, {
          allowedSources: allowedSourcesRef.current,
        });
        if (cancelled) return;

        // Null unless the app opted into Trusted Types, in which case pdf.js
        // would otherwise be unable to start a worker at all.
        owned = await createPdfWorker(workerSrc);
        const assets = pdfAssetUrls(assetUrl);
        task = getDocument({
          ...(owned ? { worker: owned.worker } : null),
          ...(normalized.kind === 'url' ? { url: normalized.url } : { data: normalized.data }),
          cMapUrl: cMapUrl ?? assets.cMapUrl,
          cMapPacked: true,
          standardFontDataUrl: standardFontUrl ?? assets.standardFontDataUrl,
          wasmUrl: assets.wasmUrl,
          enableXfa: enableXfa ?? true,
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
          void task.destroy().finally(() => owned?.dispose());
          return;
        }
        setDoc(loaded);
        // The document is on screen before this resolves: `hasJSActions` is a
        // round trip to the worker, and the answer changes nothing about the
        // first paint. A load superseded mid-flight rejects, which is not an error.
        void reportCapabilities(loaded)
          .then((next) => {
            if (!cancelled) setCapabilities(next);
          })
          .catch(() => undefined);
      } catch (err) {
        if (cancelled) return;
        const cause = err instanceof Error ? err : new Error(String(err));
        if (workerAutoDetectionFailed() && /worker/i.test(cause.message)) {
          cause.message +=
            ' — the pdf.js worker was not found automatically. Pin it with `workerSrc` ' +
            "(e.g. `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`).";
        }
        setError(cause);
      }
    })();

    return () => {
      cancelled = true;
      // A worker handed to `getDocument` is not owned by the loading task, so it
      // has to be released here or every reload leaks one.
      void task?.destroy().finally(() => owned?.dispose());
    };
    // src identity is tracked through srcRef so reload() with a new source re-runs this effect via nonce.
  }, [workerSrc, assetUrl, cMapUrl, standardFontUrl, nonce]);

  return {
    doc,
    numPages: doc?.numPages ?? 0,
    isReady: doc !== null,
    capabilities,
    error,
    reload,
  };
}
