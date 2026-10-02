/*
 * FR-36: one way for a host to say "stop", and for us to say the same thing to ourselves.
 *
 * The package already cancels well — a `cancelled` flag closed over by each effect's cleanup, `task.cancel()`
 * on the engine's render, `RenderingCancelledException` swallowed by name. What it did not have was a handle
 * a host could pull from outside that machinery, which meant that cancelling a load needed an unmount, and
 * cancelling a forty-page text index needed the component to go away.
 *
 * So a host signal never replaces the internal cancellation — it *triggers* it. Aborting runs the same
 * teardown an unmount or a scroll-out would run, and the result is reported as a cancellation, never as an
 * error. That is what keeps FR-04's promise true for a stop the host initiated as well as our own.
 *
 * Each effect owns a cancellation of its own lifetime: the page-proxy fetch stops when the page number
 * changes, the canvas render when the scale does, and all of them when the component goes away. So every
 * site subscribes to the host signal and calls its own teardown, rather than sharing one composed signal
 * across the component — that would have made a scale change look like the whole page was abandoned. It is
 * also why there is no `composeAbort` here: nothing in the package needs two signals merged into one, and a
 * helper only its own tests call is surface area, not a feature.
 *
 * Worth recording while it is fresh: `AbortSignal.any` is Chrome 116, Safari 17.4 and Firefox 124. When this
 * module was written the advertised floors were Chrome 90 / Safari 14 / Firefox 90, so avoiding it was a
 * compatibility requirement. The 2026-10-02 lock raised the floors *past* it — and pdf.js 6.0 requires it
 * natively — so nothing here is a compatibility constraint any more. The guard in `abort.test.ts` still
 * forbids the call, and task #203 decides whether it stays for a different stated reason or comes out; until
 * it does, compose signals by hand, as `onAbort` below does.
 */

import type { PdfErrorCode } from './errors';
import { PdfError } from './errors';

/** The name we put on a cancellation we caused, matching what the platform's own aborts carry. */
export const ABORT_ERROR_NAME = 'AbortError';

/**
 * A cancellation as a `PdfError` with a cancellation code — but keeping `name` as `AbortError`.
 *
 * The name is deliberately not `PdfError` here. Every engine check in this package, and a great many in
 * hosts, filter cancellations by `name === 'AbortError'`, and a cancelled render that started reaching error
 * handlers because the wrapper renamed it would be a regression dressed up as an improvement. The code is
 * what the host switches on; the name is what the platform's own idiom still recognises.
 */
export function abortError(
  message = 'The operation was aborted.',
  code: PdfErrorCode = 'LOAD_CANCELLED',
): PdfError {
  const error = new PdfError(code, message);
  error.name = ABORT_ERROR_NAME;
  return error;
}

/**
 * The error to raise for a signal that fired, carrying what the caller asked for.
 *
 * FR-04's clause: where the platform gives a reason, it survives. `signal.reason` is whatever
 * `controller.abort(reason)` was handed — an `Error` with a message the host wrote, a DOMException with
 * nothing useful in it, or a plain string. The first is the case worth keeping: a host that aborts with
 * "reader navigated away" should not have that turned back into our generic sentence.
 */
export function cancellationFrom(
  signal: AbortSignal | undefined,
  code: PdfErrorCode,
  fallbackMessage = 'The operation was aborted.',
): PdfError {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name !== ABORT_ERROR_NAME) {
    const error = new PdfError(code, reason.message, { cause: reason });
    error.name = ABORT_ERROR_NAME;
    return error;
  }
  if (typeof reason === 'string' && reason.trim()) {
    const error = new PdfError(code, reason);
    error.name = ABORT_ERROR_NAME;
    return error;
  }
  return abortError(fallbackMessage, code);
}

/** True when the caller asked us to stop. Distinct from `isCancellation`, which also covers the engine. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === ABORT_ERROR_NAME;
}

/**
 * Anything that means "this work was stopped, not that it failed": our own aborts, and the engine's
 * cancellation of a render or a superseded load. Every one of these is swallowed by a viewer that scrolls
 * fast, so a host's error surface stays free of the mechanism.
 */
export function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === ABORT_ERROR_NAME ||
    error.name === 'AbortException' ||
    error.name === 'RenderingCancelledException'
  );
}

/**
 * Run `handler` when `signal` fires — including a signal that already fired before we were asked to
 * listen, which is the case that turns a late subscription into work that never stops.
 *
 * Returns a disposer. Always call it from the same cleanup that stops the internal cancellation, or every
 * mount adds another listener to a long-lived signal.
 */
export function onAbort(signal: AbortSignal | undefined, handler: () => void): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    handler();
    return () => undefined;
  }
  signal.addEventListener('abort', handler, { once: true });
  return () => signal.removeEventListener('abort', handler);
}

/**
 * Throw an `AbortError` if the caller has already asked us to stop.
 *
 * For the synchronous loops — the writer's pass over pages and signature fields — where the only honest
 * cancellation is a check between iterations: it stops the *next* page being touched, and cannot un-make
 * a write already handed to the writer. Put the check before the loop and before the save, not just at
 * the top, or a caller who aborts at 90 % through a thousand pages still gets a file.
 */
export function throwIfAborted(
  signal: AbortSignal | undefined,
  message?: string,
  code: PdfErrorCode = 'LOAD_CANCELLED',
): void {
  if (signal?.aborted) throw cancellationFrom(signal, code, message ?? 'The operation was aborted.');
}
