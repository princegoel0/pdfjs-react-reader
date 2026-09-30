import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  PasswordResponses,
  type OnProgressParameters,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import { normalizeSource, type PdfSource } from '../lib/source';
import { pdfAssetUrls, type AssetUrl } from '../lib/assets';
import { onAbort } from '../lib/abort';
import { backoffDelay, classifyLoadError, resolveAttempts } from '../lib/retry';
import type { RetryAttemptInfo, RetryPolicy } from '../lib/retry';
import type {
  PasswordReason,
  PasswordSubmit,
  PdfDocumentLoad,
  PdfDocumentStatus,
  PdfPasswordRequest,
} from '../lib/status';
import {
  createPdfWorker,
  ensureWorker,
  workerAutoDetectionFailed,
  type OwnedPdfWorker,
} from '../lib/worker';

export interface UsePdfDocumentOptions {
  src: PdfSource;
  /** Worker script location. Auto-detected when omitted; pdf.js falls back to its main-thread worker if resolution fails. */
  workerSrc?: string;
  /**
   * Called when the document is encrypted. Invoke the provided callback with the password to continue.
   *
   * This is the *event* channel; `passwordRequest` on the result is the same request as a *state*, for a
   * host that renders its prompt from `status`. Both carry the same submit function, and answering it
   * through either moves the load back to `loading`.
   *
   * It is called **again** with `incorrect-password` when the answer is wrong — the engine re-asks, so a
   * prompt has to be able to show itself a second time (FR-03). `PdfPasswordRequest.submit` says why the
   * answer should arrive from a person rather than from the callback itself.
   */
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
   * Request headers sent with the fetch for a URL source — an `Authorization`
   * bearer, a signed-URL query token, a tenant id. Forwarded to the engine
   * verbatim; never logged, and never echoed into an error message.
   *
   * Read when a load starts and **not** watched for identity, so passing an
   * inline literal (`httpHeaders={{ Authorization: token }}`) does not restart
   * the load on every render. Call `reload()` to load again with new headers.
   */
  httpHeaders?: Record<string, string>;
  /** Send cookies and HTTP auth for a cross-origin URL source. Also read at load start only. */
  withCredentials?: boolean;
  /** Bytes per range request. The engine's own default applies when omitted. */
  rangeChunkSize?: number;
  /** Fetch the whole file in one request instead of by byte range. */
  disableRange?: boolean;
  /** Turn off progressive streaming of the file as it arrives. */
  disableStream?: boolean;
  /**
   * Bytes as they arrive, so a host can show a real bar rather than a spinner that implies the first
   * attempt is still hanging. Reported by the engine for a URL source; for a byte source there is nothing
   * to stream and it does not fire.
   *
   * Held in a ref like the other callbacks, because an inline arrow must not restart the load. A retry
   * starts a new task, so progress restarts with it — which is the truth of what is on the wire.
   */
  onProgress?: (progress: PdfLoadProgress) => void;
  /**
   * Bounded retries for a load failure that can heal. Defaults to three attempts with full-jitter
   * exponential backoff; pass `false` to fail on the first error.
   *
   * Only genuinely transient failures are retried. A 401 or 403 is surfaced immediately and never
   * attempted again, because retrying a refused credential turns one denied request into several — and a
   * 404, a corrupt file and an encrypted document are permanent too. `src/lib/retry.ts` holds the
   * classification and the reasoning.
   */
  retry?: RetryPolicy | false;
  /**
   * Called before each retry wait, so a host can report "retrying (2 of 3)" rather than leaving a spinner
   * that implies the first attempt is still running. Held in a ref like the other callbacks, so an inline
   * arrow cannot restart the load.
   */
  onRetryAttempt?: (info: RetryAttemptInfo) => void;
  /**
   * Stop the load from outside. Aborting runs exactly what an unmount would — the task is destroyed, the
   * worker released, and nothing is reported as an error, because a cancellation is not a failure
   * (FR-04). A signal that has already fired prevents the load starting at all.
   *
   * Swapping the signal does not restart a load in progress; it only moves which signal we follow, so a
   * host may pass a fresh controller per render without the document reloading under it.
   */
  signal?: AbortSignal;
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

/**
 * One report of bytes arriving. `percent` is null when the response did not say how long the file is —
 * a chunked or gzipped body, which is common enough for a served PDF — rather than the `NaN` the engine
 * hands over in that case. A host binding a bar's width to a number should not have to know which
 * responses lie.
 */
export interface PdfLoadProgress {
  loaded: number;
  total: number;
  percent: number | null;
}

export interface UsePdfDocumentResult {
  /**
   * The load's place in the §3.5 state model, and the field to branch on.
   *
   * Every field below is read off the same tagged value this comes from, which is what makes the
   * requirement's invariant — a status is never `ready` while the handle is null — structural rather than
   * something to test.
   */
  status: PdfDocumentStatus;
  doc: PDFDocumentProxy | null;
  numPages: number;
  isReady: boolean;
  error: Error | null;
  /**
   * The pending credential request while `status` is `password-required`, and null in every other state.
   *
   * `onPasswordRequired` is the same information as an *event*; this is it as a *state*, which is what lets
   * a host render its own prompt from `status` alone, as `PRD.md` §5.1 shows. A host that has the callback
   * can ignore this; one that does not must not have to keep a copy of the submit function.
   */
  passwordRequest: PdfPasswordRequest | null;
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
    httpHeaders,
    withCredentials,
    rangeChunkSize,
    disableRange,
    disableStream,
    retry,
    onRetryAttempt,
    onProgress,
    signal,
    enableXfa,
  } = options;
  // One tagged value rather than three nullables: `status`, `doc`, `isReady`, `error` and the password
  // request are all read off it, so the state model of §3.5 and the fields cannot drift apart (FR-37).
  const [load, setLoad] = useState<PdfDocumentLoad>({ status: 'idle' });
  const [capabilities, setCapabilities] = useState<PdfCapabilities | null>(null);
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

  // The network options are ref-read for the same reason, and the object one
  // needs it most: `httpHeaders={{ Authorization: token }}` is a fresh literal
  // every render, so watching it would restart the load per keystroke of a
  // parent. A ref also means `reload()` after rotating a token picks the new one
  // up, where a closure captured at effect time would silently reuse the old.
  const networkRef = useRef({ httpHeaders, withCredentials, rangeChunkSize, disableRange, disableStream });
  networkRef.current = { httpHeaders, withCredentials, rangeChunkSize, disableRange, disableStream };

  // A ref for the same reason as the callbacks above: `retry` may be an inline
  // object and `onRetryAttempt` an inline arrow, and neither may restart a load.
  const retryRef = useRef({ retry, onRetryAttempt });
  retryRef.current = { retry, onRetryAttempt };

  // Progress is reported from inside the network reader, per chunk, so it is the callback most likely to
  // be written inline — and the one that would reload the document on every render if it were watched.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Set by the load effect to whatever its teardown currently is, so a host signal arriving after the
  // load started can stop it without the signal being a dependency of the load itself.
  const cancelRef = useRef<(() => void) | null>(null);

  const reload = useCallback((nextSrc?: PdfSource) => {
    if (nextSrc !== undefined) srcRef.current = nextSrc;
    setLoad({ status: 'loading' });
    setCapabilities(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let owned: OwnedPdfWorker | null = null;

    setLoad({ status: 'loading' });
    setCapabilities(null);

    (async () => {
      try {
        await ensureWorker(workerSrc);
        const normalized = await normalizeSource(srcRef.current, {
          allowedSources: allowedSourcesRef.current,
        });
        if (cancelled) return;

        const assets = pdfAssetUrls(assetUrl);
        const network = networkRef.current;
        const { retry: retryOption, onRetryAttempt: report } = retryRef.current;
        const policy = retryOption === false ? { attempts: 1 } : (retryOption ?? {});
        const attempts = resolveAttempts(policy);

        for (let attempt = 1; ; attempt++) {
          try {
            // A fresh worker per attempt. One that has just seen a failed load is
            // not known to be usable, and holding it across the wait would leak it
            // if the effect is cleaned up while we sleep.
            // Null unless the app opted into Trusted Types, in which case pdf.js
            // would otherwise be unable to start a worker at all.
            owned = await createPdfWorker(workerSrc);
            if (cancelled) return;
            task = getDocument({
              ...(owned ? { worker: owned.worker } : null),
              ...(normalized.kind === 'url' ? { url: normalized.url } : { data: normalized.data }),
              // Every one of these is a property of a fetch, so they are only
              // meaningful for a URL source. Passing them alongside `data` would be
              // harmless and misleading.
              ...(normalized.kind === 'url'
                ? {
                    ...(network.httpHeaders ? { httpHeaders: network.httpHeaders } : null),
                    ...(network.withCredentials !== undefined
                      ? { withCredentials: network.withCredentials }
                      : null),
                    ...(network.rangeChunkSize !== undefined
                      ? { rangeChunkSize: network.rangeChunkSize }
                      : null),
                    ...(network.disableRange !== undefined
                      ? { disableRange: network.disableRange }
                      : null),
                    ...(network.disableStream !== undefined
                      ? { disableStream: network.disableStream }
                      : null),
                  }
                : null),
              cMapUrl: cMapUrl ?? assets.cMapUrl,
              cMapPacked: true,
              standardFontDataUrl: standardFontUrl ?? assets.standardFontDataUrl,
              wasmUrl: assets.wasmUrl,
              enableXfa: enableXfa ?? true,
            });

            task.onProgress = (report: OnProgressParameters) => {
              if (cancelled) return;
              onProgressRef.current?.({
                loaded: report.loaded,
                total: report.total,
                // The engine's own `percent` is NaN when `total` is unknown, and a NaN reaching a host's
                // style attribute renders nothing at all rather than an empty bar.
                percent: Number.isFinite(report.percent) ? report.percent : null,
              });
            };

            task.onPassword = (submit: PasswordSubmit, reason: number) => {
              if (cancelled) return;
              const request: PdfPasswordRequest = {
                reason:
                  reason === PasswordResponses.INCORRECT_PASSWORD
                    ? 'incorrect-password'
                    : 'need-password',
                // Answering means the load is in flight again — on a wrong password the engine asks a
                // second time, and that arrives as a fresh request rather than a stuck one. Guarded on
                // *this* request still being the live one: a host that kept an earlier submit in its own
                // state could otherwise answer it after the engine had already re-asked, clearing the new
                // prompt and leaving the load waiting on a request nothing is showing.
                submit: (password) => {
                  setLoad((current) =>
                    current.status === 'password-required' && current.request === request
                      ? { status: 'loading' }
                      : current,
                  );
                  submit(password);
                },
              };
              setLoad({ status: 'password-required', request });
              onPasswordRequiredRef.current?.(request.submit, request.reason);
            };

            const loaded = await task.promise;
            if (cancelled) {
              void task.destroy().finally(() => owned?.dispose());
              return;
            }
            setLoad({ status: 'ready', doc: loaded });
            // The document is on screen before this resolves: `hasJSActions` is a
            // round trip to the worker, and the answer changes nothing about the
            // first paint. A load superseded mid-flight rejects, which is not an error.
            void reportCapabilities(loaded)
              .then((next) => {
                if (!cancelled) setCapabilities(next);
              })
              .catch(() => undefined);
            return;
          } catch (err) {
            if (cancelled) return;

            // Release this attempt before deciding anything about the next one, so
            // a retry never holds two workers and the cleanup function has nothing
            // stale left to dispose.
            const spentTask = task;
            const spentWorker = owned;
            task = null;
            owned = null;
            if (spentTask) {
              void spentTask
                .destroy()
                .catch(() => undefined)
                .finally(() => spentWorker?.dispose());
            } else {
              spentWorker?.dispose();
            }

            const verdict = classifyLoadError(err);
            // Anything not positively transient, and the last allowed attempt,
            // both fall through to the outer handler — which is where the failure
            // becomes the reader's problem rather than ours.
            if (!verdict.retry || attempt >= attempts) throw err;

            const delayMs = backoffDelay(attempt, policy);
            report?.({
              attempt,
              attempts,
              delayMs,
              status: verdict.status,
              reason: verdict.reason,
              error: err instanceof Error ? err : new Error(String(err)),
            });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            if (cancelled) return;
          }
        }
      } catch (err) {
        if (cancelled) return;
        const cause = err instanceof Error ? err : new Error(String(err));
        if (workerAutoDetectionFailed() && /worker/i.test(cause.message)) {
          cause.message +=
            ' — the pdf.js worker was not found automatically. Pin it with `workerSrc` ' +
            "(e.g. `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`).";
        }
        setLoad({ status: 'error', error: cause });
      }
    })();

    // The same teardown an unmount runs, published so the host-signal effect below can reach it. It has to
    // close over this effect's `cancelled`, `task` and `owned`, which nothing outside can see.
    const teardown = () => {
      cancelled = true;
      // §3.5: a superseded or cancelled load lands on `destroyed`, never on `error`. Writing the state here
      // rather than leaving the previous value in place is what makes a host-initiated stop observable —
      // an unmount has nobody left to tell, but an abort keeps the component mounted.
      setLoad({ status: 'destroyed' });
      // A worker handed to `getDocument` is not owned by the loading task, so it
      // has to be released here or every reload leaks one.
      void task?.destroy().finally(() => owned?.dispose());
    };
    cancelRef.current = teardown;

    return () => {
      cancelRef.current = null;
      teardown();
    };
    // src identity is tracked through srcRef so reload() with a new source re-runs this effect via nonce.
  }, [workerSrc, assetUrl, cMapUrl, standardFontUrl, nonce]);

  // Follow the host's signal without restarting the load on it. A signal is an owner's lifetime, not a
  // document property: swapping controllers must move which one we listen to, not tear down a document
  // the host never asked to reload — the same trap FR-34 found for an inline `httpHeaders`.
  useEffect(() => {
    if (!signal) return undefined;
    // Already aborted is not "about to abort": the load must not start at all, and reporting no error is
    // the point — a caller that cancelled has already stopped caring.
    if (signal.aborted) {
      cancelRef.current?.();
      return undefined;
    }
    return onAbort(signal, () => cancelRef.current?.());
  }, [signal]);

  // Every field below is read off `load`, so the status and the fields it summarizes are one value.
  const doc = load.status === 'ready' ? load.doc : null;

  return {
    status: load.status,
    doc,
    numPages: doc?.numPages ?? 0,
    isReady: doc !== null,
    capabilities,
    error: load.status === 'error' ? load.error : null,
    passwordRequest: load.status === 'password-required' ? load.request : null,
    reload,
  };
}
