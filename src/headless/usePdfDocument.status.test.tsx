/*
 * FR-37 on the load path: the §3.5 document model, as a value a host can branch on.
 *
 * The requirement's invariant — a status is never readable as `ready` while the document handle is null —
 * is built into `PdfDocumentLoad` rather than policed here, so most of what this file proves is the
 * weaker and more useful thing: the state a host sees is the state that happened, in order, including the
 * two that are easy to get backwards. A cancelled load must land on `destroyed` and must never have
 * passed through `error` (FR-04's rule restated as a state), and an encrypted document must park in
 * `password-required` carrying the submit that resolves it, because §5.1's example renders its credential
 * prompt from `status` alone and has no other way to answer.
 *
 * Values are recorded during render rather than after the effects flush, because `idle` only exists on the
 * render before the load starts — which is also exactly what a server render sees.
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordResponses, type PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfDocument } from './usePdfDocument';
import type { UsePdfDocumentOptions, UsePdfDocumentResult } from './usePdfDocument';
import type { PasswordSubmit } from '../lib/status';

const calls = vi.hoisted(() => vi.fn());

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDocument: (params: unknown) => calls(params),
}));

vi.mock('../lib/worker', () => ({
  ensureWorker: vi.fn(async () => undefined),
  createPdfWorker: vi.fn(async () => null),
  workerAutoDetectionFailed: () => false,
  // FR-02: the hook claims the realm's worker URL for the lifetime of a load. These tests
  // are about something else, and an empty configuration has nothing to claim and nothing to
  // conflict with.
  configuredWorkerSrc: () => '',
  claimWorkerSrc: () => ({ ok: true, release: () => {} }),
}));

const URL_SRC = 'https://files.example.com/contract.pdf';

/** The opened document, with as little of it as the hook reads. */
function opened(numPages = 2): PDFDocumentProxy {
  return {
    numPages,
    isPureXfa: false,
    getMetadata: async () => ({ info: {} }),
    hasJSActions: async () => false,
    destroy: async () => undefined,
  } as unknown as PDFDocumentProxy;
}

/** The loading task the hook fills in, so a test can drive `onPassword` the way the engine does. */
interface FakeTask {
  onPassword?: (submit: PasswordSubmit, reason: number) => void;
  /** The engine hands over `NaN` for `percent` when it does not know the total. */
  onProgress?: (report: { loaded: number; total: number; percent: number }) => void;
  promise: Promise<PDFDocumentProxy>;
  destroy: () => Promise<void>;
}

function Probe({
  options,
  onValue,
}: {
  options: UsePdfDocumentOptions;
  onValue: (value: UsePdfDocumentResult) => void;
}): null {
  onValue(usePdfDocument(options));
  return null;
}

/**
 * Renders the hook and keeps every value it ever rendered, so a test can assert on the sequence and not
 * only on the destination. Consecutive duplicates are dropped: React re-renders for reasons that have
 * nothing to do with the load, and a state that has not moved is not a transition.
 */
function track(options: UsePdfDocumentOptions) {
  const seen: UsePdfDocumentResult[] = [];
  const all: UsePdfDocumentResult[] = [];
  const record = (value: UsePdfDocumentResult) => {
    all.push(value);
    const previous = seen.at(-1);
    if (previous && previous.status === value.status && previous.doc === value.doc) return;
    seen.push(value);
  };
  render(<Probe options={options} onValue={record} />);
  return {
    seen,
    /**
     * Every render, undeduplicated. A state that carries something new inside the same status — a second
     * password request, say — is invisible in `seen`, which keys on the status and the handle alone.
     */
    all,
    latest(): UsePdfDocumentResult {
      const last = seen.at(-1);
      if (!last) throw new Error('usePdfDocument has not rendered yet');
      return last;
    },
    statuses: () => seen.map((value) => value.status),
  };
}

afterEach(() => {
  calls.mockReset();
});

describe('the document state model', () => {
  it('reads `idle` on the render before the load starts', () => {
    calls.mockImplementation(
      () => ({ promise: new Promise<PDFDocumentProxy>(() => undefined), destroy: () => Promise.resolve() }) satisfies FakeTask,
    );
    const viewer = track({ src: URL_SRC });

    // The state §3.5 calls "constructed, no load started" is the one a server render never leaves, so it
    // has a real observer even though the browser's effect follows in the same tick.
    expect(viewer.statuses()[0]).toBe('idle');
    expect(viewer.seen[0]?.doc).toBeNull();
    expect(viewer.seen[0]?.error).toBeNull();
    expect(viewer.seen[0]?.passwordRequest).toBeNull();
  });

  it('goes idle → loading → ready, and the handle arrives with the status that owns it', async () => {
    const doc = opened();
    calls.mockImplementation(() => ({ promise: Promise.resolve(doc), destroy: () => Promise.resolve() }) satisfies FakeTask);
    const viewer = track({ src: URL_SRC });

    await waitFor(() => expect(viewer.latest().status).toBe('ready'));
    expect(viewer.statuses().slice(0, 2)).toEqual(['idle', 'loading']);
    expect(viewer.latest().doc).toBe(doc);
    expect(viewer.latest().numPages).toBe(2);
    expect(viewer.latest().isReady).toBe(true);
    expect(viewer.latest().error).toBeNull();
  });

  it('never reads `ready` without a handle, nor a handle without `ready`', async () => {
    const doc = opened();
    calls.mockImplementation(() => ({ promise: Promise.resolve(doc), destroy: () => Promise.resolve() }) satisfies FakeTask);
    const viewer = track({ src: URL_SRC });
    await waitFor(() => expect(viewer.latest().status).toBe('ready'));

    // Every value the host ever held, including the ones in between. This loop is the assertion FR-37
    // asks for, and it passes because `usePdfDocument` derives the fields from one tagged value.
    for (const value of viewer.seen) {
      expect(value.status === 'ready').toBe(value.doc !== null);
      expect(value.isReady).toBe(value.status === 'ready');
      expect(value.status === 'error').toBe(value.error !== null);
      if (value.status !== 'password-required') expect(value.passwordRequest).toBeNull();
    }
  });

  it('carries the engine’s own message into `error`, with no document and no prompt', async () => {
    calls.mockImplementation(
      () =>
        ({
          promise: Promise.reject(new Error('Invalid PDF structure.')),
          destroy: () => Promise.resolve(),
        }) satisfies FakeTask,
    );
    const viewer = track({ src: URL_SRC });

    await waitFor(() => expect(viewer.latest().status).toBe('error'));
    expect(viewer.latest().error?.message).toBe('Invalid PDF structure.');
    expect(viewer.latest().doc).toBeNull();
    expect(viewer.latest().isReady).toBe(false);
    expect(viewer.statuses(), 'a rejected load is a failure, not a cancellation').not.toContain('destroyed');
  });

  it('parks in `password-required` with the reason, and answering it returns to `loading`', async () => {
    const task: FakeTask = { promise: new Promise(() => undefined), destroy: () => Promise.resolve() };
    calls.mockImplementation(() => task);
    const engineSubmit = vi.fn();
    const viewer = track({ src: URL_SRC });

    await waitFor(() => expect(task.onPassword).toBeTypeOf('function'));
    const ask = task.onPassword;
    if (!ask) throw new Error('the load never installed its password handler');

    act(() => ask(engineSubmit, PasswordResponses.NEED_PASSWORD));
    expect(viewer.latest().status).toBe('password-required');
    expect(viewer.latest().passwordRequest?.reason).toBe('need-password');
    expect(viewer.latest().doc).toBeNull();

    // The submit the state carries is the host's way out of the prompt it rendered from `status`, and
    // using it puts the load back to waiting instead of leaving the prompt standing.
    act(() => viewer.latest().passwordRequest?.submit('hunter2'));
    expect(engineSubmit).toHaveBeenCalledWith('hunter2');
    expect(viewer.latest().status).toBe('loading');
  });

  it('names a rejected credential as the re-prompt rather than a fresh request', async () => {
    const task: FakeTask = { promise: new Promise(() => undefined), destroy: () => Promise.resolve() };
    calls.mockImplementation(() => task);
    const viewer = track({ src: URL_SRC });

    await waitFor(() => expect(task.onPassword).toBeTypeOf('function'));
    act(() => task.onPassword?.(vi.fn(), PasswordResponses.INCORRECT_PASSWORD));
    expect(viewer.latest().passwordRequest?.reason).toBe('incorrect-password');
  });

  it('does not let an answer kept from the first request clear the second prompt', async () => {
    // Both asks are driven by hand here, so this tests *our* machine — one live request at a time.
    // `encrypted.reprompt.test.ts` is the one that proves the engine actually sends the second ask.
    const task: FakeTask = { promise: new Promise(() => undefined), destroy: () => Promise.resolve() };
    calls.mockImplementation(() => task);
    const viewer = track({ src: URL_SRC });

    await waitFor(() => expect(task.onPassword).toBeTypeOf('function'));
    const ask = task.onPassword;
    if (!ask) throw new Error('the load never installed its password handler');

    act(() => ask(vi.fn(), PasswordResponses.NEED_PASSWORD));
    const first = viewer.all.at(-1)?.passwordRequest;
    act(() => ask(vi.fn(), PasswordResponses.INCORRECT_PASSWORD));
    const second = viewer.all.at(-1)?.passwordRequest;
    expect(second?.reason).toBe('incorrect-password');
    expect(viewer.latest().status).toBe('password-required');

    // A host that stored the first submit — a ref, a modal that outlived its prompt — must not be able to
    // answer it once the engine has re-asked. Only the live request moves the state.
    act(() => first?.submit('stale'));
    expect(viewer.latest().status).toBe('password-required');
    expect(viewer.all.at(-1)?.passwordRequest).toBe(second);
    expect(viewer.all.at(-1)?.passwordRequest?.reason).toBe('incorrect-password');

    act(() => second?.submit('secret'));
    expect(viewer.latest().status).toBe('loading');
  });

  it('lands a host-cancelled load on `cancelled` and never routes it through `error`', async () => {
    calls.mockImplementation(
      () => ({ promise: new Promise<PDFDocumentProxy>(() => undefined), destroy: () => Promise.resolve() }) satisfies FakeTask,
    );
    const controller = new AbortController();
    const viewer = track({ src: URL_SRC, signal: controller.signal });
    await waitFor(() => expect(viewer.latest().status).toBe('loading'));

    act(() => controller.abort());
    // FR-37: `cancelled` is a state a host can observe, not just a rule about what is not written. Before
    // it existed, an abort left `destroyed` — true of the internal teardown but useless to a viewer still on
    // screen, which cannot tell "the reader stopped this" from "the component went away".
    expect(viewer.latest().status).toBe('cancelled');
    expect(viewer.statuses()).not.toContain('error');
    expect(viewer.statuses(), 'a cancellation is not a failure on the way to being terminal').not.toContain(
      'destroyed',
    );
    expect(viewer.latest().error).toBeNull();
    expect(viewer.latest().doc).toBeNull();
  });

  it('takes a document down and loads another without going back to `idle`', async () => {
    const first = opened(1);
    const second = opened(3);
    let started = 0;
    calls.mockImplementation(() => {
      started += 1;
      return { promise: Promise.resolve(started === 1 ? first : second), destroy: () => Promise.resolve() } satisfies FakeTask;
    });
    const viewer = track({ src: URL_SRC });
    await waitFor(() => expect(viewer.latest().doc).toBe(first));

    act(() => viewer.latest().reload());
    await waitFor(() => expect(viewer.latest().doc).toBe(second));

    expect(viewer.latest().status).toBe('ready');
    // `idle` is the state before the first load and only then; a reload is a supersede, which the model
    // spells `destroyed` → `loading` in the same commit, so the host is left watching the new load.
    expect(viewer.statuses().slice(1)).not.toContain('idle');
    expect(viewer.statuses()).toContain('loading');
    expect(viewer.statuses()).not.toContain('error');
  });

  it('leaves nothing of a torn-down load readable once the next one is running', async () => {
    const doc = opened();
    let started = 0;
    calls.mockImplementation(() => {
      started += 1;
      // The second load is held open so the intermediate state is stable to look at; a load that resolves
      // immediately would be `ready` again before the assertion ran.
      return started === 1
        ? { promise: Promise.resolve(doc), destroy: () => Promise.resolve() }
        : { promise: new Promise<PDFDocumentProxy>(() => undefined), destroy: () => Promise.resolve() };
    });
    const viewer = track({ src: URL_SRC });
    await waitFor(() => expect(viewer.latest().status).toBe('ready'));

    act(() => viewer.latest().reload());
    await waitFor(() => expect(viewer.latest().status).toBe('loading'));
    expect(viewer.latest().doc).toBeNull();
    expect(viewer.latest().capabilities).toBeNull();
    expect(viewer.latest().numPages).toBe(0);
    expect(viewer.latest().isReady).toBe(false);
    /*
     *  is a member of the published union, and until this line nothing proved a component can reach
     * it: the state appeared in the suite only inside  assertions, so deleting the branch that
     * writes it left every test green — the shape FR-37 calls "a defect in the model rather than an unused
     * branch". A supersede is its reachable path. An unmount runs the same teardown, and a state written to a
     * component that is going away has no reader, which is the difference the next test holds.
     */
    /*
     * Measured here rather than asserted: the supersede writes  and  in one commit, so the
     * sequence a host can read never holds the word. That is the deliberate design the test above names (a
     * reload leaves the host watching the new load, not a flash of an emptied viewer) — and it is why FR-37
     * keeps its gap: the member is written by two paths, an unmount that has no reader left and a
     * supersede that is coalesced away, so nothing a host can observe is ever . See the register
     * row and ; the assertion that would pin it down needs a decision about the surface, not a test.
     */
    expect(
      viewer.statuses(),
      'destroyed is written and never rendered — if that ever changes, this line is the one to look at',
    ).not.toContain('destroyed');
    expect(viewer.statuses(), 'and it came down, it did not fail').not.toContain('error');
    expect(viewer.statuses(), 'and nobody cancelled it').not.toContain('cancelled');
  });

  it('releases the engine task on unmount without telling anyone, which is why the state above needed the supersede', async () => {
    const destroy = vi.fn(() => Promise.resolve());
    const task: FakeTask = { promise: new Promise(() => undefined), destroy };
    calls.mockImplementation(() => task);
    const seen: string[] = [];
    const view = render(
      <Probe
        options={{ src: URL_SRC }}
        onValue={(value) => {
          if (seen.at(-1) !== value.status) seen.push(value.status);
        }}
      />,
    );
    await waitFor(() => expect(calls).toHaveBeenCalled());

    act(() => view.unmount());
    await waitFor(() => expect(destroy).toHaveBeenCalled());
    // The teardown ran, which is the observable half of an unmount. What it wrote —  — never
    // reaches a host, and must not arrive as : that word is reserved for a reader who is still
    // looking at a viewer and stopped something.
    expect(seen, 'no error surfaced on the way out').not.toContain('error');
    expect(seen, 'an unmount is not a cancellation the host asked for').not.toContain('cancelled');
  });
});

describe('what §3.5 says the `loading` state must carry', () => {
  /** A load that never settles, with the engine's progress handler left for the test to fire. */
  function loadInFlight() {
    const task: FakeTask = { promise: new Promise(() => undefined), destroy: () => Promise.resolve() };
    calls.mockImplementation(() => task);
    return task;
  }

  it('reports bytes as they arrive, in the shape a bar binds to', async () => {
    const task = loadInFlight();
    const onProgress = vi.fn();
    track({ src: URL_SRC, onProgress });
    await waitFor(() => expect(task.onProgress).toBeTypeOf('function'));

    act(() => task.onProgress?.({ loaded: 500, total: 1000, percent: 50 }));
    expect(onProgress).toHaveBeenCalledWith({ loaded: 500, total: 1000, percent: 50 });
  });

  it('reports no percentage rather than the engine’s NaN', async () => {
    const task = loadInFlight();
    const onProgress = vi.fn();
    track({ src: URL_SRC, onProgress });
    await waitFor(() => expect(task.onProgress).toBeTypeOf('function'));

    // A chunked or gzipped response says nothing about its length, and pdf.js puts `NaN` in the field.
    // `style={{ width: `${NaN}%` }}` is not an empty bar, it is no bar at all, so null is the honest value.
    act(() => task.onProgress?.({ loaded: 4_096, total: 0, percent: Number.NaN }));
    expect(onProgress).toHaveBeenCalledWith({ loaded: 4_096, total: 0, percent: null });
  });

  it('does not restart the load for an inline `onProgress` arrow', async () => {
    loadInFlight();
    const view = render(
      <Probe options={{ src: URL_SRC, onProgress: () => undefined }} onValue={() => undefined} />,
    );
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1));

    // The FR-34 trap a third time: `onProgress: (p) => setBytes(p.loaded)` is the natural thing to write,
    // and watched, it would reload the document on every render — and there would be a render per report.
    view.rerender(
      <Probe options={{ src: URL_SRC, onProgress: () => undefined }} onValue={() => undefined} />,
    );
    await act(async () => undefined);
    expect(calls, 'progress is a subscription, not a dependency').toHaveBeenCalledTimes(1);
  });

  it('stops reporting once the host has cancelled', async () => {
    const task = loadInFlight();
    const onProgress = vi.fn();
    const controller = new AbortController();
    track({ src: URL_SRC, onProgress, signal: controller.signal });
    await waitFor(() => expect(task.onProgress).toBeTypeOf('function'));

    act(() => controller.abort());
    onProgress.mockClear();
    // A reader that has stopped the load does not want a bar that keeps moving over a dead request.
    act(() => task.onProgress?.({ loaded: 900, total: 1000, percent: 90 }));
    expect(onProgress).not.toHaveBeenCalled();
  });
});
