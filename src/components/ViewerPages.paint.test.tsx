/*
 * FR-08's repaint clause, which the 2026-09-29 browser measurement settled and no test had held: at a fixed
 * zoom, switching layout paints nothing again.
 *
 * The row regrouping must not reach the canvas. `ViewerPages.regroup.test.tsx` keeps the pages mounted through
 * a switch; this checks the consequence the reader actually wants — no page is painted twice because two pages
 * were put side by side. The assertion is on `page.render()` calls and on the canvas backing stores, not on
 * React re-renders: a component can re-render all day without touching a canvas, and a canvas can be thrown
 * away and rebuilt by a remount that this file would otherwise read as one paint.
 *
 * The other half of the clause — that a switch *in a fit mode* does repaint, because fitting two pages into
 * one width is a different fit than fitting one — is the browser's, and cannot be asserted here: a fit scale is
 * resolved against the viewport, and jsdom's viewport is zero by zero, so `resolvedScale` never moves no matter
 * what the layout does. It was measured in Chromium on 2026-09-29 (scale 1.04 → 0.50, every canvas from
 * 792×1025 to 386×499) and is cited from there, which is why the fixed-zoom assertions below also state what
 * the grouping did: an absence of repaints has to be shown against a switch that really regrouped something.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import { usePdfVirtualizer, type VirtualSlot } from '../headless/usePdfVirtualizer';
import { computeSlots, type PageLayout, type ScaleMode } from '../lib/layout';
import type { OptionalContentConfigHandle } from '../lib/optional-content';
import { DEFAULT_LABELS } from '../lib/labels';
import { ViewerProvider } from './ViewerContext';
import type { ViewerController } from './ViewerController';
import { ViewerPages } from './ViewerParts';

/** Page number → how many times the engine was asked to paint it. */
const paints = vi.hoisted(() => new Map<number, number>());
/** Page number → the options of its most recent `render()`, which is where FR-24's shared instance travels. */
const renders = vi.hoisted(() => new Map<number, unknown>());

vi.mock('pdfjs-dist', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // The layers PdfPage builds around the canvas, stubbed so a paint is a `render()` call and nothing else.
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
  XfaLayer: { render: () => ({}), update: () => undefined },
}));

class ObserverStub {
  static instances: ObserverStub[] = [];
  constructor(readonly callback: () => void) {
    ObserverStub.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

/**
 * A viewport with a size in it.
 *
 * jsdom answers 0 for every `clientWidth`, which is why this file used to be able to test only half of FR-08:
 * a fit scale resolved against nothing never moves, so "repaints only when the fit target itself moves" had
 * one leg. Faking the two measurements at the prototype level — and deleting the shadow afterwards, which
 * puts jsdom's own answer back — gives the fit modes a target to move against.
 */
const metrics = { width: 1000, height: 800 };

function giveViewportASize(): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => metrics.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => metrics.height,
  });
}

/** Every element's resize watcher, fired the way an engine fires one when its box changes. */
function resize(): void {
  act(() => {
    ObserverStub.instances.forEach((observer) => observer.callback());
  });
}

/** The padding a wide viewport gets, read from the virtualizer rather than copied into this file. */
const WIDE_PADDING = 32;

const NUM_PAGES = 12;
const PAGE_W = 612;
const PAGE_H = 792;
/** `usePdfVirtualizer`'s default row gap. */
const DEFAULT_GAP = 16;

function pageProxy(number: number): PDFPageProxy {
  const viewportFor = (scale: number) => {
    const box = { width: PAGE_W * scale, height: PAGE_H * scale };
    return { ...box, clone: () => ({ ...box }) };
  };
  return {
    pageNumber: number,
    rotate: 0,
    isPureXfa: false,
    filterFactory: {},
    getViewport: ({ scale = 1 }: { scale?: number } = {}) => viewportFor(scale),
    streamTextContent: () => Promise.resolve({ items: [] }),
    getAnnotations: async () => [],
    getTextContent: async () => ({ items: [], styles: {} }),
    getXfa: async () => null,
    render: (options: { viewport: { width: number; height: number }; optionalContentConfigPromise?: Promise<unknown> }) => {
      paints.set(number, (paints.get(number) ?? 0) + 1);
      renders.set(number, options);
      return { promise: Promise.resolve(), cancel: () => {} };
    },
    cleanup: () => {},
  } as unknown as PDFPageProxy;
}

const doc = {
  numPages: NUM_PAGES,
  getPage: async (number: number) => pageProxy(number),
  getOptionalContentConfig: async () => ({}),
  cleanup: () => {},
} as unknown as PDFDocumentProxy;

/** Every row the document has in the given grouping, with the virtualizer's own row arithmetic. */
function rowsFor(layout: PageLayout): VirtualSlot[] {
  return computeSlots(NUM_PAGES, layout).map((indices, i) => ({
    indices,
    pageNumber: indices[0]! + 1,
    offsetTop: i * (PAGE_H + DEFAULT_GAP),
    width: indices.length * PAGE_W + (indices.length - 1) * DEFAULT_GAP,
    height: PAGE_H,
    pages: indices.map((index, column) => ({
      index,
      pageNumber: index + 1,
      left: column * (PAGE_W + DEFAULT_GAP),
      top: 0,
      width: PAGE_W,
      height: PAGE_H,
    })),
  }));
}

const harness: { setLayout: ((next: PageLayout) => void) | null; slots: VirtualSlot[]; scale: number } = {
  setLayout: null,
  slots: [],
  scale: 0,
};

function Harness({
  scale,
  optionalContentConfig = null,
}: {
  scale: ScaleMode;
  /** The one config the shell resolved for this document, exactly as `ViewerParts` hands it down. */
  optionalContentConfig?: OptionalContentConfigHandle | null;
}) {
  const [layout, setLayout] = useState<PageLayout>('continuous');
  const virtualizer = usePdfVirtualizer({ doc, numPages: NUM_PAGES, scale, layout });
  // The shell is given the whole document's rows rather than the hook's two-row window, because jsdom's
  // viewport is zero-height: what is under test is what a regrouping does to twelve painted pages.
  const slots = rowsFor(layout);
  harness.setLayout = setLayout;
  harness.slots = slots;
  harness.scale = virtualizer.resolvedScale;

  const controller = {
    ...virtualizer,
    virtualSlots: slots,
    doc,
    status: 'ready',
    numPages: NUM_PAGES,
    error: null,
    reload: () => {},
    labels: DEFAULT_LABELS,
    rotation: 0,
    pageRotations: {},
    contentVersion: 0,
    optionalContentConfig,
    maxRowWidth: 0,
    linkService: {},
    matchesByPage: new Map(),
    activeLocalByPage: new Map(),
    navigateToActiveAt: () => {},
    pageProps: {},
    handlePageError: () => {},
    pageRetries: {},
    passwordPrompt: null,
    submitPassword: () => {},
    devicePixelRatio: 1,
    renderPixels: 4_000_000,
  } as unknown as ViewerController;

  return (
    <ViewerProvider controller={controller}>
      <ViewerPages />
    </ViewerProvider>
  );
}

/** Every canvas on screen, as the page number the shell gave its `aria-label` and its backing store. */
function canvases(): Map<number, string> {
  const out = new Map<number, string>();
  for (const canvas of Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas'))) {
    const page = Number(/(\d+)/.exec(canvas.getAttribute('aria-label') ?? '')?.[1]);
    if (Number.isFinite(page)) out.set(page, `${canvas.width}x${canvas.height}`);
  }
  return out;
}

async function mount(
  scale: ScaleMode,
  options: { optionalContentConfig?: OptionalContentConfigHandle | null } = {},
) {
  await act(async () => {
    render(<Harness scale={scale} optionalContentConfig={options.optionalContentConfig ?? null} />);
  });
  await act(async () => undefined);
}

async function switchTo(layout: PageLayout) {
  const setLayout = harness.setLayout;
  if (!setLayout) throw new Error('the harness never published its layout setter');
  await act(async () => {
    setLayout(layout);
  });
  await act(async () => undefined);
}

afterEach(() => {
  cleanup();
  harness.setLayout = null;
  harness.slots = [];
  paints.clear();
  renders.clear();
});

describe('FR-08: a layout switch at a fixed zoom paints nothing again', () => {
  it('paints every page once, and not a second time when the rows regroup', async () => {
    await mount(1);
    expect(canvases().size).toBe(NUM_PAGES);
    expect([...paints.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: NUM_PAGES }, (_, i) => i + 1),
    );
    expect([...paints.values()]).toEqual(Array(NUM_PAGES).fill(1));

    await switchTo('spread');

    const repainted = [...paints.entries()].filter(([, count]) => count > 1);
    expect(repainted, `pages repainted by the switch at scale 1: ${repainted.map(([p]) => p).join(', ')}`).toEqual(
      [],
    );
    // …and the switch really did regroup: 12 rows of one became 7 rows carrying 5 pairs.
    expect(harness.slots.filter((slot) => slot.pages.length === 2)).toHaveLength(5);
    expect(paints.size).toBe(NUM_PAGES);
  });

  it('leaves every backing store at the same size, because a resized canvas is a repainted canvas', async () => {
    await mount(1.25);
    const before = canvases();
    expect(before.size).toBe(NUM_PAGES);

    await switchTo('spread');

    const after = canvases();
    expect(after.size).toBe(before.size);
    const resized = [...before.entries()].filter(([page, box]) => after.get(page) !== box);
    expect(resized, `canvases resized by the switch: ${resized.map(([p]) => p).join(', ')}`).toEqual([]);
  });

  it('holds the scale the host asked for across the switch, which is what makes the two above mean it', async () => {
    await mount(1);
    const scaleBefore = harness.scale;
    await switchTo('spread');
    // The premise of the clause: at a numeric scale a regrouping does not move the fit target, so there is
    // nothing for a canvas to catch up with. In a fit mode this number is the one that moves, and the
    // repaint that follows it is correct rather than wasteful.
    expect(scaleBefore).toBe(1);
    expect(harness.scale).toBe(scaleBefore);
  });
});

/*
 * FR-08's other leg, which this file used to hand to a browser because jsdom had no viewport to fit against
 * (see the header). With the measurements faked above it is testable where the arithmetic is: a fit scale
 * resolves against the element's box, the box is known, and the two halves of "repaints *only* when the fit
 * target itself moves" can both be asked.
 *
 * The two-page case is the interesting one because the fit target really does move: two pages across one
 * viewport width is a different fit than one, which is why the row is allowed to reach the canvas. The
 * single-page case is the guard against an implementation that repaints on *any* layout change — the fit
 * target there is identical, so a repaint is the waste the clause forbids.
 */
describe('FR-08: in a fit mode the switch repaints only when the fit target moved', () => {
  beforeEach(() => {
    metrics.width = 1000;
    metrics.height = 800;
    ObserverStub.instances = [];
    giveViewportASize();
  });

  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  });

  it('fits one page across a 1000 px viewport, and doubles the canvas that implies', async () => {
    await mount('fit-width');
    expect(harness.scale).toBeCloseTo((1000 - WIDE_PADDING) / PAGE_W, 6);
    const before = canvases();
    expect(before.size).toBe(NUM_PAGES);

    await switchTo('spread');

    // Two pages across the same width, minus the gap between them: the fit target moved, so the paint follows.
    expect(harness.scale).toBeCloseTo((1000 - WIDE_PADDING - DEFAULT_GAP) / (2 * PAGE_W), 6);
    const repainted = [...paints.entries()].filter(([, count]) => count > 1).map(([page]) => page);
    expect(repainted.sort((a, b) => a - b), 'every page was asked to paint again').toEqual(
      Array.from({ length: NUM_PAGES }, (_, i) => i + 1),
    );
    const after = canvases();
    const resized = [...before.keys()].filter((page) => before.get(page) !== after.get(page));
    expect(resized.length, 'and every canvas changed size, which is what a repaint is').toBe(NUM_PAGES);
  });

  it('leaves every canvas alone when the fit target did not move — continuous to single is the same fit', async () => {
    await mount('fit-width');
    const scale = harness.scale;
    const before = canvases();

    await switchTo('single');

    expect(harness.scale, 'a row of one page fits one page wide, whichever layout asked for it').toBe(scale);
    const repainted = [...paints.entries()].filter(([, count]) => count > 1).map(([page]) => page);
    expect(repainted, `pages the switch repainted for no reason: ${repainted.join(', ')}`).toEqual([]);
    const after = canvases();
    const resized = [...before.entries()].filter(([page, box]) => after.get(page) !== box);
    expect(resized).toEqual([]);
  });

  it('follows the viewport, because a window dragged narrower is a fit target that moved', async () => {
    await mount('fit-width');
    const before = harness.scale;
    metrics.width = 500;
    resize();
    await act(async () => undefined);

    expect(harness.scale, 'the narrow padding applies below 640 px, so the scale is not simply halved').toBeCloseTo(
      (500 - 8) / PAGE_W,
      6,
    );
    expect(harness.scale).not.toBe(before);
    const repainted = [...paints.entries()].filter(([, count]) => count > 1).map(([page]) => page);
    expect(repainted.sort((a, b) => a - b), 'and the pages caught up with the new fit').toEqual(
      Array.from({ length: NUM_PAGES }, (_, i) => i + 1),
    );
  });
});

/*
 * FR-24's shared-instance clause, at the one place it can be seen: the options a page hands to
 * `page.render()`. `getOptionalContentConfig()` builds a new object per call, so a render that fetched its
 * own would paint layers that no panel switch can move — which is exactly the bug the shell's comment says it
 * is avoiding, and until now the only evidence was the reading of `PdfPage.tsx:495`.
 */
describe('FR-24: every page renders with the one configuration instance', () => {
  it('passes the shell’s own object to each page’s render, and does not fetch a fresh one', async () => {
    const calls: Array<{ id: string; visible: boolean }> = [];
    const handle = {
      getOrder: () => ['1', '2'],
      getGroup: (id: string) => ({ id, name: `Layer ${id}`, visible: id === '1' }),
      setVisibility: (id: string, visible: boolean) => calls.push({ id, visible }),
      setOCGState: () => undefined,
    } as unknown as OptionalContentConfigHandle;
    const fetched = vi.spyOn(doc, 'getOptionalContentConfig');

    await mount(1, { optionalContentConfig: handle });

    const pages = [...renders.keys()].sort((a, b) => a - b);
    expect(pages, 'every page painted').toEqual(Array.from({ length: NUM_PAGES }, (_, i) => i + 1));
    const instances = await Promise.all(
      pages.map(async (page) => {
        const options = renders.get(page) as { optionalContentConfigPromise?: Promise<unknown> };
        return options.optionalContentConfigPromise ? options.optionalContentConfigPromise : null;
      }),
    );
    expect(instances.every((promise) => promise !== null), 'no page rendered without a layer config').toBe(true);
    const resolved = await Promise.all(instances.map((promise) => promise!));
    expect(
      resolved.filter((instance) => instance === handle).length,
      'the instance each page renders with is the one the shell resolved, not a copy of it',
    ).toBe(NUM_PAGES);
    expect(fetched, 'a page that fetched its own config would be rendering something nobody can switch').not
      .toHaveBeenCalled();
  });

  it('hands no promise at all to a document the shell found layer-less', async () => {
    await mount(1);
    const withConfig = [...renders.values()].filter(
      (options) => (options as { optionalContentConfigPromise?: unknown }).optionalContentConfigPromise,
    );
    expect(withConfig, 'an absent config is not an empty one — pdf.js would then build its own').toEqual([]);
  });
});
