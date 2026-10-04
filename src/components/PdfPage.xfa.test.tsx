/*
 * FR-33's clause that had a measured comment and no assertion: a viewport change updates the XFA layer
 * rather than re-appending it.
 *
 * `XfaLayer.render` *appends* a whole tree to the container it is handed, so calling it twice into one div
 * doubles the page — measured at 20 elements, then 40 — and a rebuild also costs the field the reader is
 * typing into. `XfaLayer.update` is the re-render path, and the page keeps the div across viewport changes
 * so that is the one it can take.
 *
 * This matters most on the documents where it is the only thing on screen: a pure-XFA page's canvas holds no
 * operators at all, so the DOM tree *is* the page. A zoom that re-appended would leave a reader looking at
 * two copies of their own form.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { PdfPage } from './PdfPage';
import { createPdfLinkService } from '../lib/link-service';

const calls = vi.hoisted(() => ({
  render: [] as unknown[],
  update: [] as unknown[],
}));

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
  XfaLayer: {
    render: (params: unknown) => {
      calls.render.push(params);
      // The real layer appends its tree into `params.div`, which is the behaviour that makes a second
      // `render` a doubled page rather than a replaced one — and hands back the *bare text nodes* it put
      // there, which is what `wrapXfaText` turns into spans so a search mark has something to wrap.
      const div = (params as { div: HTMLElement }).div;
      const layer = document.createElement('div');
      layer.className = 'xfaLayer';
      const text = document.createTextNode('Total');
      layer.append(text);
      div.appendChild(layer);
      return { textDivs: [text] };
    },
    update: (params: unknown) => {
      calls.update.push(params);
    },
  },
}));

const xfaHtml = {
  xmlns: 'http://www.xfa.org/schema/xfa-template/3.9/',
  children: [],
};

function pageProxy(): PDFPageProxy {
  const viewportFor = (scale: number) => {
    const box = { width: 612 * scale, height: 792 * scale };
    return { ...box, clone: () => ({ ...box }) };
  };
  return {
    rotate: 0,
    isPureXfa: true,
    filterFactory: {},
    getViewport: ({ scale = 1 }: { scale?: number } = {}) => viewportFor(scale),
    streamTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: async () => [],
    getXfa: async () => xfaHtml,
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  } as unknown as PDFPageProxy;
}

const doc = {
  numPages: 1,
  getPage: async () => pageProxy(),
  getOptionalContentConfig: async () => ({}),
} as unknown as PDFDocumentProxy;

const linkService = createPdfLinkService();

async function mount(scale: number, rotation = 0) {
  const view = render(
    <PdfPage
      doc={doc}
      pageNumber={1}
      scale={scale}
      rotation={rotation}
      linkService={linkService}
      className="pjsr-page-canvas"
    />,
  );
  await act(async () => undefined);
  await act(async () => undefined);
  return view;
}

/** The container the page owns for the XFA tree, and how many copies of the form are in it. */
function xfaHost(): HTMLElement | null {
  return document.querySelector('.pjsr-xfa-layer');
}

afterEach(() => {
  cleanup();
  calls.render.length = 0;
  calls.update.length = 0;
});

describe('FR-33: a viewport change updates the XFA layer instead of re-appending it', () => {
  it('renders the tree once, into a div the page keeps', async () => {
    await mount(1);

    expect(calls.render).toHaveLength(1);
    expect(calls.update).toHaveLength(0);
    expect(xfaHost()?.querySelectorAll('.xfaLayer')).toHaveLength(1);
  });

  it('updates rather than renders on a zoom, and the page is not there twice', async () => {
    const { rerender } = await mount(1);

    rerender(
      <PdfPage
        doc={doc}
        pageNumber={1}
        scale={1.5}
        rotation={0}
        linkService={linkService}
        className="pjsr-page-canvas"
      />,
    );
    await act(async () => undefined);
    await act(async () => undefined);

    expect(calls.render, 'a zoom re-appended the whole tree').toHaveLength(1);
    expect(calls.update).toHaveLength(1);
    expect(xfaHost()?.querySelectorAll('.xfaLayer')).toHaveLength(1);
    // The viewport the update was handed is the new one, or the layer sits at the old size.
    const params = calls.update[0] as { viewport: { width: number } };
    expect(params.viewport.width).toBe(612 * 1.5);
  });

  it('updates on a rotation too, which is the other thing a reader does to a viewport', async () => {
    const { rerender } = await mount(1);

    rerender(
      <PdfPage
        doc={doc}
        pageNumber={1}
        scale={1}
        rotation={90}
        linkService={linkService}
        className="pjsr-page-canvas"
      />,
    );
    await act(async () => undefined);
    await act(async () => undefined);

    expect(calls.render).toHaveLength(1);
    expect(calls.update).toHaveLength(1);
    expect(xfaHost()?.querySelectorAll('.xfaLayer')).toHaveLength(1);
  });

  /*
   * The other clause on the same tree: a search mark has to land on it. `XfaLayer.render` hands back bare
   * text nodes, and a mark cannot wrap one without replacing it — which would detach every reference the
   * next `update` holds — so the page gives each run its own span and highlights those. Without the wrap the
   * document searches, the count reads "1 of 4", and the page shows nothing.
   */
  it('marks a search hit inside the XFA tree, not on a text layer the page never built', async () => {
    render(
      <PdfPage
        doc={doc}
        pageNumber={1}
        scale={1}
        linkService={linkService}
        className="pjsr-page-canvas"
        highlights={[
          { pageIndex: 0, beginIdx: 0, beginOffset: 0, endIdx: 0, endOffset: 5 },
        ]}
      />,
    );
    await act(async () => undefined);
    await act(async () => undefined);

    const marks = [...(xfaHost()?.querySelectorAll('mark') ?? [])];
    expect(marks.map((m) => m.textContent)).toEqual(['Total']);
    // And the run it wrapped is still the layer's own text, now inside the span rather than replacing it.
    expect(xfaHost()?.querySelector('.xfaLayer')?.textContent).toBe('Total');
  });
});
