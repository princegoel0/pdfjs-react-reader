/*
 * FR-10's click path: a bookmark that names a place lands on that place, and the magnification it names is
 * taken — in that order, because the second changes the answer to the first.
 *
 * What is under test here is the *wiring*, and it is worth being exact about the division of labour between
 * this file and `src/lib/outline.test.ts`. That file asks the real engine, over the real fixture bytes, what
 * `convertToViewportPoint` returns for a point the document actually carries — the axis flip and the rotation
 * are pdf.js's business and are not re-derived here. This file asserts that the shell asks the question with
 * the page's own rotation and the live scale, uses the answer as the offset within the page, and changes the
 * scale before it measures when the destination asked for a magnification.
 *
 * The fake page therefore mirrors the engine's answer for an *unrotated* page — `(792 - y) * scale` is the
 * definition of that case, measured rather than assumed in the other file — and nothing more. A fake that
 * invented its own rotation maths would prove the fake works.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { OutlineView } from './OutlineView';
import { useViewer, ViewerProvider } from './ViewerContext';
import { useViewerController } from './ViewerController';
import { OUTLINE_FEATURE_ID } from '../lib/feature-ids';
import type { FeaturePublication } from '../lib/features';
import type { OutlineEntry, PdfDestinationPosition } from '../lib/outline';

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;

const PAGE_H = 792;

const engine = vi.hoisted(() => ({
  getViewport: [] as { scale: number; rotation: number }[],
  point: [] as [number, number][],
}));

function fakePage(rotate = 0) {
  return {
    rotate,
    getViewport: (options: { scale: number; rotation: number }) => {
      engine.getViewport.push(options);
      return {
        width: 612 * options.scale,
        height: PAGE_H * options.scale,
        convertToViewportPoint: (x: number, y: number) => {
          const point: [number, number] = [x * options.scale, (PAGE_H - y) * options.scale];
          engine.point.push(point);
          return point;
        },
      };
    },
    getAnnotations: async () => [],
    cleanup: () => {},
  };
}

const fakeDoc = {
  numPages: 3,
  getPage: vi.fn(async () => fakePage(0)),
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
    numPages: 3,
    isReady: true,
    error: null,
    capabilities: null,
    passwordRequest: null,
    reload: vi.fn(),
  }),
}));

const probe: { controller: ReturnType<typeof useViewerController> | null } = { controller: null };

function Probe() {
  const controller = useViewerController({ src: '/fixtures/outline-sample.pdf', defaultScale: 1 });
  probe.controller = controller;
  // The virtualizer scrolls whatever element carries its `containerRef`, and it is the shell's page region
  // that normally provides one. The scroll is what is being read, so the probe supplies it directly.
  return <div ref={controller.containerRef as { current: HTMLDivElement | null }} />;
}

async function mount() {
  await act(async () => {
    render(<Probe />);
  });
  await act(async () => undefined);
  const controller = probe.controller;
  if (!controller) throw new Error('the probe never published its controller');
  const el = controller.containerRef.current;
  if (!el) throw new Error('the probe never attached the scroll container');
  const scrollTo = vi.fn();
  Object.defineProperty(el, 'scrollTo', { value: scrollTo, configurable: true });
  return { controller, scrollTo };
}

/**
 * Stands in for a tier's Runner: the store is the only door a composed part reads through, so a test that
 * wants `OutlineView` to show a tree publishes into it exactly the way the outline feature does.
 */
function Publish({ publication }: { publication: FeaturePublication }) {
  const { store } = useViewer();
  // The dep list is the guard: `publish` only changes state when the values differ, so a stable entries
  // array settles here instead of re-rendering the provider forever.
  useEffect(() => {
    store.publish(OUTLINE_FEATURE_ID, publication);
  }, [store, publication]);
  return null;
}

/** The composed shape: a provider, a part under it, and the scroll container the virtualizer drives. */
function ComposedProbe({ entries }: { entries: OutlineEntry[] }) {
  const controller = useViewerController({ src: '/fixtures/outline-sample.pdf', defaultScale: 1 });
  probe.controller = controller;
  return (
    <div ref={controller.containerRef as { current: HTMLDivElement | null }}>
      <ViewerProvider controller={controller}>
        <Publish publication={{ entries, loading: false }} />
        <OutlineView />
      </ViewerProvider>
    </div>
  );
}

async function mountComposed(entries: OutlineEntry[]) {
  await act(async () => {
    render(<ComposedProbe entries={entries} />);
  });
  await act(async () => undefined);
  const controller = probe.controller;
  if (!controller) throw new Error('the composed probe never published its controller');
  const el = controller.containerRef.current;
  if (!el) throw new Error('the composed probe never attached the scroll container');
  const scrollTo = vi.fn();
  Object.defineProperty(el, 'scrollTo', { value: scrollTo, configurable: true });
  return { controller, scrollTo, el };
}

const xyz = (top: number | null, zoom: number | null = null, left: number | null = null): PdfDestinationPosition => ({  kind: 'XYZ',
  left,
  top,
  zoom,
});

afterEach(() => {
  cleanup();
  probe.controller = null;
  engine.getViewport = [];
  engine.point = [];
});

/** The viewport questions that came from a destination: only this code path passes a `rotation`. */
function askedFor() {
  return engine.getViewport.filter((call) => 'rotation' in call);
}

describe('FR-10: a destination click lands on the place, not just the page', () => {
  it('scrolls to the point the destination names, measured at the live scale and the page’s rotation', async () => {
    const { controller, scrollTo } = await mount();

    await act(async () => {
      controller.shellApi.followDestination(1, xyz(660, null, 72));
    });

    // 660 pt from the bottom of a 792 pt page at scale 1 is 132 px from its top, and page 1's row starts at 0.
    expect(askedFor()).toEqual([{ scale: 1, rotation: 0 }]);
    expect(engine.point[0]).toEqual([72, 132]);
    expect(scrollTo).toHaveBeenCalledWith({ top: 132, behavior: 'auto' });
  });

  it('takes the page top when the destination names no place, which is what a bare /Fit says', async () => {
    const { controller, scrollTo } = await mount();

    await act(async () => {
      controller.shellApi.followDestination(2, { kind: 'Fit', left: null, top: null, zoom: null });
    });

    // Nothing was asked of the viewport, because there was no place to ask about — and the scroll still
    // landed below page 1, which is the row the virtualizer has for page 2.
    expect(askedFor()).toEqual([]);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const landed = scrollTo.mock.calls[0]?.[0] as { top: number } | undefined;
    expect(landed?.top).toBeGreaterThan(0);
  });

  it('changes the magnification first, then measures the place at the new one', async () => {
    const { controller, scrollTo } = await mount();

    await act(async () => {
      controller.shellApi.followDestination(1, xyz(620, 2));
    });
    await act(async () => undefined);

    // Read through the probe, not the object `mount` returned: the controller is a new object each render,
    // and the one captured before the click still reports the scale the click replaced.
    expect(probe.controller?.scaleMode).toBe(2);
    expect(askedFor().at(-1)).toEqual({ scale: 2, rotation: 0 });
    // 172 pt from the top of the page, at scale 2: the scroll that lands is the one measured after the zoom.
    expect(engine.point.at(-1)).toEqual([0, 344]);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 344, behavior: 'auto' });
  });

  it('leaves the zoom alone when the destination asks for none, and clamps one it asks for that is off-scale', async () => {
    const { controller } = await mount();

    await act(async () => {
      controller.shellApi.followDestination(1, xyz(660));
    });
    expect(probe.controller?.scaleMode).toBe(1);

    await act(async () => {
      controller.shellApi.followDestination(1, xyz(660, 40));
    });
    // 40× is outside the 25–500 % the viewer advertises, and a destination cannot be allowed to put the page
    // outside its own advertised range: the ask is honoured as far as the range goes.
    expect(probe.controller?.scaleMode).toBe(5);
  });

  it('follows the place a bookmark names with nothing wired by the host, which is FR-28’s point', async () => {
    const { scrollTo } = await mountComposed([
      {
        title: '2.1 Deep dive',
        pageIndex: 1,
        position: { kind: 'FitH', left: null, top: 400, zoom: null } as PdfDestinationPosition,
        children: [],
        collapsed: false,
      },
    ]);

    // The tree came out of the store and the click went into `shellApi.followDestination`, with no
    // `entries`/`onSelectPage` passed by whoever placed the part — that wiring is what this row guards.
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.pjsr-outline-link')!.click();
    });
    await act(async () => undefined);

    // A click that knew only the page would have asked nothing of the viewport; asking is what carries the
    // place, and it is asked with the page's own rotation and the live scale.
    expect(askedFor()).toEqual([{ scale: 1, rotation: 0 }]);
    // 400 pt from the bottom of a 792 pt page at scale 1 is 392 px into page 2, whose row starts below
    // page 1 — so the landing is past its own offset and past the first page's height.
    const landed = scrollTo.mock.calls[0]?.[0] as { top: number } | undefined;
    expect(landed?.top).toBeGreaterThan(392);
  });
});
