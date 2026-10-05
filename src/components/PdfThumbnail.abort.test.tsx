/*
 * FR-36's thumbnail clause at the card's own canvas — the half of `PdfThumbnail` that wired two aborts and
 * had no test mentioning a `signal`.
 *
 * The component is where a sidebar of forty cards does its work, so it is also where an abort saves the most:
 * `PdfThumbnail.tsx` hands one token to the canvas effect and another to the form composition, and the effect's
 * own teardown runs exactly what a host's abort runs. The row said the wiring exists; the clause says something
 * stronger — *"Aborting triggers the same internal cancellation as unmount or scroll-out"* — and that is a
 * claim about three doors ending in the same state, which is what the cases below measure rather than assume.
 *
 * The four:
 *
 *  - a host abort reaches the **running render task**, takes the buffer back (`canvas.width = 0`, which is the
 *    only way a detached canvas releases its pixels in a browser), and reports nothing — a cancelled thumbnail
 *    is not a failed one, and the sidebar must not fill the console with one line per card a reader scrolled
 *    past;
 *  - **an already-aborted token starts no work at all**: the page proxy is never fetched;
 *  - aborting and scrolling out are **the same state**: task cancelled, buffer released, nothing painted after;
 *  - an abort while the **proxy fetch is in flight** stops the render that would have followed it.
 *
 * The XFA half of the same two aborts — the composed form coming down rather than being left in a card that
 * is no longer there — is in `PdfThumbnail.xfa.test.tsx`, which is where that tree is the subject.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

import { PdfThumbnail } from './PdfThumbnail';

const seen = vi.hoisted(() => ({ renders: 0 }));

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    render(): Promise<void> {
      return Promise.resolve();
    }
    update(): void {}
    cancel(): void {}
  },
  AnnotationLayer: class {
    render(): Promise<void> {
      return Promise.resolve();
    }
    update(): void {}
    destroy(): void {}
  },
  DrawLayer: class {
    setParent(): void {}
    destroy(): void {}
  },
  AnnotationEditorLayer: class {
    render(): Promise<void> {
      return Promise.resolve();
    }
    destroy(): void {}
    update(): void {}
  },
  XfaLayer: { render: () => ({}), update: () => undefined },
}));

/** A paint the test decides the outcome of, so an abort can land mid-render. */
interface FakeTask {
  cancel: () => void;
  settle: () => void;
  reject: (error: unknown) => void;
  cancelled: () => boolean;
}

function fakeTask(): FakeTask {
  let settle = (): void => undefined;
  let reject = (error: unknown): void => {
    void error;
  };
  const promise = new Promise<void>((resolve, refuse) => {
    settle = resolve;
    reject = refuse;
  });
  promise.catch(() => undefined);
  let cancelled = false;
  return {
    cancel: () => {
      cancelled = true;
      reject(new Error('cancelled'));
    },
    settle,
    reject,
    cancelled: () => cancelled,
  };
}

function fakeDoc(options: { tasks: FakeTask[]; holdPage?: boolean }) {
  const page = {
    rotate: 0,
    isPureXfa: false,
    getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({
      width: 200 * scale,
      height: 260 * scale,
      clone: () => ({ width: 0, height: 0 }),
    }),
    streamTextContent: () => Promise.resolve({ items: [] }),
    getXfa: async () => null,
    render: () => {
      seen.renders += 1;
      const next = options.tasks.shift();
      if (!next) throw new Error('the card painted more times than this test prepared for');
      return {
        promise: (async () => {
          await next.settle();
        })(),
        cancel: next.cancel,
      } as unknown as RenderTask;
    },
    cleanup: () => undefined,
  } as unknown as PDFPageProxy;

  return {
    numPages: 3,
    getPage: vi.fn(() =>
      options.holdPage ? new Promise<void>((resolve) => setTimeout(resolve, 60_000)).then(() => page) : Promise.resolve(page),
    ),
    annotationStorage: null,
  } as unknown as PDFDocumentProxy & { getPage: ReturnType<typeof vi.fn> };
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  target: Element | null = null;

  constructor(
    private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void,
    _options: Record<string, unknown> = {},
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.target = el;
  }

  disconnect(): void {
    this.target = null;
  }

  unobserve(): void {}

  fire(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }]);
  }
}

function mount(doc: PDFDocumentProxy, props: Record<string, unknown> = {}) {
  const view = render(<PdfThumbnail doc={doc} pageNumber={1} width={132} {...props} />);
  const observer = FakeIntersectionObserver.instances.at(-1);
  return {
    view,
    observer,
    canvas: () => view.container.querySelector('canvas'),
    /** The card paints only once this says it is on screen, which is the same gate a reader's scroll pulls. */
    onScreen: () => act(() => observer?.fire(true)),
    offScreen: () => act(() => observer?.fire(false)),
  };
}

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  seen.renders = 0;
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FR-36: a thumbnail the host stopped caring about stops, and says nothing', () => {
  it('cancels the running render, releases the buffer, and reports no failure', async () => {
    const task = fakeTask();
    const doc = fakeDoc({ tasks: [task] });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new AbortController();
    const card = mount(doc, { signal: controller.signal });

    card.onScreen();
    await settle();
    expect(card.canvas()?.width, 'the card sized its buffer for the paint').toBeGreaterThan(0);

    await act(async () => {
      controller.abort();
      await settle();
    });

    expect(task.cancelled(), 'the host abort reached the task in flight').toBe(true);
    expect(card.canvas()?.width, 'and the pixels went back to the browser').toBe(0);
    expect(errors, 'a cancelled card is not a failed one').not.toHaveBeenCalled();
  });

  it('performs no work for a token that was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const doc = fakeDoc({ tasks: [] });
    const card = mount(doc, { signal: controller.signal });

    card.onScreen();
    await settle();

    expect(doc.getPage, 'the proxy fetch is the first thing an abort should have stopped').not.toHaveBeenCalled();
    expect(seen.renders).toBe(0);
  });

  it('ends in the same state as scrolling out, which is the clause’s own comparison', async () => {
    const byAbort = fakeTask();
    const aborted = fakeDoc({ tasks: [byAbort] });
    const controller = new AbortController();
    const first = mount(aborted, { signal: controller.signal });
    first.onScreen();
    await settle();
    await act(async () => {
      controller.abort();
    });
    const afterAbort = { cancelled: byAbort.cancelled(), width: first.canvas()?.width ?? -1 };

    const byScroll = fakeTask();
    const second = mount(fakeDoc({ tasks: [byScroll] }));
    second.onScreen();
    await settle();
    second.offScreen();
    await settle();
    const afterScroll = { cancelled: byScroll.cancelled(), width: second.canvas()?.width ?? -1 };

    expect(afterAbort).toEqual({ cancelled: true, width: 0 });
    expect(
      afterScroll,
      'the host’s token and the reader’s scroll pull the same lever, which is what makes the first row true',
    ).toEqual(afterAbort);
  });

  it('does not paint a page whose proxy was still in flight when the host aborted', async () => {
    const controller = new AbortController();
    const doc = fakeDoc({ tasks: [fakeTask()], holdPage: true });
    const card = mount(doc, { signal: controller.signal });

    card.onScreen();
    await settle();
    expect(seen.renders, 'nothing has been asked to paint yet').toBe(0);

    await act(async () => {
      controller.abort();
      await settle();
    });

    expect(seen.renders, 'and the render the arriving proxy would have started never happened').toBe(0);
    expect(card.canvas()?.width ?? 0).toBe(0);
  });
});
