/*
 * FR-06: a zoom step re-lays the text layer out; it does not rebuild it.
 *
 * The clause is one sentence in the requirement — "a zoom step updates existing overlay layers in place rather
 * than rebuilding them" — and it had no assertion behind it at all: the shared `TextLayer` mock in
 * `PdfPage.status.test.tsx` has an `update()` that does nothing, so a page that threw the layer away and
 * re-extracted the whole page on every wheel notch would have passed. That is not a slow-path bug either.
 * Measured on the tracemonkey title page, 163 spans cost 39.8 ms to rebuild against 1 ms to re-lay out, and the
 * rebuild takes the search marks with it, so the highlights flash off and back on while the reader is zooming.
 *
 * What "in place" means here is decided by the engine's own two calls, and the test holds them apart:
 * `streamTextContent` is the worker round trip and the span build, and `update()` is the synchronous re-layout
 * over the divs that are already in the document. So the assertions are counts and identities, not timings —
 * **one extraction, one layer instance, one stamped span still connected, and an `update()` handed the new
 * viewport** — which is the shape of the claim that survives a slower machine.
 *
 * Two boundaries come with the clause and are asserted too, because "in place" is not a rule for every change:
 * a different page has to rebuild (the text is different), and so does a rotation, which is why `rotation` is a
 * dependency of the build effect and the viewport is not.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';

/** Everything the fake layers did, so a count is a fact about the page rather than a hope about the mock. */
const calls = vi.hoisted(() => ({
  builds: [] as unknown[],
  renders: 0,
  extracts: 0,
  updates: [] as Array<{ viewport: { width: number; height: number } }>,
  cancels: 0,
}));

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    container: HTMLElement;
    viewport: { width: number; height: number };

    constructor(params: { container: HTMLElement; viewport: { width: number; height: number } }) {
      calls.builds.push(this);
      this.container = params.container;
      this.viewport = params.viewport;
    }

    render(): Promise<void> {
      calls.renders += 1;
      // Stamped with the viewport it was built at, so a re-layout that *kept* the layer can be told apart
      // from one that replaced it: this node is only still connected if nobody cleared the container.
      const span = document.createElement('span');
      span.dataset.builtAt = String(this.viewport.width);
      this.textDivs = [span];
      this.container.replaceChildren(span);
      return Promise.resolve();
    }

    update(params: { viewport: { width: number; height: number } }): void {
      calls.updates.push(params);
      for (const div of this.textDivs) div.dataset.laidOutAt = String(params.viewport.width);
    }

    cancel(): void {
      calls.cancels += 1;
    }
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

function fakePage(): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    // A fresh object per scale, as the real `PageViewport` is: a shared one would make a zoom step invisible
    // to the update effect, which keys on the viewport's identity.
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 200 * scale,
      height: 260 * scale,
      clone: () => ({ width: 0, height: 0 }),
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
    // The count that decides the clause: `streamTextContent` is the worker round trip whose result the layer
    // is built from, so a second call means the page was re-extracted rather than re-laid out.
    streamTextContent: () => {
      calls.extracts += 1;
      return Promise.resolve({ items: [] });
    },
    getAnnotations: async () => [],
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

function fakeDoc(pages: Record<number, PDFPageProxy>): PDFDocumentProxy {
  return {
    getPage: async (pageNumber: number) => {
      const page = pages[pageNumber];
      if (!page) throw new Error(`Page ${pageNumber} is not in this document.`);
      return page;
    },
  } as unknown as PDFDocumentProxy;
}

const strip = (doc: PDFDocumentProxy, pageNumber: number, scale: number, rotation: number) => (
  <PdfPage
    doc={doc}
    pageNumber={pageNumber}
    scale={scale}
    rotation={rotation}
    linkService={createPdfLinkService()}
    onStatusChange={() => undefined}
  />
);

function mount(doc: PDFDocumentProxy, pageNumber: number, scale: number, rotation = 0) {
  const view = render(strip(doc, pageNumber, scale, rotation));
  return { view, rerender: (nextPage: number, nextScale: number, nextRotation = rotation) => view.rerender(strip(doc, nextPage, nextScale, nextRotation)) };
}

beforeEach(() => {
  calls.builds = [];
  calls.renders = 0;
  calls.extracts = 0;
  calls.updates = [];
  calls.cancels = 0;
});

afterEach(() => cleanup());

describe('a zoom step (FR-06)', () => {
  it('re-lays the layer it already has out, with no second extraction and no new layer', async () => {
    const doc = fakeDoc({ 3: fakePage() });
    const { view, rerender } = mount(doc, 3, 1);
    /*
     * Wait for the layer to be published *and* laid out, not merely for `render()` to have been called: the
     * effect below the build runs `update()` at the viewport the layer was just placed at, which pdf.js treats
     * as a no-op, and a test that snapshots the count before it lands is racing its own subject.
     */
    await waitFor(() => expect(calls.updates).toHaveLength(1));
    const built = view.container.querySelector<HTMLElement>('.pjsr-text-layer span');
    expect(built?.dataset.builtAt).toBe('200');
    expect(calls.updates[0]?.viewport.width).toBe(200);

    rerender(3, 1.5);
    await waitFor(() => expect(calls.updates).toHaveLength(2));

    // The clause in numbers: one build, one extraction, no cancellation, and one re-layout for one zoom step.
    expect(calls.builds).toHaveLength(1);
    expect(calls.renders).toBe(1);
    expect(calls.extracts, 'the zoom re-extracted the page from the worker').toBe(1);
    expect(calls.cancels, 'the zoom cancelled the layer it was keeping').toBe(0);
    // The new viewport, not the old box: a re-layout at 200 would read as a zoom that does not zoom.
    expect(calls.updates[1]?.viewport.width).toBe(300);
    // The span the first build stamped is still the one in the document, re-laid rather than replaced.
    expect(view.container.querySelector('.pjsr-text-layer span')).toBe(built);
    expect(built?.dataset.laidOutAt).toBe('300');
  });

  it('extracts the page exactly once however many times the shell re-renders around it', async () => {
    const doc = fakeDoc({ 3: fakePage() });
    const { view, rerender } = mount(doc, 3, 1);
    await waitFor(() => expect(calls.renders).toBe(1));

    for (const scale of [1, 1, 1.25, 1.25, 1]) {
      rerender(3, scale);
      await act(async () => undefined);
    }

    expect(calls.builds, 'a re-render of the same page rebuilt the text layer').toHaveLength(1);
    expect(calls.extracts).toBe(1);
    expect(view.container.querySelectorAll('.pjsr-text-layer span')).toHaveLength(1);
  });

  it('rebuilds for a different page, because that is a different text content', async () => {
    const doc = fakeDoc({ 3: fakePage(), 4: fakePage() });
    const { rerender } = mount(doc, 3, 1);
    await waitFor(() => expect(calls.renders).toBe(1));

    rerender(4, 1);
    await waitFor(() => expect(calls.renders).toBe(2));
    expect(calls.builds).toHaveLength(2);
    expect(calls.extracts).toBe(2);
    expect(calls.cancels, 'the page that left dropped its layer').toBeGreaterThanOrEqual(1);
  });

  it('rebuilds for a rotation, which is the one change the re-layout cannot answer', async () => {
    const doc = fakeDoc({ 3: fakePage() });
    const { rerender } = mount(doc, 3, 1, 0);
    await waitFor(() => expect(calls.renders).toBe(1));

    // `rotation` is a dependency of the build effect on purpose: percent-placed spans from a 90°-turned
    // viewport are the wrong spans, and `update()` re-sizes what is there rather than re-orienting it.
    rerender(3, 1, 90);
    await waitFor(() => expect(calls.builds).toHaveLength(2));
    expect(calls.renders, 'a rotated page kept the unrotated text layer').toBe(2);
  });
});
