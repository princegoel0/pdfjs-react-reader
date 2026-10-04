/*
 * FR-08's clause that no test had ever made: "switching regroups the rows without remounting a page".
 *
 * The 2026-09-29 measurement settled the *repaint* half — at a fixed zoom the canvases kept their backing
 * stores, in a fit mode they did not, and the requirement was restated around that. It did not count mounts,
 * and the two are different claims: a canvas can keep its pixels while the component that painted it is
 * destroyed and rebuilt, because a row is a grouping and a grouping changes when the layout changes. Pages
 * used to be children of the row, and React cannot move a mounted component between parents — so a switch
 * dropped every row whose head stopped being a head, and the pages inside it went with it.
 *
 * That is only visible when the two groupings disagree about *which* rows exist. The identity tests therefore
 * run over a whole document's worth of rows rather than the two a jsdom viewport shows: across two rows the
 * continuous heads (1, 2) and the spread heads (1, 2) coincide, and the bug hides completely — which is how a
 * measured row survived for a release with the clause still unproven. The rows come from the real
 * `computeSlots` with the virtualizer's own row arithmetic, and the second describe drives the real hook end
 * to end so the numbers a host reads are tested as well.
 *
 * `PdfPage` is stubbed because what is under test is where a page element lives, not what it paints, and the
 * ref callback is deliberately stable per page: an inline arrow is a new function every render, and React
 * calls a changed ref with `null` then the node on every re-render, which would count a re-render as a remount.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfVirtualizer, type VirtualSlot } from '../headless/usePdfVirtualizer';
import { computeSlots, type PageLayout } from '../lib/layout';
import { DEFAULT_LABELS } from '../lib/labels';
import { ViewerProvider } from './ViewerContext';
import type { ViewerController } from './ViewerController';
import { ViewerPages } from './ViewerParts';

const seen = vi.hoisted(() => ({
  mounts: new Map<number, number>(),
  unmounts: new Map<number, number>(),
  nodes: new Map<number, HTMLElement>(),
  refs: new Map<number, (node: HTMLElement | null) => void>(),
}));

vi.mock('./PdfPage', () => ({
  PdfPage: ({ pageNumber, className }: { pageNumber: number; className?: string }) => {
    let ref = seen.refs.get(pageNumber);
    if (!ref) {
      ref = (node: HTMLElement | null) => {
        if (node) {
          seen.mounts.set(pageNumber, (seen.mounts.get(pageNumber) ?? 0) + 1);
          seen.nodes.set(pageNumber, node);
        } else {
          seen.unmounts.set(pageNumber, (seen.unmounts.get(pageNumber) ?? 0) + 1);
        }
      };
      seen.refs.set(pageNumber, ref);
    }
    return <div className={className} data-page={pageNumber} ref={ref} />;
  },
}));

/** What the harness rendered last, so a test can switch it and read what it grouped. */
const harness: { setLayout: ((next: PageLayout) => void) | null; slots: VirtualSlot[] } = {
  setLayout: null,
  slots: [],
};

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

const NUM_PAGES = 12;
const PAGE_W = 612;
const PAGE_H = 792;
/** `usePdfVirtualizer`'s default row gap, which is what separates the two halves of a spread. */
const DEFAULT_GAP = 16;

const fakePage = {
  getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({
    width: PAGE_W * scale,
    height: PAGE_H * scale,
  }),
  getAnnotations: async () => ({}),
  getTextContent: async () => ({ items: [] }),
  render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  cleanup: () => {},
};

const doc = {
  numPages: NUM_PAGES,
  getPage: async () => fakePage,
  cleanup: () => {},
} as unknown as PDFDocumentProxy;

const EVERY_PAGE = Array.from({ length: NUM_PAGES }, (_, i) => i + 1);

/**
 * Every row the document has in the given grouping, with the virtualizer's own row arithmetic.
 *
 * `computeSlots` is production code and is where "regroups the rows" really happens; the rest is the
 * arithmetic the hook applies to it. Needed because jsdom's viewport is zero-height, so the hook will only
 * ever window two rows — and two rows are not enough for the two groupings to disagree about anything.
 */
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

function Harness({ fromHook }: { fromHook?: boolean }) {
  const [layout, setLayout] = useState<PageLayout>('continuous');
  const virtualizer = usePdfVirtualizer({ doc, numPages: NUM_PAGES, scale: 1, layout });
  const slots = fromHook ? virtualizer.virtualSlots : rowsFor(layout);
  harness.setLayout = setLayout;
  useEffect(() => {
    harness.slots = slots;
  });

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
    optionalContentConfig: null,
    maxRowWidth: slots.reduce((max, slot) => Math.max(max, slot.width), 0),
    linkService: {},
    matchesByPage: new Map<number, unknown[]>(),
    activeLocalByPage: new Map<number, number>(),
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

/** Page numbers in the DOM, in document order. */
function pagesOnScreen(): number[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-page]')).map((el) =>
    Number(el.dataset.page),
  );
}

async function mount(fromHook?: boolean) {
  await act(async () => {
    render(<Harness fromHook={fromHook} />);
  });
  // The virtualizer reads page 1's box from the document before it lays anything out.
  await act(async () => undefined);
}

async function switchTo(layout: PageLayout) {
  const setLayout = harness.setLayout;
  if (!setLayout) throw new Error('the harness never published its layout setter');
  await act(async () => {
    setLayout(layout);
  });
}

/** The assertion the clause turns on, stated once because four switches use it. */
function expectNoRemount(pages: number[], what: string) {
  const remounted = pages.filter((page) => (seen.mounts.get(page) ?? 0) > 1);
  expect(remounted, `${what}: remounted ${remounted.join(', ')}`).toEqual([]);
  const unmounted = pages.filter((page) => (seen.unmounts.get(page) ?? 0) > 0);
  expect(unmounted, `${what}: unmounted ${unmounted.join(', ')}`).toEqual([]);
}

afterEach(() => {
  cleanup();
  harness.setLayout = null;
  harness.slots = [];
  seen.mounts.clear();
  seen.unmounts.clear();
  seen.nodes.clear();
  seen.refs.clear();
});

describe('FR-08: a layout switch regroups rows without remounting a page', () => {
  it('keeps all twelve pages mounted once when the rows regroup into spreads', async () => {
    await mount();
    expect(pagesOnScreen()).toEqual(EVERY_PAGE);

    await switchTo('spread');

    // The two groupings disagree about which rows exist: continuous heads every page, spread heads
    // 1, 2, 4, 6, 8, 10, 12 — so pages 3, 5, 7, 9 and 11 lose the row they used to be alone in. That is the
    // event the clause is about, and every one of the twelve has to come through it as the same component.
    expect(harness.slots.map((slot) => slot.pageNumber)).toEqual([1, 2, 4, 6, 8, 10, 12]);
    expect(pagesOnScreen().length).toBe(NUM_PAGES);
    expectNoRemount(EVERY_PAGE, 'continuous to spread');
  });

  it('keeps them mounted once back down to single pages, and again into presentation mode', async () => {
    await mount();
    const nodeOf = new Map(pagesOnScreen().map((page) => [page, seen.nodes.get(page)]));

    await switchTo('spread');
    await switchTo('continuous');
    expectNoRemount(EVERY_PAGE, 'spread back to continuous');
    for (const page of EVERY_PAGE) {
      expect(seen.nodes.get(page), `page ${page} came back as a different node`).toBe(nodeOf.get(page));
    }

    // And a third regrouping, this time back to one page per row. Presentation mode's *windowing* — one row
    // on screen — is the hook's and is asserted in the describe below; these rows are the whole document, so
    // what is checked here is that a second regrouping still moves no page.
    await switchTo('single');
    expect(pagesOnScreen()).toEqual(EVERY_PAGE);
    expectNoRemount(EVERY_PAGE, 'spread to single');
  });

  it('really does regroup, because a switch that changed nothing would pass the two tests above', async () => {
    await mount();
    expect(harness.slots.every((slot) => slot.pages.length === 1), 'continuous is one page per row').toBe(
      true,
    );
    await switchTo('spread');
    expect(harness.slots.filter((slot) => slot.pages.length === 2)).toHaveLength(5);
    // Twelve pages do not divide into pairs after the book convention takes page 1 out, so the last page is
    // alone at the end of the document as well as the first being alone at the start.
    expect(harness.slots.filter((slot) => slot.pages.length === 1)).toHaveLength(2);
    // The book convention, which is what makes the regrouping asymmetric: page 1 alone, then the pairs.
    expect(harness.slots[0]!.pages.map((page) => page.pageNumber)).toEqual([1]);
    expect(harness.slots[1]!.pages.map((page) => page.pageNumber)).toEqual([2, 3]);
  });
});

describe('FR-08: the virtualizer publishes where each page sits in its row', () => {
  it('mounts pages at all, which every assertion here leans on', async () => {
    await mount(true);
    expect(pagesOnScreen().length).toBeGreaterThan(1);
  });

  it('gives every page of a row a box, and pairs them at the default gap', async () => {
    await mount(true);
    await switchTo('spread');
    const slots = harness.slots;
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.pages.map((page) => page.index)).toEqual(slot.indices);
      for (const page of slot.pages) {
        expect(page.left + page.width).toBeLessThanOrEqual(slot.width + 0.001);
        expect(page.top + page.height).toBeLessThanOrEqual(slot.height + 0.001);
      }
    }
    const paired = slots.find((slot) => slot.pages.length === 2);
    expect(paired, 'a spread row holds two pages').toBeTruthy();
    if (paired) {
      const [first, second] = [paired.pages[0]!, paired.pages[1]!];
      expect(second.left).toBeCloseTo(first.left + first.width + DEFAULT_GAP, 5);
      expect(second.index).toBe(first.index + 1);
    }
  });

  it('keeps a page that stays on screen mounted once across the switch the hook itself drives', async () => {
    await mount(true);
    const before = pagesOnScreen();
    await switchTo('spread');
    const shared = before.filter((page) => pagesOnScreen().includes(page));
    expect(shared.length).toBeGreaterThan(1);
    expectNoRemount(shared, 'the hook window');
  });

  it('leaves one row on screen in presentation mode, and it is the row that was already there', async () => {
    await mount(true);
    await switchTo('single');
    const visible = pagesOnScreen();
    expect(visible, 'single-page presentation shows one page').toHaveLength(1);
    expect(seen.mounts.get(visible[0]!), `page ${visible[0]} was rebuilt to get there`).toBe(1);
  });
});
