/*
 * FR-28 with a document on screen: the parts read the controller, and the keyboard affordance moves a page.
 *
 * Every other shell mount in this repository hands the controller `doc: null, isReady: false`, which is why
 * two legs of the clause went unasserted: `ViewerController.affordances.test.tsx` could only test the
 * keyboard's *claim* ("with no document mounted the page cannot move"), and the parts could be shown to
 * render but never shown reading a number that came from a document. That was `#175`, recorded as a hang —
 * mounting the real controller against a finished load was killed at 60 s and at 120 s with no output.
 *
 * Measured 2026-10-06, the hang is gone and what remains is two API gaps and one missing observer, all of
 * them the harness's to answer:
 *
 *  - jsdom ships no `ResizeObserver`, and the shell measures its viewport with one;
 *  - jsdom's `clientWidth`/`clientHeight`/`scrollTop` are 0 and `scrollTo` is unimplemented, so the
 *    virtualizer's loop — `scrollToPage` writes a scroll position, the scroll listener reads it back — never
 *    turns. The pair is faked here at the prototype level, the way `ViewerPages.paint.test.tsx` fakes the two
 *    fit measurements;
 *  - jsdom's `getContext('2d')` returns `null`, which pdf.js's text layer puts into a `WeakMap`.
 *
 * What is *not* real in this file, and stays the browser matrix's: the engine itself. Loading actual bytes
 * under Node fails fast rather than hanging, on two methods the engine calls that V8 ships and Node does not
 * — `Uint8Array.prototype.toHex` (measured: `typeof` it is `undefined` on Node v24.21.0) in the catalog's
 * fingerprint path, and `Map.prototype.getOrInsertComputed` behind it. So the document here is a hand-built
 * page proxy, the same class of stand-in the nine `PdfPage.*` files and `a11y.page.test.tsx` already use, and
 * the paint remains measured in three engines rather than asserted here.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import { useViewerController } from './ViewerController';
import { ViewerLayout } from './ViewerLayout';
import { ViewerProvider } from './ViewerContext';
import { DEFAULT_LABELS } from '../lib/labels';

const NUM_PAGES = 4;
/** A 612×792 page at scale 1 in a 800×600 viewport is 612 wide and 792 tall, plus the gap between rows. */
const PAGE_HEIGHT = 792;
const ROW_PITCH = 808;

/**
 * An observer that reports, because the stub the other shell files install never calls back and a viewport
 * that is never measured leaves every fit mode holding its last scale.
 */
class ReportingObserver {
  private targets = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {}
  observe(element: Element) {
    this.targets.add(element);
    queueMicrotask(() => {
      if (!this.targets.has(element)) return;
      // A real entry, not an empty call: `ThumbnailList.tsx:30` and the toolbar's sizer both read
      // `entries[0].contentRect.width`, and handing them `undefined` throws outside the test's own frames —
      // it surfaces as an unhandled error rather than a failure, which is how this was first found.
      const entry = {
        target: element,
        contentRect: { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 },
        borderBoxSize: [{ inlineSize: 800, blockSize: 600 }],
        contentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
        devicePixelContentBoxSize: [{ inlineSize: 800, blockSize: 600 }],
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    });
  }
  unobserve(element: Element) {
    this.targets.delete(element);
  }
  disconnect() {
    this.targets.clear();
  }
}
globalThis.ResizeObserver = ReportingObserver as unknown as typeof ResizeObserver;

/**
 * jsdom ships no `IntersectionObserver` either, and `PdfThumbnail.tsx:75` builds one per row, so an opened
 * sidebar dies at construction without a stub of some kind. Whether it reports is not load-bearing: the rows
 * this file counts are mounted by the list, and the observer only decides when each one paints — shown by
 * making the stub never report and the three cases still pass. Painting a thumbnail is the browser pass's.
 */
class IdleObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
globalThis.IntersectionObserver = IdleObserver as unknown as typeof IntersectionObserver;

/** Neither `scrollIntoView` (`ThumbnailList.tsx:45`, `PdfPage.tsx:1029`) nor a scroll box exists in jsdom. */
Element.prototype.scrollIntoView = function scrollIntoView() {};

/** The scroll pair the virtualizer needs: one writes, the other reads it back on the next frame. */
let scrollWrite = 0;
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
  configurable: true,
  get: () => scrollWrite,
  set(value: number) {
    scrollWrite = value;
  },
});
Element.prototype.scrollTo = function scrollTo(this: Element, options?: ScrollToOptions | number) {
  this.scrollTop = typeof options === 'number' ? options : (options?.top ?? 0);
  this.dispatchEvent(new Event('scroll'));
};

const realGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function patched(
  this: HTMLCanvasElement,
  kind: string,
  ...rest: unknown[]
) {
  const context = realGetContext.apply(this, [kind, ...rest] as never);
  if (context || kind !== '2d') return context;
  return { canvas: this, font: '', measureText: (text: string) => ({ width: text.length * 6 }) };
} as typeof HTMLCanvasElement.prototype.getContext;

function fakePage(): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    imageResources: {},
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 612 * scale,
      height: PAGE_HEIGHT * scale,
      scale,
      rotation: 0,
      rawDims: { pageWidth: 612, pageHeight: PAGE_HEIGHT, pageX: 0, pageY: 0 },
      clone() {
        return this;
      },
      convertToViewportPoint: (x: number, y: number) => [x, PAGE_HEIGHT - y],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    // A `ReadableStream` of `{items, styles}`, which is what the engine actually hands the text layer.
    streamTextContent: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue({ items: [], styles: {} });
          controller.close();
        },
      }),
    getAnnotations: async () => [],
    getOperatorList: async () => ({ promise: Promise.resolve() }),
    getXfa: async () => null,
    cleanup: vi.fn(),
  } as unknown as PDFPageProxy;
}

/** One document, shared: a literal built inside the mock re-runs every effect on every render. */
const fakeDoc = {
  numPages: NUM_PAGES,
  getPage: async () => fakePage(),
  getOptionalContentConfig: async () => ({}),
  getOutline: async () => null,
  getPageLabels: async () => null,
  getMetadata: async () => ({ info: {}, metadata: null }),
  cleanup: () => {},
} as unknown as PDFDocumentProxy;

vi.mock('../headless/usePdfDocument', () => ({
  usePdfDocument: () => ({
    status: 'ready',
    doc: fakeDoc,
    numPages: NUM_PAGES,
    isReady: true,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: vi.fn(),
  }),
}));

const pageChanges = vi.hoisted(() => vi.fn());

afterEach(() => {
  cleanup();
  scrollWrite = 0;
  pageChanges.mockClear();
});

interface ShellOptions {
  enableKeyboardNavigation?: boolean;
  onPageChange?: (page: number) => void;
}

function mount(options: ShellOptions = {}) {
  /**
   * The controller is rebuilt on every render, so the instance this function returned would be the one from
   * the mount and `currentPage` on it would never move — the same reason the gesture files keep a module-level
   * `seen` rather than a captured value.
   */
  const live: { current: ReturnType<typeof useViewerController> | null } = { current: null };
  function Shell() {
    live.current = useViewerController({
      src: '/fixtures/outline-sample.pdf',
      labels: { ...DEFAULT_LABELS },
      defaultScale: 1,
      defaultSidebarOpen: true,
      ...options,
    });
    return (
      <ViewerProvider controller={live.current}>
        <ViewerLayout controller={live.current} />
      </ViewerProvider>
    );
  }
  let view: ReturnType<typeof render> | null = null;
  act(() => {
    view = render(<Shell />);
  });
  if (!live.current) throw new Error('the shell never built its controller');
  return { view: view!, controller: () => live.current! };
}

/** Whatever the chrome currently says about where the reader is. */
function chrome(view: ReturnType<typeof render>) {
  const container = view.container;
  return {
    slots: container.querySelectorAll('.pjsr-page-slot').length,
    pages: container.querySelectorAll('.pjsr-page').length,
    pageInput: container.querySelector<HTMLInputElement>('.pjsr-page-input')?.value,
    count: container.querySelector('.pjsr-page-count')?.textContent?.trim(),
    thumbnails: container.querySelectorAll('.pjsr-thumbnail').length,
  };
}

async function pressKey(element: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    element.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return event;
}

describe('FR-28: the composed shell against a document that has finished loading', () => {
  it('has every part read the one controller, with a document behind it', () => {
    const { view } = mount();
    const seen = chrome(view);
    // The bar shows the document's size and the reader's place, the frame holds the pages the virtualizer
    // chose, and the sidebar's thumbnail list covers all four — three parts, one state, no prop passed.
    expect(seen.count).toBe(`of ${NUM_PAGES}`);
    expect(seen.pageInput).toBe('1');
    expect(seen.thumbnails).toBe(NUM_PAGES);
    expect(seen.pages).toBeGreaterThan(0);
    expect(seen.pages).toBeLessThan(NUM_PAGES);
  });

  it('moves the page for real when the keyboard affordance is left on', async () => {
    const { view, controller } = mount({ onPageChange: pageChanges });
    const before = chrome(view);
    expect(controller().currentPage).toBe(1);

    const root = view.container.querySelector('.pjsr-viewer')!;
    const event = await pressKey(root, 'PageDown');

    // The leg `ViewerController.affordances.test.tsx` could only reach as far as `defaultPrevented`: here the
    // reader actually moved, the chrome moved with them, and the host was told.
    expect(event.defaultPrevented, 'an enabled affordance claims the key').toBe(true);
    expect(scrollWrite, 'one page of pitch beyond the first row').toBe(ROW_PITCH);
    expect(controller().currentPage).toBe(2);
    expect(chrome(view).pageInput).toBe('2');
    expect(chrome(view).pages, 'the next row comes on screen as the reader arrives').toBeGreaterThan(before.pages);
    expect(pageChanges.mock.calls.flat(), 'the typed event sees the move').toEqual([2]);
  });

  it('leaves the reader where they were when the keyboard affordance is refused', async () => {
    const { view, controller } = mount({
      enableKeyboardNavigation: false,
      onPageChange: pageChanges,
    });

    const root = view.container.querySelector('.pjsr-viewer')!;
    const event = await pressKey(root, 'PageDown');

    expect(event.defaultPrevented, 'a refused key belongs to the host page').toBe(false);
    expect(scrollWrite).toBe(0);
    expect(controller().currentPage).toBe(1);
    expect(chrome(view).pageInput).toBe('1');
    expect(pageChanges).not.toHaveBeenCalled();
  });
});
