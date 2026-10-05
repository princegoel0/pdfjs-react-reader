/*
 * FR-33's thumbnail clause: a card for a page composed from a template composes that template too.
 *
 * The row read that a pure-XFA page "has no painted content of their own", and the consequence for the
 * sidebar is arithmetic: the canvas is the whole card, the canvas holds no operators, so every thumbnail of
 * an XFA form was a blank 132×185 card. `0.8` fixed it by drawing the same tree the page draws and called it
 * browser-verified; `PdfThumbnail.test.tsx` (W8) then covered the canvas, the two observers, the label and
 * the buffer release — everything except the branch. So this is the clause with a fix, a comment and no
 * assertion, which is the shape this repository keeps finding.
 *
 * Four things have to hold for the card to show the form rather than a hole, and each fails a different way:
 *
 *  - the tree is asked for **only** of a page that declares itself composed from one (`getXfa` on a plain
 *    page is a wasted round trip on the hot path of a forty-card sidebar);
 *  - it is laid out at the **card's CSS scale**, not at the display density that sizes the bitmap: the two
 *    differ by `devicePixelRatio`, and a form sized for the buffer is a form whose widgets sit outside the
 *    card — which is why `scale` is held beside the tree rather than recomputed at paint time;
 *  - the composition reads the **document's own `annotationStorage`** at `display` intent, which is what
 *    makes a name typed into the page appear in the sidebar; a copy of the storage would answer an empty
 *    form, and the `print` intent lays the tree out for paper;
 *  - the result is **inert**: it is live DOM inside a `<button>`, so without `inert` plus the tab-order walk
 *    a keyboard reader gets nine copies of a nine-page document's fields, none of them visible.
 *
 * `XfaLayer` is replaced with a recorder that appends the DOM the real layer appends, because the assertions
 * are about what this component asks for and hands where. What a real template *looks like* at 106 px is not
 * this file's question, and belongs to the matrix's `sidebar-thumbs-outline` row, which loads the pure-XFA
 * fixture and reads the card's composed tree, its `inert` state and the fields' tab order in Chromium,
 * Firefox and WebKit. Measured by counterfactual (`.spike/counterfactual-t1f.mjs`, restored byte-for-byte
 * each time, the unmutated tree 18 passed over these three files): dropping the `isPureXfa` gate, swapping
 * the layer scale for the buffer scale, handing `null` for the storage and deleting `host.inert` each fail
 * **one** case here, and the same four mutations were run against a real browser, where dropping the
 * composition, the `inert` flag and the `aria-hidden` each turn the browser row red too.
 *
 * The fifth mutation did not, in either harness, and the reason is worth keeping where someone will read it:
 * replacing the host rather than appending to it (`XfaLayer.render` appends) cannot be observed through this
 * component's own state machine. Every input that would re-run the composition effect — page, rotation,
 * width, density — is also an input to the effect that fetched the tree, and that one's teardown sets the
 * tree to `null`, which unmounts the host. So the second composition always starts from an empty div: the
 * browser, driven through two rotations, still reported one tree with `host.appendChild` in place of
 * `replaceChildren`. What *is* asserted in both harnesses is the end state a reader sees: one form per card,
 * whatever the card has been through, and none once it is abandoned.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { PdfThumbnail } from './PdfThumbnail';

interface XfaCall {
  div: HTMLElement;
  viewport: { width: number; height: number };
  xfaHtml: unknown;
  annotationStorage: unknown;
  intent: string;
  linkService: unknown;
}

const seen = vi.hoisted(() => ({
  rendered: [] as unknown[],
  updated: [] as unknown[],
}));

/** The engine appends a `.xfaLayer` holding the widgets; this appends one with a field and a link in it. */
vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  XfaLayer: {
    render: (params: unknown) => {
      seen.rendered.push(params);
      const { div } = params as { div: HTMLElement };
      const layer = document.createElement('div');
      layer.className = 'xfaLayer';
      const field = document.createElement('input');
      const link = document.createElement('a');
      link.href = 'https://example.com/terms';
      layer.append(field, link);
      div.appendChild(layer);
      return { textDivs: [] };
    },
    update: (params: unknown) => {
      seen.updated.push(params);
    },
  },
}));

/** 200×260 at scale 1, so a 132 px card is at 0.66. */
const BASE = { width: 200, height: 260 };
const TREE = { name: 'template', children: [{ name: 'field', value: 'Prince' }] };

let xfaAsked = 0;

function fakePage(pureXfa: boolean): PDFPageProxy {
  const viewportFor = (scale: number) => ({
    width: BASE.width * scale,
    height: BASE.height * scale,
    clone: () => ({ width: BASE.width * scale, height: BASE.height * scale }),
  });
  return {
    rotate: 0,
    isPureXfa: pureXfa,
    getViewport: ({ scale = 1 }: { scale?: number } = {}) => viewportFor(scale),
    render: () =>
      ({ promise: Promise.resolve(), cancel: () => undefined }) as unknown as RenderTask,
    getXfa: async () => {
      xfaAsked += 1;
      return pureXfa ? (TREE as never) : null;
    },
  } as unknown as PDFPageProxy;
}

function fakeDoc(pureXfa: boolean): PDFDocumentProxy {
  const page = fakePage(pureXfa);
  return {
    numPages: 2,
    getPage: async () => page,
    // A sentinel identity, because the claim is that the card reads *this* document's storage.
    annotationStorage: { size: 1, kind: 'the document’s own' },
  } as unknown as PDFDocumentProxy;
}

/** jsdom ships no IntersectionObserver, and the card paints only once this says it is on screen. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  target: Element | null = null;

  constructor(
    private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void,
    _options: { rootMargin?: string } = {},
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

function setRatio(ratio: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: ratio });
}

function mount(pureXfa: boolean, props: Record<string, unknown> = {}) {
  const doc = fakeDoc(pureXfa);
  const view = render(
    <PdfThumbnail doc={doc} pageNumber={1} width={132} {...props} />,
  );
  // The card is the observed element; reporting it as on screen is what starts the work.
  const observer = FakeIntersectionObserver.instances.at(-1);
  act(() => observer?.fire(true));
  return { doc, view, host: () => view.container.querySelector<HTMLElement>('.pjsr-thumbnail-xfa') };
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  FakeIntersectionObserver.instances.length = 0;
  seen.rendered.length = 0;
  seen.updated.length = 0;
  xfaAsked = 0;
  setRatio(1);
});

afterEach(() => {
  cleanup();
  setRatio(1);
});

describe('a thumbnail of a page composed from a template (FR-33)', () => {
  it('composes the tree for a pure-XFA page, and asks no tree of a page that paints itself', async () => {
    const { host } = mount(true);
    await waitFor(() => expect(seen.rendered).toHaveLength(1));

    const layer = seen.rendered[0] as XfaCall;
    expect((layer as unknown as { xfaHtml: unknown }).xfaHtml).toBe(TREE);
    expect(host(), 'the card has no layer to compose onto').not.toBeNull();
    expect(host()?.getAttribute('aria-hidden')).toBe('true');
    expect(xfaAsked).toBe(1);

    cleanup();
    const composedBefore = seen.rendered.length;
    const plain = mount(false);
    await act(async () => undefined);
    expect(xfaAsked, 'a plain page was asked for a template it does not have').toBe(1);
    expect(seen.rendered, 'a plain page composed a template anyway').toHaveLength(composedBefore);
    expect(plain.host(), 'a plain page grew an XFA layer').toBeNull();
  });

  it('lays the form out at the card’s CSS scale while the bitmap uses the display density', async () => {
    setRatio(2);
    mount(true);
    await waitFor(() => expect(seen.rendered).toHaveLength(1));

    const layer = seen.rendered[0] as XfaCall;
    // 132 / 200 = 0.66. The canvas buffer is twice that because the display says it should be; the form is
    // DOM, so multiplying its scale by the density would push every widget out of the card.
    expect(layer.viewport.width).toBeCloseTo(132, 6);
    expect(layer.viewport.height).toBeCloseTo(171.6, 1);
    const canvas = document.querySelector<HTMLCanvasElement>('.pjsr-thumbnail-canvas');
    expect(canvas?.width, 'the buffer stopped following the display density').toBe(264);
  });

  it('reads the document’s own storage at display intent, which is what makes a typed name show up', async () => {
    const { doc } = mount(true);
    await waitFor(() => expect(seen.rendered).toHaveLength(1));
    const layer = seen.rendered[0] as XfaCall;

    expect(layer.annotationStorage, 'the card was handed a copy, so it reads an empty form').toBe(
      doc.annotationStorage,
    );
    expect(layer.intent).toBe('display');
    expect(layer.linkService).toBeNull();
  });

  it('keeps the composed form out of the tab order and out of the accessibility tree', async () => {
    const { host } = mount(true);
    await waitFor(() => expect(seen.rendered).toHaveLength(1));

    const layerHost = host()!;
    const focusable = layerHost.querySelectorAll<HTMLElement>('input, a[href]');
    expect(focusable.length, 'the layer appended no widgets to walk').toBeGreaterThan(0);
    for (const field of focusable) {
      expect(field.tabIndex, 'a card field is tabbable').toBe(-1);
    }
    // `inert` is the part modern engines act on; the walk is the part the others get.
    expect(layerHost.inert, 'the host was not marked inert').toBe(true);
    expect(layerHost.getAttribute('aria-hidden')).toBe('true');
  });

  it('re-composes one form when the card is turned, and leaves none when it goes away', async () => {
    const { view } = mount(true);
    await waitFor(() => expect(seen.rendered).toHaveLength(1));
    expect(document.querySelectorAll('.pjsr-thumbnail-xfa .xfaLayer')).toHaveLength(1);

    /*
     * The end state, which is what a card shows: `XfaLayer.render` appends, so *whatever* the card has been
     * through — turned, re-sized, handed a different document — exactly one form may be inside it. Whether
     * the host is cleared before each composition or merely happens to be empty is not observable here (see
     * this file's header), but two forms in one card would be, and that is what fails.
     */
    act(() => view.rerender(<PdfThumbnail doc={fakeDoc(true)} pageNumber={1} width={132} rotation={90} />));
    await waitFor(() => expect(seen.rendered).toHaveLength(2));
    const layers = document.querySelectorAll('.pjsr-thumbnail-xfa .xfaLayer');
    expect(layers, 'the card holds two copies of its form').toHaveLength(1);

    cleanup();
    expect(document.querySelectorAll('.xfaLayer').length, 'the card took its form down with it').toBe(0);
  });

  it('drops the composed form when the sidebar abandons the card', async () => {
    const controller = new AbortController();
    const { host } = mount(true, { signal: controller.signal });
    await waitFor(() => expect(seen.rendered).toHaveLength(1));
    expect(host()?.querySelector('.xfaLayer')).not.toBeNull();

    // Scrolling a card out of range and a host cancelling run the same teardown. It goes further than the
    // layer: the canvas effect's own `stop()` drops the tree it was composed from, so the host — which only
    // exists while a page has a template to show — comes away with it. What must not survive is the form.
    act(() => controller.abort());
    await waitFor(() => expect(document.querySelector('.pjsr-thumbnail-xfa')).toBeNull());
    expect(document.querySelectorAll('.xfaLayer'), 'the abandoned card kept its form').toHaveLength(0);
  });
});
