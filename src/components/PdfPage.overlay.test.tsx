/*
 * FR-06: "A zoom step updates existing overlay layers in place rather than rebuilding them."
 *
 * The text layer has held this assertion for a while and the other two overlays did not, which is how the row
 * could read `met` while the page destroyed and re-created the annotation layer on every wheel notch: the build
 * effect listed `viewport` among its dependencies, so a scale change ran its teardown
 * (`container.replaceChildren()`, `layer.destroy()`) and constructed a fresh pair of layers. A rebuild is not
 * only the worker round trip and the element build. It is the reader's position inside the page: the widget that
 * holds the focus, the mark the manager was mid-drag over, the `change` listener the page itself attaches to the
 * container the layer writes into. All three went away mid-zoom.
 *
 * What "in place" means is decided by the engine, not by taste. Its own `AnnotationLayerBuilder.render`
 * (`web/pdf_viewer.mjs`) repositions the layer it already has — `annotationLayer.update({ viewport,
 * optionalContentConfig })` — and constructs only when there is no div yet, and its editor-layer builder is
 * called the same way. The elements need nothing more: `AnnotationElement` places every widget in percentages of
 * the page box, which is the one piece of arithmetic a scale change cannot invalidate. So the assertions are
 * counts and identities — **one construction, one `render`, one `update()` per step handed the new box, and the
 * same element still in the document** — plus the two consequences a count cannot show: the focus and the
 * listener.
 *
 * The boundaries are asserted in the same breath, because "in place" is not a rule for every change. A rotation
 * still rebuilds — `update()` re-sizes the box and does not re-orient a percent-placed element — and so does a
 * different page or a programmatic form write, which is what `formVersion` is for.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationEditorUIManager, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';

interface Call {
  viewport: { width: number; height: number; rotation: number };
  div: HTMLElement;
  [key: string]: unknown;
}

/** Everything the two overlay classes did, so a count is a fact about the page rather than a hope about the mock. */
const seen = vi.hoisted(() => ({
  annotationBuilt: [] as Call[],
  annotationRendered: [] as Call[],
  annotationUpdated: [] as Call[],
  editorBuilt: [] as Call[],
  editorUpdated: [] as Call[],
  destroyed: [] as string[],
  painted: [] as Call[],
}));

const BOX = { width: 595, height: 842 };

function viewportFor(scale: number, rotation: number) {
  const turned = Math.abs(rotation) % 180 === 90;
  return {
    width: (turned ? BOX.height : BOX.width) * scale,
    height: (turned ? BOX.width : BOX.height) * scale,
    rotation,
  };
}

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
    div: HTMLElement;

    constructor(params: Call) {
      seen.annotationBuilt.push(params);
      this.div = params.div;
    }

    /** The engine appends its elements into the layer's div, so this is where a widget can be focused. */
    render(params: Call): Promise<void> {
      seen.annotationRendered.push(params);
      const widget = document.createElement('input');
      widget.className = 'pjsr-widget-stub';
      widget.dataset.builtAt = String(params.viewport.width);
      this.div.replaceChildren(widget);
      return Promise.resolve();
    }

    update(params: Call): void {
      seen.annotationUpdated.push(params);
      // What the real `update()` leaves behind: the same elements, sized against the new box.
      for (const node of this.div.querySelectorAll<HTMLElement>('[data-built-at]')) {
        node.dataset.laidOutAt = String(params.viewport.width);
      }
    }

    destroy(): void {
      seen.destroyed.push('annotation');
    }
  },
  DrawLayer: class {
    setParent(): void {}
    destroy(): void {
      seen.destroyed.push('draw');
    }
  },
  AnnotationEditorLayer: class {
    div: HTMLElement;

    constructor(params: Call) {
      seen.editorBuilt.push(params);
      this.div = params.div;
    }

    render(params: Call): Promise<void> {
      const mark = document.createElement('div');
      mark.className = 'pjsr-editor-stub';
      mark.dataset.builtAt = String(params.viewport.width);
      this.div.replaceChildren(mark);
      return Promise.resolve();
    }

    update(params: Call): void {
      seen.editorUpdated.push(params);
      for (const node of this.div.querySelectorAll<HTMLElement>('[data-built-at]')) {
        node.dataset.laidOutAt = String(params.viewport.width);
      }
    }

    destroy(): void {
      seen.destroyed.push('editor');
    }
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
    getViewport: ({ scale = 1, rotation = 0 }: { scale?: number; rotation?: number }) => ({
      ...viewportFor(scale, rotation),
      clone: () => viewportFor(scale, rotation),
    }),
    render: (params: Call) => {
      seen.painted.push(params);
      return { promise: Promise.resolve(), cancel: vi.fn() };
    },
    streamTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: async () => [],
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

/**
 * A manager-shaped stand-in: the page only ever hands it to the two layers, and the recorder asserts it got
 * handed. Nothing here calls a method on it, so the real class's hundred-odd fields are cast away.
 */
const MANAGER = {} as unknown as AnnotationEditorUIManager;

/**
 * One link service, one document and one `onFormChange` for a whole test, because the first two are
 * dependencies of the build effects. A host that rebuilt them every render would rebuild the layers, and the
 * shell does not: it holds both on the controller. Passing fresh ones here would measure the harness instead of
 * the page, which is the mistake this file exists to avoid.
 */
function mount(scale: number, rotation = 0, overrides: Record<string, unknown> = {}) {
  const page = fakePage();
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const linkService = createPdfLinkService();
  const onFormChange = vi.fn();
  const strip = (nextScale: number, nextRotation: number, extra: Record<string, unknown> = {}) => (
    <PdfPage
      doc={doc}
      pageNumber={2}
      scale={nextScale}
      rotation={nextRotation}
      linkService={linkService}
      annotationEditorUIManager={MANAGER}
      renderForms
      devicePixelRatio={1}
      onFormChange={onFormChange}
      onStatusChange={() => undefined}
      {...overrides}
      {...extra}
    />
  );
  const view = render(strip(scale, rotation));
  return {
    view,
    onFormChange,
    rerender: (nextScale: number, nextRotation = rotation, extra?: Record<string, unknown>) =>
      act(() => view.rerender(strip(nextScale, nextRotation, extra))),
  };
}

beforeEach(() => {
  seen.annotationBuilt.length = 0;
  seen.annotationRendered.length = 0;
  seen.annotationUpdated.length = 0;
  seen.editorBuilt.length = 0;
  seen.editorUpdated.length = 0;
  seen.destroyed.length = 0;
  seen.painted.length = 0;
});

afterEach(() => cleanup());

describe('a zoom step on the two overlays that used to rebuild (FR-06)', () => {
  it('builds the annotation layer once and re-lays it out at each new box', async () => {
    const { view, rerender } = mount(1);
    /*
     * Wait for the layer to have been *laid out*, not merely rendered: the effect under the build runs
     * `update()` at the viewport the layer was just placed at, which pdf.js treats as a no-op, and a test that
     * snapshots the counts before it lands is racing its own subject.
     */
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(1));
    const widget = view.container.querySelector<HTMLElement>('.pjsr-widget-stub');
    expect(widget?.dataset.builtAt).toBe(String(BOX.width));

    await rerender(1.25);
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(2));
    await rerender(2);
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(3));

    // The clause in numbers: one layer, one annotation read, three layouts, nothing destroyed.
    expect(seen.annotationBuilt, 'the zoom rebuilt the annotation layer').toHaveLength(1);
    expect(seen.annotationRendered, 'the zoom re-read the annotations from the worker').toHaveLength(1);
    expect(seen.destroyed, 'the zoom destroyed a layer it was keeping').toEqual([]);
    expect(seen.annotationUpdated.map((call) => call.viewport.width)).toEqual([
      BOX.width,
      BOX.width * 1.25,
      BOX.width * 2,
    ]);
    // The element the first build stamped is still the one in the document, re-sized rather than replaced.
    expect(view.container.querySelector('.pjsr-widget-stub')).toBe(widget);
    expect(widget?.dataset.laidOutAt).toBe(String(BOX.width * 2));
  });

  it('keeps the widget the reader is inside of, and still hears the change they make in it', async () => {
    const { view, rerender, onFormChange } = mount(1);
    await waitFor(() => expect(seen.annotationRendered).toHaveLength(1));

    const widget = view.container.querySelector<HTMLInputElement>('.pjsr-widget-stub');
    if (!widget) throw new Error('the annotation layer mounted no widget to focus');
    await act(async () => widget.focus());
    expect(document.activeElement).toBe(widget);

    await rerender(1.75);
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(2));
    // The half a count cannot show: a rebuild took the focus out of the page with it.
    expect(document.activeElement, 'the zoom step moved the reader out of the field').toBe(widget);

    // And the listener the page attaches beside the layer: still attached, still heard.
    onFormChange.mockClear();
    widget.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onFormChange, 'the zoom step detached the page’s own form listener').toHaveBeenCalledTimes(1);
  });

  it('repositions the editor layer too, which is where a drawn mark lives', async () => {
    const { view, rerender } = mount(1);
    await waitFor(() => expect(seen.editorUpdated).toHaveLength(1));
    const mark = view.container.querySelector<HTMLElement>('.pjsr-editor-stub');

    await rerender(1.5);
    await waitFor(() => expect(seen.editorUpdated).toHaveLength(2));

    expect(seen.editorBuilt, 'the zoom rebuilt the editor layer').toHaveLength(1);
    expect(seen.destroyed, 'the zoom destroyed the editor or its draw layer').toEqual([]);
    expect(seen.editorUpdated[1]?.viewport.width).toBe(BOX.width * 1.5);
    /*
     * A rebuild would have re-adopted the manager's editors into a brand new element, which survives a count of
     * editors but not a count of nodes: this is the element the first render stamped.
     */
    expect(view.container.querySelector('.pjsr-editor-stub')).toBe(mark);
    expect(mark?.dataset.laidOutAt).toBe(String(BOX.width * 1.5));
  });

  it('still rebuilds for a rotation, which a re-layout cannot answer', async () => {
    const { rerender } = mount(1);
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(1));

    await rerender(1, 90);
    await waitFor(() => expect(seen.annotationBuilt).toHaveLength(2));
    await waitFor(() => expect(seen.editorBuilt).toHaveLength(2));
    expect(seen.destroyed, 'a rotated page kept the layer built for the old box').toContain('annotation');
    expect(seen.annotationBuilt[1]?.viewport.rotation).toBe(90);
    expect(seen.annotationBuilt[1]?.viewport.width).toBe(BOX.height);
  });

  it('still rebuilds for a programmatic form write, which is a different set of annotations', async () => {
    const { rerender } = mount(1, 0, { formVersion: 0 });
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(1));

    await rerender(1, 0, { formVersion: 1 });
    await waitFor(() => expect(seen.annotationBuilt).toHaveLength(2));
    expect(seen.annotationRendered).toHaveLength(2);
  });

  it('takes the layers down once, when the page goes, and not between zoom steps', async () => {
    const { rerender } = mount(1);
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(1));
    await rerender(1.5);
    await waitFor(() => expect(seen.annotationUpdated).toHaveLength(2));
    expect(seen.destroyed, 'a zoom step destroyed a layer the page still shows').toEqual([]);

    // The other half of the same rule: the layers do come down, exactly once each, when the page leaves.
    cleanup();
    expect(seen.destroyed.filter((what) => what === 'annotation')).toHaveLength(1);
    expect(seen.destroyed.filter((what) => what === 'editor')).toHaveLength(1);
    expect(seen.destroyed).toContain('draw');
  });
});
