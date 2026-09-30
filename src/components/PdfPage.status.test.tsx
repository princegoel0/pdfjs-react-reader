/*
 * FR-37 on the page path: the §3.5 page model, reported by the component that owns the work.
 *
 * `PdfPage` is the only thing in the package that knows whether a page has been painted, so it is the only
 * thing that can say so. Three of these cases are the point of the exercise and are the ones easy to get
 * backwards:
 *
 * - `rendered` is a *join*. §3.5 defines it as painted with its overlay layers laid out, so a canvas that
 *   finishes while the annotation layer is still fetching must not claim the page is done — and a page
 *   that builds no annotation layer must not wait for one that cannot arrive.
 * - A zoom releases the buffer and repaints it. That reads `released → rendering → rendered` and produces
 *   no `cancelled` (nothing was in flight when the teardown ran) and no `error` — which is FR-04's "a
 *   render cancelled by a zoom step is not reported as a failure", now observable without a browser.
 * - A cancellation is two facts in order: the render stopped (`cancelled`) and the buffer went back to
 *   the browser (`released`). Reporting only the first would lose what the virtualizer depends on.
 *
 * `unrequested` is deliberately never reported, and that is a claim rather than an omission: a page the
 * virtualizer has not asked for is not mounted to say anything, and `virtualSlots` is what names it.
 *
 * The document, the page proxy and the link service are created once per test and reused across re-renders,
 * because their identity is what the effects key on: rebuilding them in the component body would re-run
 * the fetch and the paint, and the assertions would be measuring the harness.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderingCancelledException, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';
import type { PdfPageStatus } from '../lib/status';

/** The layer passes, each handed back so a test decides the order they settle in. */
const layerRenders = vi.hoisted(() => ({
  text: [] as Array<() => void>,
  annotations: [] as Array<() => void>,
}));

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    render(): Promise<void> {
      return new Promise((resolve) => layerRenders.text.push(resolve));
    }
    update(): void {}
    cancel(): void {}
  },
  AnnotationLayer: class {
    render(): Promise<void> {
      return new Promise((resolve) => layerRenders.annotations.push(resolve));
    }
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
  },
  XfaLayer: { render: () => ({}), update: () => undefined },
}));

/** A render task the test settles by hand. */
interface FakeTask {
  promise: Promise<void>;
  cancel: () => void;
  settle: () => void;
  /** `unknown` because the engine's own cancellation is a `BaseException`, which is not an `Error`. */
  fail: (error: unknown) => void;
}

function fakeRenderTask(): FakeTask {
  let settle = (): void => undefined;
  let fail = (error: unknown): void => {
    void error;
  };
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = (error: unknown) => reject(error);
  });
  // A task this file never rejects must not surface as an unhandled rejection either: the component
  // always attaches its own handler, and a bare promise in a test does not.
  promise.catch(() => undefined);
  return { promise, cancel: vi.fn(), settle, fail };
}

/**
 * A page proxy that hands out one prepared task per paint, so a zoom can be given the task it will
 * actually run. Painting more times than the test planned for fails loudly rather than silently.
 *
 * `getViewport` returns a *fresh* object for every scale, as the real `PageViewport` does: the render
 * effect keys on the viewport's identity, so a fake that handed back one shared object would make a zoom
 * a no-op and every "repaint on a scale change" assertion below would pass for the wrong reason.
 */
function fakePage(tasks: FakeTask[]): PDFPageProxy {
  const viewportFor = (scale: number) => {
    const box = { width: 200 * scale, height: 260 * scale };
    return { ...box, clone: () => ({ ...box }) };
  };
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    getViewport: ({ scale = 1 }: { scale?: number }) => viewportFor(scale),
    render: () => {
      const next = tasks.shift();
      if (!next) throw new Error('the page painted more times than this test prepared for');
      return next;
    },
    streamTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: async () => [],
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

function fakeDoc(page: PDFPageProxy | null): PDFDocumentProxy {
  return {
    getPage: async () => {
      if (!page) throw new Error('Page 3 is not in this document.');
      return page;
    },
  } as unknown as PDFDocumentProxy;
}

function mountPage(
  page: PDFPageProxy | null,
  options: {
    signal?: AbortSignal;
    onError?: (error: Error) => void;
    /** The annotation layer is only built for a page that has somewhere to send its links. */
    withLinkService?: boolean;
    /** Set when the test is playing the part of a host that owns the density. */
    devicePixelRatio?: number;
  } = {},
) {
  const reported: PdfPageStatus[] = [];
  const pages: number[] = [];
  const record = (pageNumber: number, status: PdfPageStatus) => {
    pages.push(pageNumber);
    if (reported.at(-1) !== status) reported.push(status);
  };
  const doc = fakeDoc(page);
  const linkService = createPdfLinkService();
  const element = (scale: number, onChange: (pageNumber: number, status: PdfPageStatus) => void) => (
    <PdfPage
      doc={doc}
      pageNumber={3}
      scale={scale}
      onStatusChange={onChange}
      {...(options.withLinkService === false ? null : { linkService })}
      {...(options.signal ? { signal: options.signal } : null)}
      {...(options.onError ? { onError: options.onError } : null)}
      {...(options.devicePixelRatio ? { devicePixelRatio: options.devicePixelRatio } : null)}
    />
  );
  const view: RenderResult = render(element(1, record));
  return {
    reported,
    pages,
    view,
    /** Re-renders at a new scale, optionally with a *fresh* callback, which is what a host does inline. */
    rerender: (scale: number, onChange: (pageNumber: number, status: PdfPageStatus) => void = record) =>
      view.rerender(element(scale, onChange)),
  };
}

/**
 * Settles the canvas and the layers the page opened.
 *
 * Three rounds rather than one pass because the annotation layer only reaches its `render()` a microtask
 * after its effect body — it awaits `getAnnotations()` first — so a single sweep can run ahead of the pass
 * it means to close. Settling a task or resolving a layer twice is a no-op, so the extra rounds are safe
 * and the assertion is about the page, not about the scheduler.
 */
async function paint(task: FakeTask) {
  for (let round = 0; round < 3; round++) {
    await act(async () => undefined);
    act(() => task.settle());
    act(() => {
      layerRenders.text.forEach((done) => done());
      layerRenders.annotations.forEach((done) => done());
    });
  }
  await act(async () => undefined);
}

afterEach(() => {
  cleanup();
  layerRenders.text = [];
  layerRenders.annotations = [];
  setDevicePixelRatio(1);
});

/**
 * Move the display the density watcher reads. jsdom's `matchMedia` answers every query with
 * `matches: false`, which is also what an engine without the `resolution` feature does, so in this file the
 * hub takes its `resize` channel and a test changes the number and dispatches one event. The query channel —
 * what Chrome and Safari 16+ actually take — is driven in `src/lib/dpr.test.ts`.
 */
function setDevicePixelRatio(ratio: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: ratio });
  expect(globalThis.devicePixelRatio).toBe(ratio);
}

function moveDisplay(ratio: number): void {
  setDevicePixelRatio(ratio);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('the page state model', () => {
  it('joins the canvas and the layers it built before it says `rendered`', async () => {
    const task = fakeRenderTask();
    const { reported, pages } = mountPage(fakePage([task]));

    // The proxy fetch is the first thing asked for, so the page is queued before it is rendering.
    await waitFor(() => expect(reported).toEqual(['queued', 'rendering']));
    act(() => task.settle());
    await act(async () => undefined);
    expect(reported.at(-1), 'a painted canvas is not a finished page').not.toBe('rendered');

    act(() => layerRenders.text.forEach((done) => done()));
    await act(async () => undefined);
    expect(reported.at(-1), 'the annotation layer is still being rendered').not.toBe('rendered');

    act(() => layerRenders.annotations.forEach((done) => done()));
    await act(async () => undefined);
    expect(reported.at(-1)).toBe('rendered');
    expect(reported).not.toContain('error');
    // Every report carries the page it belongs to, which is what lets one handler track a whole document
    // instead of a closure per page — the shape `onBaseDimensions` already uses.
    expect(pages).toHaveLength(reported.length);
    expect(new Set(pages)).toEqual(new Set([3]));
  });

  it('never reports `unrequested`, which is what the slots say a page is', async () => {
    const task = fakeRenderTask();
    const { reported } = mountPage(fakePage([task]));
    await paint(task);
    expect(reported).not.toContain('unrequested');
  });

  it('says `rendered` for a page that builds no annotation layer, rather than waiting for one', async () => {
    const task = fakeRenderTask();
    const { reported } = mountPage(fakePage([task]), { withLinkService: false });
    await waitFor(() => expect(reported).toContain('rendering'));

    act(() => task.settle());
    act(() => layerRenders.text.forEach((done) => done()));
    await act(async () => undefined);
    // No link service means the annotation effect early-returns and never opens its pass, so the join is
    // over the work this page actually started.
    expect(reported.at(-1)).toBe('rendered');
    expect(layerRenders.annotations).toHaveLength(0);
  });

  it('repaints on a zoom as released → rendering → rendered, with no cancellation and no error', async () => {
    const first = fakeRenderTask();
    const second = fakeRenderTask();
    const { reported, rerender } = mountPage(fakePage([first, second]));
    await paint(first);
    expect(reported.at(-1)).toBe('rendered');

    // A scale change tears the canvas down and runs it again — the same teardown a scroll-out runs, with
    // nothing in flight when it does.
    rerender(2);
    await waitFor(() => expect(reported.at(-1)).toBe('rendering'));
    await paint(second);

    expect(reported.slice(reported.indexOf('rendered'))).toEqual([
      'rendered',
      'released',
      'rendering',
      'rendered',
    ]);
    expect(reported).not.toContain('cancelled');
    expect(reported).not.toContain('error');
  });

  it('reports `cancelled` then `released` when a render in flight is torn down', async () => {
    const task = fakeRenderTask();
    const { reported, view } = mountPage(fakePage([task]));
    await waitFor(() => expect(reported).toContain('rendering'));

    view.unmount();
    expect(reported.slice(reported.indexOf('rendering'))).toEqual(['rendering', 'cancelled', 'released']);
    expect(reported).not.toContain('error');
  });

  it('reports the same pair when the host aborts, and calls no error handler', async () => {
    const task = fakeRenderTask();
    const controller = new AbortController();
    const onError = vi.fn();
    const { reported } = mountPage(fakePage([task]), { signal: controller.signal, onError });
    await waitFor(() => expect(reported).toContain('rendering'));

    act(() => controller.abort());
    await act(async () => {
      // The engine's own cancellation rejection must not turn into a page error (FR-04 again).
      task.fail(new RenderingCancelledException('The rendering operation was cancelled.'));
    });

    expect(reported.slice(reported.indexOf('rendering'))).toEqual(['rendering', 'cancelled', 'released']);
    expect(task.cancel).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports `error` for a render that genuinely failed, and does not call it `rendered` for that cycle', async () => {
    const failed = fakeRenderTask();
    const retry = fakeRenderTask();
    const onError = vi.fn();
    const { reported, rerender } = mountPage(fakePage([failed, retry]), { onError });
    await waitFor(() => expect(reported).toContain('rendering'));

    await act(async () => {
      failed.fail(new Error('The page is too large to paint.'));
    });
    expect(reported.at(-1)).toBe('error');
    expect(reported, 'a page with a failed pass in it is not a finished page').not.toContain('rendered');
    expect(onError).toHaveBeenCalledOnce();

    // Asked to paint again, the same page can complete: the failure belongs to the cycle, not to the page.
    rerender(1.5);
    await waitFor(() => expect(reported).toContain('rendering'));
    await paint(retry);
    expect(reported.at(-1)).toBe('rendered');
  });

  it('reports `error` when the page itself cannot be fetched', async () => {
    const onError = vi.fn();
    const { reported } = mountPage(null, { onError });
    await waitFor(() => expect(reported).toEqual(['queued', 'error']));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('does not report a page that finished after it was thrown away', async () => {
    const task = fakeRenderTask();
    const { reported, view } = mountPage(fakePage([task]));
    await waitFor(() => expect(reported).toContain('rendering'));

    view.unmount();
    const before = [...reported];
    act(() => task.settle());
    await act(async () => undefined);
    expect(reported).toEqual(before);
    expect(reported.at(-1), 'a late paint must not claim a page that is gone').not.toBe('rendered');
  });

  it('re-runs no work when a host rebuilds its callback on every render', async () => {
    const task = fakeRenderTask();
    // One task prepared on purpose: a re-run of the paint would ask `fakePage` for a second one, and it
    // throws rather than letting this test pass for the wrong reason.
    const { reported, rerender } = mountPage(fakePage([task]));
    await waitFor(() => expect(reported).toContain('rendering'));

    // A fresh arrow each render: the memo is defeated, but the effects are not, because the callback is
    // read through a ref like every other one on this component — so no second `rendering` appears.
    rerender(1, (_pageNumber, status) => {
      if (reported.at(-1) !== status) reported.push(status);
    });
    await act(async () => undefined);
    expect(reported.filter((status) => status === 'rendering')).toHaveLength(1);

    await paint(task);
    expect(reported.at(-1)).toBe('rendered');
    expect(reported).not.toContain('error');
  });
});

/*
 * FR-07: the density is an environment value, so a window moving to another display has to reach the canvas.
 * The number was always readable — what nothing did was re-run the paint when it moved, because the
 * environment is not a prop and no effect was watching for it.
 */
describe('the density a page paints at', () => {
  it('doubles the canvas buffer when the display moves, with no prop changing', async () => {
    const first = fakeRenderTask();
    const second = fakeRenderTask();
    const { reported, view } = mountPage(fakePage([first, second]));
    await paint(first);

    const canvas = view.container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect([canvas?.width, canvas?.height]).toEqual([200, 260]);

    moveDisplay(2);
    await waitFor(() => expect(reported.at(-1)).toBe('rendering'));
    await paint(second);

    /*
     * The buffer doubles; the box it is drawn in does not. Layout staying in CSS pixels is the other half of
     * the same sentence in the requirement, and the half a page would get wrong by setting `style.width`
     * from the buffer too.
     */
    expect([canvas?.width, canvas?.height]).toEqual([400, 520]);
    expect(canvas?.style.width).toBe('200px');
    expect(canvas?.style.height).toBe('260px');
    expect(reported).not.toContain('cancelled');
    expect(reported).not.toContain('error');
  });

  it('does not repaint for a resize that left the density where it was', async () => {
    const task = fakeRenderTask();
    // One task prepared again on purpose: a second paint would ask the fake for one it does not have.
    const { reported, view } = mountPage(fakePage([task]));
    await paint(task);
    const canvas = view.container.querySelector('canvas');
    expect([canvas?.width, canvas?.height]).toEqual([200, 260]);

    // A window dragged, a scrollbar appearing, a keyboard opening: `resize` fires, density does not move.
    moveDisplay(1);
    await act(async () => undefined);
    expect(reported.at(-1)).toBe('rendered');
    expect(reported.filter((status) => status === 'rendering')).toHaveLength(1);
    expect([canvas?.width, canvas?.height]).toEqual([200, 260]);
  });

  it('leaves a host that owns the density alone when the display moves', async () => {
    const task = fakeRenderTask();
    const { reported, view } = mountPage(fakePage([task]), { devicePixelRatio: 1 });
    await paint(task);
    const canvas = view.container.querySelector('canvas');
    expect(canvas?.width).toBe(200);

    // The component re-renders — the hook has no way not to — but the value the paint keyed on did not move,
    // so nothing that a host pinned on purpose is thrown away by a monitor switch.
    moveDisplay(2);
    await act(async () => undefined);
    expect(reported.filter((status) => status === 'rendering')).toHaveLength(1);
    expect(canvas?.width).toBe(200);
  });
});
