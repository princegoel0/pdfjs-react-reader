/*
 * FR-18's display half: "render existing link, markup and form-related annotations through the annotation
 * layer". The word doing the work is *through* — the package does not re-draw a mark in its own overlay, it
 * hands what the document carries to pdf.js's `AnnotationLayer` and lets the engine build the DOM. Since the
 * same requirement withdrew the core pen (FR-18's second half, `core-ink.withdrawal.test.ts`), there is now
 * exactly one surface on a page where an annotation mark appears.
 *
 * `AnnotationLayer` is stubbed, and the stub is a recorder: the assertions are about what the page hands the
 * engine, which is the only part that is ours. The pixels the engine makes from them are its own contract,
 * and the browser pass is where those are looked at.
 *
 * The stub records the constructor and the `render` call separately because pdf.js reads some collaborators
 * off one and some off the other — `annotationEditorUIManager` from the constructor, `downloadManager` and
 * `renderForms` from the render parameters — and a page that passed them to the wrong place would look
 * identical on screen and lose the feature quietly.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';

interface Captured {
  constructor: Record<string, unknown>[];
  render: Record<string, unknown>[];
  intents: unknown[];
}

const captured: Captured = { constructor: [], render: [], intents: [] };

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
    constructor(options: Record<string, unknown>) {
      captured.constructor.push(options);
    }
    render(params: Record<string, unknown>): Promise<void> {
      captured.render.push(params);
      return Promise.resolve();
    }
    update(): void {}
    destroy(): void {}
  },
  DrawLayer: class {
    setParent(): void {}
    destroy(): void {}
  },
  XfaLayer: { render: () => ({}), update: () => undefined },
}));

afterEach(() => {
  cleanup();
  captured.constructor.length = 0;
  captured.render.length = 0;
  captured.intents.length = 0;
});

/**
 * Three annotations of the three kinds the clause names. The fields are the ones the layer's own dispatcher
 * reads to choose a renderer — `annotationType` for the family, `subtype` for the markup, `fieldType` for a
 * widget — and `isEditable` is what tells the page an editor could take the mark over.
 */
const ANNOTATIONS = [
  {
    id: 'L1',
    annotationType: 'Link',
    subtype: 'Link',
    rect: [72, 700, 200, 720],
    url: 'https://example.com/annual-report',
    isEditable: false,
  },
  {
    id: 'H1',
    annotationType: 'Popup',
    subtype: 'HighLight',
    rect: [72, 600, 300, 612],
    isEditable: true,
  },
  {
    id: 'W1',
    annotationType: 'Widget',
    fieldType: 'Tx',
    fieldName: ['applicant'],
    rect: [72, 500, 260, 516],
    value: 'A. Reader',
    isEditable: true,
  },
];

function fakePage(): PDFPageProxy {
  const box = { width: 595, height: 842 };
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    getViewport: () => ({ ...box, clone: () => ({ ...box }) }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    streamTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: (params: unknown) => {
      captured.intents.push(params);
      return Promise.resolve(ANNOTATIONS);
    },
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

function mount(over: Record<string, unknown> = {}) {
  const page = fakePage();
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
  const view = render(
    <PdfPage
      doc={doc}
      pageNumber={2}
      scale={1}
      linkService={createPdfLinkService()}
      devicePixelRatio={1}
      {...over}
    />,
  );
  return { page, ...view };
}

/**
 * The one record a page should have produced, with the count asserted rather than assumed.
 *
 * A test that read `captured.render[0]` straight would report `undefined is not "display"` when the layer
 * never ran, which reads like a wrong value rather than a missing one.
 */
function only<T>(list: T[], what: string): T {
  expect(list, what).toHaveLength(1);
  const first = list[0];
  if (first === undefined) throw new Error(`${what} captured nothing`);
  return first;
}

describe('the page renders what the document already carries (FR-18)', () => {
  it('asks the engine for the display annotations and hands them to the layer', async () => {
    mount();
    await waitFor(() => expect(captured.render).toHaveLength(1));

    // The clause's three kinds, all of them, none of them redrawn by us.
    expect(only(captured.render, 'the layer render').annotations).toEqual(ANNOTATIONS);
    expect(captured.intents).toEqual([{ intent: 'display' }]);
  });

  it('builds the layer into the page’s own annotation element', async () => {
    const { container } = mount();
    await waitFor(() => expect(captured.constructor).toHaveLength(1));

    const layer = container.querySelector('.pjsr-annotation-layer');
    expect(layer).not.toBeNull();
    // The control that this is the same node and not a look-alike: the layer writes its DOM into the div we
    // hand it, so a second container would put the annotations somewhere the stylesheet never reaches.
    expect(only(captured.constructor, 'the layer constructor').div).toBe(layer);
    expect(only(captured.render, 'the layer render').div).toBe(layer);
  });

  it('gives the layer the collaborators a link and a widget need', async () => {
    mount({ annotationStorage: { getValue: vi.fn(), setValue: vi.fn() } });
    await waitFor(() => expect(captured.render).toHaveLength(1));

    const built = only(captured.constructor, 'the layer constructor');
    const rendered = only(captured.render, 'the layer render');
    expect(built.linkService).toBeTruthy();
    expect(rendered.linkService).toBe(built.linkService);
    expect(built.viewport).toBeTruthy();
    expect(rendered.page).toBe(built.page);
    expect(rendered.annotationStorage).toEqual(built.annotationStorage);
    // Widgets are the form half of the clause, and they are opt-in per page: the flag reaches the engine in
    // the render parameters, which is the only place pdf.js reads it from.
    expect(rendered.renderForms).toBe(false);
  });

  it('turns form widgets on when the page asks for them', async () => {
    mount({ renderForms: true });
    await waitFor(() => expect(captured.render).toHaveLength(1));
    expect(only(captured.render, 'the layer render').renderForms).toBe(true);
  });

  /*
   * FR-55: "embedded JavaScript execution remains disabled". The flag is read by pdf.js off the *render*
   * params, not the constructor, and until now the string appeared in no test file — so deleting it from
   * the call would have left the suite green while a document carrying OpenAction JavaScript ran it in the
   * page. Asserted on every call this page makes, because a second render path that forgot the flag is the
   * same hole as the first one having it removed.
   */
  it('disables embedded JavaScript on every annotation-layer render it asks for', async () => {
    mount();
    await waitFor(() => expect(captured.render).toHaveLength(1));
    expect(captured.render.length, 'the page asked for a layer').toBeGreaterThan(0);
    for (const params of captured.render) {
      expect(params.enableScripting, 'a viewer that runs a document’s scripts has made the reader’s file executable').toBe(false);
    }
  });

  it('leaves the annotation layer as the only mark surface on the page', async () => {
    // FR-18's two halves meet here: with the core pen withdrawn, a page must not mount a second overlay for
    // marks of its own. An SVG anywhere in the page box would be that overlay — the engine's own editors
    // append theirs only under an editor layer, which needs a manager this page is not given.
    const { container } = mount();
    await waitFor(() => expect(captured.render).toHaveLength(1));

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[class*="ink"]')).toBeNull();
    expect(container.querySelector('.pjsr-editor-layer')).toBeNull();
  });
});
