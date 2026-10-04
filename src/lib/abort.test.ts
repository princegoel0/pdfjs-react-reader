/*
 * FR-36's shared machinery.
 *
 * Two of these tests exist because of the failure modes that do not announce themselves: a late
 * subscription to an already-fired signal, and a disposer that is never called and so accumulates one
 * listener per mount on a signal the host keeps for the life of the page.
 *
 * A third test used to live here, grepping the module for `AbortSignal.any` on the stated ground that the
 * call was newer than every advertised floor. That was true when it was written (Chrome 116 against a floor
 * of 90) and false after the 2026-10-02 lock raised the floors past it, so §5.6's baseline rule made the
 * guard itself the defect and #203 removed it. The reason this package still composes by hand is in
 * `abort.ts`: each effect owns a cancellation of its own lifetime, and merging a host signal into one
 * composed signal would make a scale change look like the whole page was abandoned. That is a design rule,
 * and it has no business being enforced by a string search for a platform API.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ABORT_ERROR_NAME,
  abortError,
  isAbortError,
  isCancellation,
  onAbort,
  throwIfAborted,
} from './abort';

function controller() {
  return new AbortController();
}

describe('abortError', () => {
  it('carries the platform name, which is what every check in this package keys on', () => {
    const error = abortError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(ABORT_ERROR_NAME);
    expect(error.name).toBe('AbortError');
  });

  it('keeps a message a host can show', () => {
    expect(abortError('indexing stopped').message).toBe('indexing stopped');
  });
});

describe('isAbortError / isCancellation', () => {
  it('recognises our own abort', () => {
    expect(isAbortError(abortError())).toBe(true);
    const like = new Error('x');
    like.name = 'AbortError';
    expect(isAbortError(like)).toBe(true);
  });

  it('does not call a real failure an abort', () => {
    expect(isAbortError(new Error('network'))).toBe(false);
    expect(isCancellation(new Error('bad pdf'))).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
    expect(isCancellation('a string')).toBe(false);
  });

  it('treats the engine cancellations as cancellations, because that is what FR-04 promises', () => {
    for (const name of ['AbortException', 'RenderingCancelledException', 'AbortError']) {
      const error = new Error('stopped');
      error.name = name;
      expect(isCancellation(error), name).toBe(true);
    }
  });
});

describe('onAbort', () => {
  it('runs the handler when the signal fires', () => {
    const live = controller();
    const handler = vi.fn();
    onAbort(live.signal, handler);
    expect(handler).not.toHaveBeenCalled();
    live.abort();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs the handler immediately for a signal that already fired', () => {
    // The case that matters: a host aborts before the effect subscribes — a re-render after a cancel,
    // or a queue that never drains — and late subscription would otherwise start work nobody wants.
    // Aborted through the controller rather than by dispatching the event, because `aborted` is set by
    // the platform's abort algorithm and not by the event; a hand-dispatched event exercises the wrong path.
    const used = controller();
    used.abort();
    const handler = vi.fn();
    onAbort(used.signal, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is a no-op with no signal, so callers can pass undefined without a guard', () => {
    const handler = vi.fn();
    expect(onAbort(undefined, handler)).toBeTypeOf('function');
    expect(handler).not.toHaveBeenCalled();
  });

  it('detaches on dispose, so repeated mounts do not accumulate listeners', () => {
    const live = controller();
    const handler = vi.fn();
    const off = onAbort(live.signal, handler);
    off();
    live.abort();
    expect(handler, 'the disposer must actually unsubscribe').not.toHaveBeenCalled();
  });

  it('fires once, even if the host aborts twice', () => {
    const live = controller();
    const handler = vi.fn();
    onAbort(live.signal, handler);
    live.abort();
    live.abort();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('throwIfAborted', () => {
  it('does nothing without a signal, and nothing while it is live', async () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(controller().signal)).not.toThrow();
  });

  it('throws an AbortError once the caller has stopped', () => {
    const live = controller();
    live.abort();
    let caught: unknown;
    try {
      throwIfAborted(live.signal);
    } catch (error) {
      caught = error;
    }
    expect(caught, 'it must throw rather than return quietly').toBeInstanceOf(Error);
    expect(isAbortError(caught)).toBe(true);
  });

  it('carries a message that names the work, because a bare "aborted" in a log explains nothing', () => {
    const live = controller();
    live.abort();
    try {
      throwIfAborted(live.signal, 'Reordering pages was aborted.');
      expect.unreachable('it should have thrown');
    } catch (error) {
      expect((error as Error).message).toBe('Reordering pages was aborted.');
      expect((error as Error).name).toBe('AbortError');
    }
  });
});
