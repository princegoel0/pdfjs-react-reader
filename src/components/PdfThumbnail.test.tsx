/*
 * FR-11: the page strip, under automated test for the first time.
 *
 * The requirement makes three claims and each one is a number or a class rather than a pixel, which is why
 * jsdom can hold them: a miniature is painted at *the card's measured CSS width times the device pixel ratio*,
 * the *visible range is tracked*, and the current page's card is *highlighted*. Until now the only evidence was
 * one browser check on one engine, so a card that went back to a hard-coded width, or that painted every page
 * of a four-hundred-page document at once, or that stopped marking the page on screen, would have failed
 * nothing in CI.
 *
 * What this file deliberately does not do is measure a painted thumbnail: `canvas.getContext` in jsdom answers
 * nothing, so the claim "the pixels are the page" belongs to `scripts/browser-matrix.mjs`'s
 * `sidebar-thumbs-outline` row, which reads real ink. What belongs here is the arithmetic that decides whether
 * those pixels are crisp — `canvas.width` against the width the card was given and the density it was given at —
 * and the bookkeeping around it: the observer that gates painting, the buffer that goes back when a card
 * scrolls out, and the class and the `aria-current` that say which card is the page you are on.
 *
 * Both observers are installed by this file, because jsdom ships neither, and a stub that records what it was
 * handed is the only way to assert the *margin* the range watches and the *column* the list measured.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { PdfThumbnail } from './PdfThumbnail';
import { ThumbnailList } from './ThumbnailList';
import { ViewerProvider } from './ViewerContext';
import type { ViewerController } from './ViewerController';
import { DEFAULT_LABELS, formatLabel } from '../lib/labels';

/** The page box the fake hands back at scale 1: 200×260, so a card 132 wide is at scale 0.66. */
const BASE = { width: 200, height: 260 };

/** Every `page.render()` call the components made, in order, with what they passed. */
let renders: Array<{ canvas: HTMLCanvasElement; viewport: { width: number; height: number } }> = [];
let cancels: Array<() => void> = [];

function fakePage(): PDFPageProxy {
  return {
    rotate: 0,
    isPureXfa: false,
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: BASE.width * scale,
      height: BASE.height * scale,
      clone: () => ({ width: 0, height: 0 }),
    }),
    render: (options: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => {
      renders.push(options);
      const task = {
        promise: Promise.resolve(),
        cancel: () => cancels.push(task.cancel as () => void),
      };
      return task as unknown as RenderTask;
    },
    getXfa: async () => null,
  } as unknown as PDFPageProxy;
}

function fakeDoc(numPages: number): PDFDocumentProxy {
  const page = fakePage();
  return {
    numPages,
    getPage: async () => page,
    annotationStorage: null,
  } as unknown as PDFDocumentProxy;
}

/**
 * The intersection watcher, recorded rather than faked away.
 *
 * `fire` answers for the element it was constructed against, which is the card's own button, so a test says
 * "this card is now on screen" the way the browser would — by handing the callback an entry — and reads back
 * the margin the component asked to watch.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  rootMargin = '';
  target: Element | null = null;

  constructor(
    private readonly callback: (entries: Array<{ isIntersecting: boolean }>, observer: unknown) => void,
    options: { rootMargin?: string } = {},
  ) {
    this.rootMargin = options.rootMargin ?? '';
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.target = el;
  }

  disconnect(): void {
    this.target = null;
  }

  unobserve(): void {}

  /** Reports what the browser reports when the card crosses the boundary it was set at. */
  fire(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }], this);
  }
}

/** The list's column measurer: a test names the width the sidebar has, and the list works out the card. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: (entries: Array<{ contentRect: { width: number } }>) => void;

  constructor(cb: (entries: Array<{ contentRect: { width: number } }>) => void) {
    this.callback = cb;
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {}

  unobserve(): void {}

  /** `width` is the list's own content box, which is what `ThumbnailList` divides into columns. */
  resizeTo(width: number): void {
    this.callback([{ contentRect: { width } }]);
  }
}

function setRatio(ratio: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: ratio });
}

function controllerFor(state: {
  doc: PDFDocumentProxy;
  numPages: number;
  currentPage: number;
  scrollToPage: (page: number) => void;
}): ViewerController {
  return {
    doc: state.doc,
    numPages: state.numPages,
    currentPage: state.currentPage,
    rotation: 0,
    pageRotations: {},
    scrollToPage: state.scrollToPage,
  } as unknown as ViewerController;
}

beforeEach(() => {
  renders = [];
  cancels = [];
  FakeIntersectionObserver.instances = [];
  FakeResizeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // jsdom implements neither, and the list calls the second one on the active card.
  Element.prototype.scrollIntoView = vi.fn();
  setRatio(1);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setRatio(1);
});

/** Brings one card on screen so it paints, and lets the render settle. */
async function reveal(observer: FakeIntersectionObserver, pageNumber: number): Promise<void> {
  act(() => observer.fire(true));
  await waitFor(() => expect(renders.some((call) => call.viewport.width > 0), `page ${pageNumber} never painted`).toBe(true));
}

describe('the buffer a card paints into (FR-11)', () => {
  it('sizes it at the width it was given times the display density, and not at the page box', async () => {
    setRatio(2);
    const doc = fakeDoc(1);
    const view = render(<PdfThumbnail doc={doc} pageNumber={1} width={132} />);
    const observer = FakeIntersectionObserver.instances[0];
    if (!observer) throw new Error('the card installed no intersection watcher');
    await reveal(observer, 1);

    /*
     * 132 CSS px at dpr 2 is a 264-px buffer, and the height follows the page's own ratio rather than the
     * card's: 260/200 of 264 is 343. A card that painted at the page box (200×260) would be a blurry thumbnail
     * on a wide sidebar and a wasted 100 px on a narrow one, and both mistakes show up in this pair of numbers.
     */
    const canvas = view.container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect([canvas?.width, canvas?.height]).toEqual([264, 343]);
    expect(renders[0]?.viewport.width).toBeCloseTo(264, 5);
    // The box the buffer is drawn into stays in CSS pixels, which is what keeps the grid from doubling.
    expect(canvas?.style.width).toBe('');
  });

  it('repaints at the new density when the display moves, rather than leaving a 1× card on a 2× panel', async () => {
    const doc = fakeDoc(1);
    const view = render(<PdfThumbnail doc={doc} pageNumber={1} width={132} />);
    const observer = FakeIntersectionObserver.instances[0];
    if (!observer) throw new Error('the card installed no intersection watcher');
    await reveal(observer, 1);
    expect(view.container.querySelector('canvas')?.width).toBe(132);

    setRatio(2);
    // The hub's `resize` channel is the one jsdom can drive; the media-query channel is proven in dpr.test.ts.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(view.container.querySelector('canvas')?.width).toBe(264));
    expect(renders).toHaveLength(2);
  });

  it('paints the column the list measured, not the width the host handed it', async () => {
    const doc = fakeDoc(2);
    const view = render(
      <ViewerProvider controller={controllerFor({ doc, numPages: 2, currentPage: 1, scrollToPage: vi.fn() })}>
        <ThumbnailList />
      </ViewerProvider>,
    );

    const observer = FakeResizeObserver.instances[0];
    if (!observer) throw new Error('the list installed no size watcher');
    // One column of a 200 px content box wants to be 200 px; the grid caps a card at 168.
    act(() => observer.resizeTo(200));
    await act(async () => undefined);
    const first = FakeIntersectionObserver.instances[0];
    if (!first) throw new Error('the first card installed no intersection watcher');
    await reveal(first, 1);
    const canvas = view.container.querySelector('canvas');
    expect(canvas?.width).toBe(168);

    /*
     * Two columns of a 300 px box, minus the 12 px gap between them: (300 - 12) / 2 = 144. Waited for on the
     * buffer rather than on `renders`, because the earlier 168-px paint is already in that list and a check
     * that passes on the old call would pass whether or not the new column was followed.
     */
    act(() => observer.resizeTo(300));
    await waitFor(() => expect(canvas?.width).toBe(144));
  });
});

describe('the range a card watches (FR-11)', () => {
  it('paints nothing until the card is within 300 px of the sidebar viewport', async () => {
    const doc = fakeDoc(1);
    render(<PdfThumbnail doc={doc} pageNumber={1} width={132} />);
    const observer = FakeIntersectionObserver.instances[0];
    if (!observer) throw new Error('the card installed no intersection watcher');

    // The mount itself must not fetch and paint: a forty-card strip that paints on mount renders forty
    // pages before the reader has scrolled to any of them.
    await act(async () => undefined);
    expect(renders, 'a card off screen painted anyway').toHaveLength(0);
    expect(observer.rootMargin).toBe('300px 0px');

    act(() => observer.fire(true));
    await waitFor(() => expect(renders).toHaveLength(1));
  });

  it('gives the buffer back when the card leaves the range, and cancels what was in flight', async () => {
    const doc = fakeDoc(1);
    const view = render(<PdfThumbnail doc={doc} pageNumber={1} width={132} />);
    const observer = FakeIntersectionObserver.instances[0];
    if (!observer) throw new Error('the card installed no intersection watcher');
    await reveal(observer, 1);
    const canvas = view.container.querySelector('canvas');
    expect(canvas?.width).toBe(132);

    act(() => observer.fire(false));
    await act(async () => undefined);
    // Zeroing the buffer is how a scrolled-away card actually returns its memory; removing the element would
    // not, and a strip that never gives back is the leak §6's profile D is about.
    expect([canvas?.width, canvas?.height]).toEqual([0, 0]);
    expect(cancels).toHaveLength(1);
  });

  it('keeps the current page’s card in view as pages turn, and does not yank the strip for the others', async () => {
    const doc = fakeDoc(3);
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    const strip = (currentPage: number) => (
      <ViewerProvider controller={controllerFor({ doc, numPages: 3, currentPage, scrollToPage: vi.fn() })}>
        <ThumbnailList />
      </ViewerProvider>
    );
    const view = render(strip(1));
    await act(async () => undefined);
    scrollIntoView.mockClear();

    view.rerender(strip(3));
    await act(async () => undefined);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    const card = view.container.querySelector('[data-page="3"]');
    expect(scrollIntoView.mock.instances[0], 'the wrong card was dragged into view').toBe(card);
  });
});

describe('the card that says which page you are on (FR-11)', () => {
  it('marks the current page and nothing else, and says so to a screen reader', async () => {
    const doc = fakeDoc(3);
    const scrollToPage = vi.fn();
    const view = render(
      <ViewerProvider controller={controllerFor({ doc, numPages: 3, currentPage: 2, scrollToPage })}>
        <ThumbnailList />
      </ViewerProvider>,
    );
    await act(async () => undefined);

    const active = view.container.querySelector('[data-page="2"]');
    expect(active?.className).toContain('pjsr-thumbnail--active');
    expect(active?.getAttribute('aria-current')).toBe('true');
    const others = [...view.container.querySelectorAll('[data-page]')].filter((el) => el !== active);
    expect(others).toHaveLength(2);
    for (const card of others) {
      expect(card.className).not.toContain('pjsr-thumbnail--active');
      expect(card.getAttribute('aria-current')).toBeNull();
    }
    expect(active?.getAttribute('aria-label')).toBe(formatLabel(DEFAULT_LABELS.goToPage, { page: 2 }));
  });

  it('sends a click to the page it stands for', async () => {
    const doc = fakeDoc(3);
    const scrollToPage = vi.fn();
    const view = render(
      <ViewerProvider controller={controllerFor({ doc, numPages: 3, currentPage: 1, scrollToPage })}>
        <ThumbnailList />
      </ViewerProvider>,
    );
    await act(async () => undefined);

    const card = view.container.querySelector<HTMLButtonElement>('[data-page="3"]');
    if (!card) throw new Error('the strip stopped carrying a card for page 3');
    act(() => card.click());
    expect(scrollToPage).toHaveBeenCalledWith(3);
  });
});
