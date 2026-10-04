/*
 * FR-09: "90° clockwise and counter-clockwise, per page or document-wide, with every overlay layer staying
 * registered to the painted page."
 *
 * The half that had no assertion was the second clause. The viewport maths was proven (`src/lib/layout.test.ts`
 * rotates a box; `src/lib/edge-cases.test.ts` does the same for a damaged page) and one controller test rotates
 * a page, but nothing in the suite failed when a layer kept the *unrotated* box: a text layer placed against
 * 595×842 while the canvas paints 842×595 puts every word in the wrong place, and an annotation layer built for
 * the old viewport puts every link and widget there too. The bug is invisible to the arithmetic tests because
 * the arithmetic is right — what goes wrong is which viewport gets handed to which collaborator.
 *
 * So each layer class is stubbed as a recorder, and the assertions are about the arguments the page passes it:
 * **the rotated box**, and **this page's own element** for it to write into. Those two together are what
 * "registered to the painted page" means in code — a layer is registered when it is built against the node that
 * lives inside this page's slot and the geometry that page was just painted at. The engine's own bookkeeping
 * (`PageViewport.rotation`, the manager's layer table) is not ours to re-test; `#text-layer-selectable` and
 * `#sidebar-thumbs-outline` in the browser matrix are where the rendered result is looked at.
 *
 * One asymmetry worth naming, because it is the reason the counter-clockwise case is a test rather than an
 * afterthought: `(-90) % 360` is `-90` in JavaScript. The controller normalises to `0…359` before a rotation
 * reaches a page, so the component asks the engine for 270, and this file asserts the box swapped rather than
 * the sign — which is the property the reader actually sees.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, AnnotationEditorUIManager } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';

/** A recorded call: the arguments the page handed a layer, plus the box it was told to work against. */
interface Call {
  viewport: { width: number; height: number; rotation: number };
  [key: string]: unknown;
}

const seen = vi.hoisted(() => ({
  annotationBuilt: [] as Call[],
  annotationRendered: [] as Call[],
  textBuilt: [] as Call[],
  editorBuilt: [] as Call[],
  drawBuilt: [] as Call[],
  drawParents: [] as Element[],
  destroyed: [] as string[],
  painted: [] as Call[],
  xfaRendered: [] as Call[],
}));

/** The base box: 595×842, so a 90° viewport is 842×595 and the swap is unmissable. */
const BOX = { width: 595, height: 842 };

function viewportFor(scale: number, rotation: number): Call['viewport'] {
  const turned = Math.abs(rotation) % 180 === 90;
  const width = (turned ? BOX.height : BOX.width) * scale;
  const height = (turned ? BOX.width : BOX.height) * scale;
  return { width, height, rotation };
}

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TextLayer: class {
    textDivs: HTMLElement[] = [];
    constructor(params: Call) {
      seen.textBuilt.push(params);
    }
    render(): Promise<void> {
      return Promise.resolve();
    }
    update(): void {}
    cancel(): void {}
  },
  AnnotationLayer: class {
    constructor(params: Call) {
      seen.annotationBuilt.push(params);
    }
    render(params: Call): Promise<void> {
      seen.annotationRendered.push(params);
      return Promise.resolve();
    }
    update(): void {}
    destroy(): void {
      seen.destroyed.push('annotation');
    }
  },
  DrawLayer: class {
    constructor(params: Call) {
      seen.drawBuilt.push(params);
    }
    setParent(parent: Element): void {
      seen.drawParents.push(parent);
    }
    destroy(): void {
      seen.destroyed.push('draw');
    }
  },
  AnnotationEditorLayer: class {
    constructor(params: Call) {
      seen.editorBuilt.push(params);
    }
    render(): Promise<void> {
      return Promise.resolve();
    }
    destroy(): void {
      seen.destroyed.push('editor');
    }
    update(): void {}
  },
  XfaLayer: {
    render(params: Call) {
      seen.xfaRendered.push(params);
      return {};
    },
    update(params: Call) {
      seen.xfaRendered.push(params);
    },
  },
}));

function fakePage(overrides: Record<string, unknown> = {}): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
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
    ...overrides,
  } as unknown as PDFPageProxy;
}

/**
 * A manager-shaped stand-in for the annotate tier's Runner. The page only ever hands it to the two layers, and
 * the recorder asserts that it got handed; nothing here calls a method on it, so the 126 fields the real class
 * declares are cast away rather than stubbed.
 */
const MANAGER = {} as unknown as AnnotationEditorUIManager;

function mount(rotation: number, overrides: Record<string, unknown> = {}) {
  const page = fakePage(overrides.page as Record<string, unknown> | undefined);
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const view = render(
    <PdfPage
      doc={doc}
      pageNumber={2}
      scale={1}
      rotation={rotation}
      linkService={createPdfLinkService()}
      devicePixelRatio={1}
      onStatusChange={() => undefined}
      {...overrides}
    />,
  );
  return { view, page, doc };
}

/** The one record a layer should have produced, with the count asserted rather than assumed. */
function only<T>(list: T[], what: string): T {
  expect(list, what).toHaveLength(1);
  const first = list[0];
  if (first === undefined) throw new Error(`${what} captured nothing`);
  return first;
}

beforeEach(() => {
  seen.annotationBuilt.length = 0;
  seen.annotationRendered.length = 0;
  seen.textBuilt.length = 0;
  seen.editorBuilt.length = 0;
  seen.drawBuilt.length = 0;
  seen.drawParents.length = 0;
  seen.destroyed.length = 0;
  seen.painted.length = 0;
  seen.xfaRendered.length = 0;
});

afterEach(() => cleanup());

describe('the layers a rotated page hands its box to (FR-09)', () => {
  it('builds every overlay against the turned viewport rather than the stored one', async () => {
    const { view } = mount(90, { annotationEditorUIManager: MANAGER });
    await waitFor(() => expect(seen.annotationRendered).toHaveLength(1));

    const turned = viewportFor(1, 90);
    // The canvas: painted at 842×595, which is the reference every layer below is measured against.
    expect([only(seen.painted, 'the canvas paint').viewport.width, only(seen.painted, 'the canvas paint').viewport.height]).toEqual([842, 595]);

    for (const [label, call] of [
      ['the text layer', only(seen.textBuilt, 'the text layer constructor')],
      ['the annotation layer', only(seen.annotationBuilt, 'the annotation constructor')],
      ['the annotation render', only(seen.annotationRendered, 'the annotation render')],
      ['the editor layer', only(seen.editorBuilt, 'the editor constructor')],
    ] as const) {
      expect(call.viewport.width, `${label} kept the unrotated box`).toBe(turned.width);
      expect(call.viewport.height, `${label} kept the unrotated box`).toBe(turned.height);
      expect(call.viewport.rotation).toBe(90);
    }
    expect(view.container.querySelector('canvas')?.width).toBe(842);
  });

  it('registers each layer into this page’s own element, and points the editor at the live annotation layer', async () => {
    const { view } = mount(90, { annotationEditorUIManager: MANAGER });
    await waitFor(() => expect(seen.editorBuilt).toHaveLength(1));

    const annotation = only(seen.annotationBuilt, 'the annotation constructor');
    const editor = only(seen.editorBuilt, 'the editor constructor');
    const text = only(seen.textBuilt, 'the text layer constructor');

    const annotationNode = view.container.querySelector('.pjsr-annotation-layer');
    const editorNode = view.container.querySelector('.pjsr-editor-layer');
    const textNode = view.container.querySelector('.pjsr-text-layer');
    expect([annotationNode, editorNode, textNode].every((n) => n !== null)).toBe(true);

    // The node and the instance are both assertions: the layer must write into the div that is in *this*
    // page's slot, and the editor must be linked to the annotation layer that is live now, not an earlier one.
    expect(annotation.div).toBe(annotationNode);
    expect(editor.div).toBe(editorNode);
    expect(text.container).toBe(textNode);
    expect(editor.textLayer).toEqual({ div: textNode });
    expect(editor.annotationLayer).toBeInstanceOf(Object);
    expect(editor.uiManager).toBeInstanceOf(Object);
    // Page 2 of the document is index 1, and the manager keys its editors by that index.
    expect(editor.pageIndex).toBe(1);
    expect(only(seen.drawBuilt, 'the draw layer').pageIndex).toBe(1);
    expect(seen.drawParents[0]).toBe(view.container.querySelector('.pjsr-canvas-wrapper'));
  });

  it('keeps the boxes registered when the page is turned again, and destroys the layers it replaces', async () => {
    const { view } = mount(0, { annotationEditorUIManager: MANAGER });
    await waitFor(() => expect(seen.annotationBuilt).toHaveLength(1));
    expect(only(seen.annotationBuilt, 'the first annotation constructor').viewport.width).toBe(595);

    // Rotate the document 90° from the toolbar: the page re-renders with a new `rotation` prop.
    view.rerender(
      <PdfPage
        doc={{ getPage: async () => fakePage() } as unknown as PDFDocumentProxy}
        pageNumber={2}
        scale={1}
        rotation={90}
        linkService={createPdfLinkService()}
        devicePixelRatio={1}
        onStatusChange={() => undefined}
        annotationEditorUIManager={MANAGER}
      />,
    );
    await waitFor(() => expect(seen.annotationBuilt).toHaveLength(2));

    expect(seen.annotationBuilt[1]?.viewport.width).toBe(842);
    expect(seen.textBuilt.at(-1)?.viewport.rotation).toBe(90);
    // Nothing stale stays registered: the layer that the rotation replaced was destroyed rather than dropped.
    expect(seen.destroyed).toContain('editor');
    expect(seen.destroyed).toContain('draw');
    // and the page still has exactly one element per layer, so the new registrations cannot land twice.
    expect(view.container.querySelectorAll('.pjsr-annotation-layer')).toHaveLength(1);
    expect(view.container.querySelectorAll('.pjsr-editor-layer')).toHaveLength(1);
  });

  it('turns the other way too: a counter-clockwise 90 swaps the box the same time', async () => {
    const { view } = mount(270, { annotationEditorUIManager: MANAGER });
    await waitFor(() => expect(seen.annotationBuilt).toHaveLength(1));

    // The controller normalises -90 to 270 before it reaches a page, so the box is swapped and the sign that
    // reaches the engine is the normalised one — which is what `PageViewport` asks for.
    const built = only(seen.annotationBuilt, 'the annotation constructor');
    expect([built.viewport.width, built.viewport.height]).toEqual([842, 595]);
    expect(built.viewport.rotation).toBe(270);
    expect(view.container.querySelector('canvas')?.width).toBe(842);
  });

  it('rotates one page without moving its neighbour', async () => {
    /*
     * Two pages in one strip, one turned: the per-page half of the clause reaches a page as its own `rotation`
     * prop, and the assertion that matters is that each page's layers were built against *that* page — its own
     * proxy, its own box, its own element. A shared viewport object would pass every single-page test above and
     * still put page 2's words on page 1.
     */
    const turnedPage = fakePage();
    const flatPage = fakePage();
    const doc = {
      getPage: async (pageNumber: number) => (pageNumber === 2 ? turnedPage : flatPage),
    } as unknown as PDFDocumentProxy;
    const view = render(
      <div>
        <PdfPage
          doc={doc}
          pageNumber={2}
          scale={1}
          rotation={90}
          linkService={createPdfLinkService()}
          devicePixelRatio={1}
          onStatusChange={() => undefined}
          annotationEditorUIManager={MANAGER}
        />
        <PdfPage
          doc={doc}
          pageNumber={3}
          scale={1}
          rotation={0}
          linkService={createPdfLinkService()}
          devicePixelRatio={1}
          onStatusChange={() => undefined}
          annotationEditorUIManager={MANAGER}
        />
      </div>,
    );
    await waitFor(() => expect(seen.annotationBuilt).toHaveLength(2));

    const byPage = new Map(seen.annotationBuilt.map((call) => [call.page, call]));
    const turned = byPage.get(turnedPage);
    const flat = byPage.get(flatPage);
    expect(turned?.viewport.width, 'the turned page did not get the swapped box').toBe(842);
    expect(flat?.viewport.width, 'the flat page was turned as well').toBe(595);

    // Each layer writes into its own page's element: the two annotation divs are different nodes in the DOM.
    const nodes = [...view.container.querySelectorAll('.pjsr-annotation-layer')];
    expect(nodes).toHaveLength(2);
    expect(nodes).toContain(turned?.div);
    expect(nodes).toContain(flat?.div);
    expect(turned?.div).not.toBe(flat?.div);

    // and the canvases they were measured against agree with the layers: one 842-wide buffer, one 595.
    const buffers = [...view.container.querySelectorAll('canvas')].map((c) => c.width).sort((a, b) => a - b);
    expect(buffers).toEqual([595, 842]);
  });
});
