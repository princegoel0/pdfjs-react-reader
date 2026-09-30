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
 * Worth recording while it is fresh: `AbortSignal.any` is Chrome 116, Safari 17.4 and Firefox 124, and
 * every one of those is past the floors `PRD.md` §8 advertises. No test in this repository could catch
 * using it, because every job we run is Node on Linux — which is the argument for FR-48, not against it.
 */

/** The name we put on a cancellation we caused, matching what the platform's own aborts carry. */
export const ABORT_ERROR_NAME = 'AbortError';

/** An `Error`, not a `DOMException`: the name is the contract, and this has to survive a realm hop. */
export function abortError(message = 'The operation was aborted.'): Error {
  const error = new Error(message);
  error.name = ABORT_ERROR_NAME;
  return error;
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
export function throwIfAborted(signal: AbortSignal | undefined, message?: string): void {
  if (signal?.aborted) throw abortError(message ?? 'The operation was aborted.');
}
