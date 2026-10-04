/*
 * FR-43 on the page path: what `PdfPage` does with a structure builder it was handed.
 *
 * Four things here are worth a test because each is a way this could be quietly wrong.
 *
 * **The order.** The tree's elements own this page's words by id, so a tree mounted while the text layer is
 * still being pumped binds marks that do not exist yet — and binding nothing is not an error. The page's
 * own state is what the effect waits on, and the assertions below read the recorded call order rather than
 * the final DOM, because the DOM looks the same either way.
 *
 * **The placement.** pdf.js appends its tree *inside* the canvas, and can, because its canvas is
 * `role="presentation"`. Ours is `role="img"` with a page label, and `img` makes its descendants
 * presentational: measured in Chromium, the same tree inside our canvas reports no heading to the
 * accessibility tree at all, and beside it reports the heading while keeping the page name. A test that
 * only asked "is the tree in the page" would pass on the broken version.
 *
 * **The absence of a rebuild.** A zoom must not re-run this effect — the geometry the builder writes is in
 * `calc(var(--total-scale-factor) * …)` — and neither must the builder's late arrival re-run the *text*
 * layer, which is why `structureLayer` is a separate, static prop from the class that comes later.
 *
 * **The failure that is not a page error.** A missing accessibility overlay leaves a page that paints and
 * reads; calling that `error` would tell the reader their document is broken.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';
import type { PdfStructTreeLayerBuilder } from '../lib/features';

const calls = vi.hoisted(() => ({
  order: [] as string[],
  streamOptions: [] as unknown[],
  structCtors: [] as Array<{ page: unknown; rawDims: unknown }>,
  annotationOptions: [] as Array<Record<string, unknown>>,
  /** Every layer the fake builder constructed, so a test can name the instance by identity. */
  layers: [] as unknown[],
  /** Resolves the mocked text layer, which the page has to settle before a tree may mount. */
  finishText: [] as Array<() => void>,
  /** Resolves the tree's own `render()`, which is what hands back the element to mount. */
  finishStruct: [] as Array<() => void>,
}));

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    constructor() {
      calls.order.push('text:ctor');
    }
    render(): Promise<void> {
      return new Promise((resolve) =>
        calls.finishText.push(() => {
          calls.order.push('text:resolved');
          resolve();
        }),
      );
    }
    update(): void {}
    cancel(): void {}
  },
  AnnotationLayer: class {
    constructor(options: Record<string, unknown>) {
      calls.order.push('annotations:ctor');
      calls.annotationOptions.push(options);
    }
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

/** The element pdf.js's builder hands back, and the calls it makes. */
class FakeStructTreeLayer {
  readonly node = document.createElement('div');

  constructor(page: unknown, rawDims: unknown) {
    calls.order.push('struct:ctor');
    calls.structCtors.push({ page, rawDims });
    calls.layers.push(this);
    this.node.className = 'structTree';
  }

  render(): Promise<HTMLElement | null> {
    calls.order.push('struct:render');
    return new Promise((resolve, reject) => {
      if (FakeStructTreeLayer.rejects) {
        reject(new Error('the structure chunk is 404'));
        return;
      }
      calls.finishStruct.push(() => {
        calls.order.push('struct:resolved');
        resolve(this.node);
      });
    });
  }

  updateTextLayer(): void {
    calls.order.push('struct:updateTextLayer');
  }

  hide(): void {
    calls.order.push('struct:hide');
  }

  show(): void {
    calls.order.push('struct:show');
  }

  static rejects = false;
}

const Builder = FakeStructTreeLayer as unknown as PdfStructTreeLayerBuilder;

function fakePage(): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 200 * scale,
      height: 260 * scale,
      scale,
      rotation: 0,
      rawDims: { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 },
      clone: function clone() {
        return this;
      },
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    streamTextContent: (options: unknown) => {
      calls.streamOptions.push(options);
      return Promise.resolve({ items: [] });
    },
    getAnnotations: async () => [],
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

const doc = { getPage: async () => fakePage() } as unknown as PDFDocumentProxy;

function mount(options: {
  structureLayer?: boolean;
  builder?: PdfStructTreeLayerBuilder | null;
  signal?: AbortSignal;
  onError?: (error: Error) => void;
  scale?: number;
}) {
  const element = (scale: number) => (
    <PdfPage
      doc={doc}
      pageNumber={3}
      scale={scale}
      linkService={createPdfLinkService()}
      structureLayer={options.structureLayer ?? false}
      structTreeLayerBuilder={options.builder ?? null}
      {...(options.signal ? { signal: options.signal } : null)}
      {...(options.onError ? { onError: options.onError } : null)}
    />
  );
  const view = render(element(options.scale ?? 1));
  return { view, rerender: (scale: number) => view.rerender(element(scale)) };
}

/** Settle the canvas, then the text layer, then the tree — the order the page itself imposes. */
async function paint(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await act(async () => undefined);
    calls.finishText.forEach((done) => done());
    await act(async () => undefined);
    calls.finishStruct.forEach((done) => done());
    await act(async () => undefined);
  }
}

afterEach(() => {
  cleanup();
  calls.order = [];
  calls.streamOptions = [];
  calls.structCtors = [];
  calls.annotationOptions = [];
  calls.layers = [];
  calls.finishText = [];
  calls.finishStruct = [];
  FakeStructTreeLayer.rejects = false;
});

describe('what a page asks the worker for', () => {
  it('extracts marked content only when the feature asked for it', async () => {
    const plain = mount({});
    await paint();
    plain.view.unmount();

    const marked = mount({ structureLayer: true });
    await paint();

    expect(calls.streamOptions.at(0)).toEqual({ includeMarkedContent: false });
    expect(calls.streamOptions.at(1)).toEqual({ includeMarkedContent: true });
  });

  it('marks the content for a tagged document and for an untagged one alike, before either answer', async () => {
    // The static half of the split: `structureLayer` comes from mounting the feature, and the builder —
    // which is the part that waits for `MarkInfo` — must not be what decides extraction, or the page would
    // build an unmarked layer first and rebuild it when the class lands.
    const marked = mount({ structureLayer: true, builder: Builder });
    await paint();
    expect(calls.streamOptions.at(0)).toEqual({ includeMarkedContent: true });
    expect(calls.structCtors).toHaveLength(1);
  });
});

describe('mounting the tree', () => {
  it('builds nothing until a builder arrives, and nothing without a page to build it from', async () => {
    const { view } = mount({ structureLayer: true, builder: null });
    await paint();
    expect(calls.structCtors).toHaveLength(0);
    expect(view.container.querySelector('.structTree')).toBeNull();
    view.unmount();
  });

  it('binds the tree after the text layer has finished, not while it is being pumped', async () => {
    const { view } = mount({ structureLayer: true, builder: Builder });
    await waitFor(() => expect(calls.order).toContain('text:ctor'));
    expect(calls.order, 'no tree before the layer it binds to is complete').not.toContain('struct:ctor');

    await paint();
    expect(view.container.querySelector('.structTree'), 'mounted only once render() resolved').not.toBeNull();

    /*
     * The order, asserted as a sequence rather than as a DOM state, because the DOM after the fact looks
     * identical whichever order it was built in: the tree is constructed only after the text layer has
     * resolved (`struct:ctor` after `text:resolved`), and the call that binds the tree's elements to those
     * spans — `updateTextLayer()`, which resolves them by `document.getElementById` — runs after the tree
     * itself is built and before the element goes into the page.
     */
    const at = (name: string): number => {
      const index = calls.order.indexOf(name);
      expect(index, `${name} never happened`).toBeGreaterThanOrEqual(0);
      return index;
    };
    expect(at('struct:ctor')).toBeGreaterThan(at('text:resolved'));
    expect(at('struct:updateTextLayer')).toBeGreaterThan(at('struct:render'));
    expect(at('struct:updateTextLayer')).toBeLessThan(at('struct:show'));
    view.unmount();
  });

  it('mounts beside the canvas, which is where an `img` canvas stops hiding it', async () => {
    const { view } = mount({ structureLayer: true, builder: Builder });
    await paint();
    const tree = view.container.querySelector('.structTree');
    expect(tree).not.toBeNull();

    const canvas = view.container.querySelector('canvas');
    const wrapper = view.container.querySelector('.pjsr-canvas-wrapper');
    // The `role="img"` on the canvas is the tested surface that names a page for a screen reader; the
    // tree has to coexist with it, so neither of them can move into the other.
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.contains(tree ?? null)).toBe(false);
    expect(wrapper?.contains(tree ?? null)).toBe(true);
    view.unmount();
  });

  it('takes the tree back out when the page goes, and when the host aborts', async () => {
    const first = mount({ structureLayer: true, builder: Builder });
    await paint();
    expect(first.view.container.querySelector('.structTree')).not.toBeNull();
    first.view.unmount();
    expect(first.view.container.querySelector('.structTree')).toBeNull();

    const controller = new AbortController();
    const second = mount({ structureLayer: true, builder: Builder, signal: controller.signal });
    await paint();
    expect(second.view.container.querySelector('.structTree')).not.toBeNull();
    act(() => controller.abort());
    await act(async () => undefined);
    expect(second.view.container.querySelector('.structTree')).toBeNull();
    second.view.unmount();
  });
});

describe('what does not rebuild the tree', () => {
  it('keeps the mounted tree through a zoom, and does not rebuild it', async () => {
    const { view, rerender } = mount({ structureLayer: true, builder: Builder });
    await paint();
    const tree = view.container.querySelector('.structTree');
    expect(calls.structCtors).toHaveLength(1);

    rerender(2);
    await paint();
    // The geometry the builder writes is `calc(var(--total-scale-factor) * …)`, so the scale change is
    // already answered by the style on the layer. And the node survives the canvas being resized under it
    // because it is not inside the canvas — the other half of the same placement decision.
    expect(calls.structCtors).toHaveLength(1);
    expect(view.container.querySelector('.structTree')).toBe(tree);
    view.unmount();
  });
});

describe('a structure layer that fails', () => {
  it('reaches onError without calling the page broken', async () => {
    FakeStructTreeLayer.rejects = true;
    const onError = vi.fn();
    const statuses: string[] = [];
    const view = render(
      <PdfPage
        doc={doc}
        pageNumber={3}
        scale={1}
        linkService={createPdfLinkService()}
        structureLayer
        structTreeLayerBuilder={Builder}
        onError={onError}
        onStatusChange={(_page, status) => statuses.push(status)}
      />,
    );
    await paint();
    await act(async () => undefined);

    expect(onError).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe('rendered');
    expect(statuses).not.toContain('error');
    expect(view.container.querySelector('.structTree')).toBeNull();
    view.unmount();
  });
});

describe('the tree the annotation layer is given', () => {
  /*
   * `FR-43`'s annotation clause, and the cost of it, asserted together.
   *
   * The annotation layer reads the structure layer from its *constructor* — it asks for each element's
   * `aria-owns` and `aria-label` while it is building the DOM — so the instance has to exist by then. It
   * does not: the tree is only built once the text layer has rendered, which is after the annotations were
   * first drawn. Hence the second construction below, which is the price of the attribute actually
   * landing rather than a churn to be apologised for: one extra annotation-layer render per tagged page,
   * and none at all for the untagged majority.
   */
  it('hands the instance to the annotation layer, at the cost of one re-render', async () => {
    const { view } = mount({ structureLayer: true, builder: Builder });
    await paint();

    expect(calls.layers).toHaveLength(1);
    expect(calls.annotationOptions.length, 'once before the tree exists, once with it').toBe(2);
    const [before, after] = calls.annotationOptions;
    expect(before?.structTreeLayer).toBeNull();
    expect(after?.structTreeLayer).toBe(calls.layers[0]);
    view.unmount();
  });

  it('renders the annotation layer once when there is no structure feature mounted', async () => {
    const { view } = mount({ structureLayer: false, builder: null });
    await paint();
    expect(calls.annotationOptions).toHaveLength(1);
    expect(calls.annotationOptions[0]?.structTreeLayer).toBeNull();
    view.unmount();
  });
});
