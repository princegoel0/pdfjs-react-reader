/*
 * FR-28's composed-part clause, tested on the shape PRD §5.3 draws: `a part takes the props a host must
 * decide, never the ones the controller already knows`.
 *
 * The clause is easy to satisfy by accident and easy to lose on purpose. Every part here used to take what
 * it renders as props — `ThumbnailList` wanted `doc`/`numPages`/`currentPage`/`onSelectPage`, `OutlineView`
 * wanted `entries`/`onSelectPage` — so a host that had already handed a controller to the provider was asked
 * to wire the same state again, to each part, by hand. The bug that produces is not a crash: it is a sidebar
 * on page 4 while the viewer is on page 9, because the host passed a number the controller had moved on
 * from. Each row below therefore asks where the part's content came from when nothing was passed to it, and
 * one row asks the opposite question — what the host still owns, which is the frame's own layout.
 *
 * `PublishOutline` stands where the outline tier's Runner would. It is deliberately not a prop handoff: the
 * store is the only door a composed part reads through now, so a test that passed the tree in directly would
 * be auditing markup nothing in the package renders. Its publication is a module-level constant for a
 * reason — an effect that writes the store re-renders the provider, and a fresh object identity on each of
 * those renders is a loop that ends in an exhausted heap rather than in a failing assertion.
 */
import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { OutlineView } from './OutlineView';
import { ThumbnailList } from './ThumbnailList';
import { ViewerRoot, ViewerSidebar } from './ViewerParts';
import { useViewer, ViewerProvider } from './ViewerContext';
import { useViewerController, type ViewerController } from './ViewerController';
import { OUTLINE_FEATURE_ID } from '../lib/feature-ids';
import type { FeaturePublication } from '../lib/features';
import type { OutlineEntry } from '../lib/outline';

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
// `PdfThumbnail` asks the engine for a page only once it is on screen, and jsdom reports nothing as
// intersecting. Stubbing the observer keeps that gate closed rather than removing it.
globalThis.IntersectionObserver = class {
  constructor(_callback: unknown) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof IntersectionObserver;
// jsdom implements no `scrollIntoView`, and keeping the active card in sight is what the list does with it.
// Stubbed rather than removed from the component: the scroll is real behaviour in a browser, and this file
// is not where its absence belongs.
Element.prototype.scrollIntoView = () => {};

/**
 * One document for every render: the controller keys its effects on the proxy's identity, so an object
 * built per render re-runs them on each commit and the harness loops.
 */
const fakeDoc = {
  numPages: 3,
  getPage: async () => {
    throw new Error('nothing is painted in jsdom; the list is what is under test');
  },
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

const entry = (title: string, pageIndex: number): OutlineEntry => ({
  title,
  pageIndex,
  position: null,
  children: [],
  collapsed: false,
});

/** Stable identity, on purpose — see the header. */
const OUTLINE_PUBLICATION: FeaturePublication = {
  entries: [entry('Summary', 0), entry('Revenue', 1)],
  loading: false,
};

let controller: ViewerController | null = null;

function PublishOutline() {
  const { store } = useViewer();
  useEffect(() => {
    store.publish(OUTLINE_FEATURE_ID, OUTLINE_PUBLICATION);
  }, [store]);
  return null;
}

function Composed({ children }: { children?: React.ReactNode }) {
  controller = useViewerController({ src: '/fixtures/outline-sample.pdf', defaultScale: 1 });
  return (
    <ViewerProvider controller={controller}>
      <ViewerRoot>{children}</ViewerRoot>
    </ViewerProvider>
  );
}

/** `ViewerRoot` with the two props a host owns, so the merge is what is on screen. */
function ComposedFrame({ className, style }: { className?: string; style?: React.CSSProperties }) {
  controller = useViewerController({ src: '/fixtures/outline-sample.pdf', defaultScale: 1 });
  return (
    <ViewerProvider controller={controller}>
      <ViewerRoot className={className} style={style}>
        <p>inside</p>
      </ViewerRoot>
    </ViewerProvider>
  );
}

async function mount(element: React.ReactNode) {
  let rendered: RenderResult | null = null;
  await act(async () => {
    rendered = render(element);
  });
  // Cast rather than narrowed: TypeScript cannot see that the callback above ran, so it reads the
  // assignment as leaving `null` and calls the result `never`.
  const result = rendered as RenderResult | null;
  if (!controller) throw new Error('the composed harness never published its controller');
  if (!result) throw new Error('the composed harness never rendered');
  return result;
}

/** The sidebar ships closed, so the rows that read it open it the way a reader would. */
async function openSidebar() {
  await act(async () => {
    controller!.setSidebarOpen(true);
  });
}

afterEach(() => {
  cleanup();
  controller = null;
});

describe('the parts read the viewer they sit in (FR-28)', () => {
  it('draws the thumbnails of the document the controller loaded, with no page count passed in', async () => {
    const { container } = await mount(
      <Composed>
        <ThumbnailList />
      </Composed>,
    );
    expect(container.querySelectorAll('[data-page]')).toHaveLength(3);
  });

  it('marks the page the controller is on, which nobody told it', async () => {
    const { container } = await mount(
      <Composed>
        <ThumbnailList />
      </Composed>,
    );
    expect(controller?.currentPage).toBe(1);
    const active = [...container.querySelectorAll('.pjsr-thumbnail')].filter((el) =>
      el.classList.contains('pjsr-thumbnail--active'),
    );
    // One, and the one the viewer is on: the list cannot be a page behind, because it has no number of its
    // own to be behind with.
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('data-page')).toBe('1');
  });

  it('shows the outline the tier published, and says so when no tier is mounted', async () => {
    const bare = await mount(
      <Composed>
        <OutlineView />
      </Composed>,
    );
    // No Runner means no publication, and the store hands back an empty object: the part reports that with
    // its empty row rather than throwing on a field it was never given.
    expect(bare.container.querySelector('.pjsr-outline-tree')).toBeNull();
    expect(bare.container.querySelector('.pjsr-outline-empty')).not.toBeNull();

    cleanup();
    const filled = await mount(
      <Composed>
        <PublishOutline />
        <OutlineView />
      </Composed>,
    );
    expect(filled.container.querySelectorAll('.pjsr-outline-link')).toHaveLength(2);
  });

  it('keeps the shell’s frame classes while taking the layout the host owns', async () => {
    await mount(
      <ComposedFrame
        className="report-grid"
        style={{ display: 'grid', gridTemplateColumns: '280px 1fr' }}
      />,
    );
    const frame = document.querySelector('.pjsr-viewer');
    // Both halves: the theme class the controller writes, and the arrangement the host asked for. Dropping
    // either one is the part refusing either the shell or the host.
    expect(frame?.classList.contains('pjsr-viewer')).toBe(true);
    expect(frame?.classList.contains('report-grid')).toBe(true);
    expect((frame as HTMLElement).style.display).toBe('grid');
    expect((frame as HTMLElement).style.gridTemplateColumns).toBe('280px 1fr');
  });

  it('gives a host sidebar no tab that selects nothing', async () => {
    await mount(
      <Composed>
        <ViewerSidebar>
          <OutlineView />
          <ThumbnailList />
        </ViewerSidebar>
      </Composed>,
    );
    await openSidebar();
    expect(document.querySelector('.pjsr-sidebar')).not.toBeNull();
    // A strip with nothing to switch between is a control that lies, and a panel with no owning tab cannot
    // claim `role="tabpanel"` — the second of these is what FR-45's audit would have flagged.
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    expect(document.querySelector('[role="tabpanel"]')).toBeNull();
    expect(document.querySelector('[data-page="1"]')).not.toBeNull();
    expect(document.querySelector('.pjsr-sidebar-close')).not.toBeNull();
  });

  it('keeps the shell’s own tabs when the host asks for the default sidebar', async () => {
    await mount(
      <Composed>
        <ViewerSidebar />
      </Composed>,
    );
    await openSidebar();
    const tablist = document.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist?.querySelector('[role="tab"]')?.textContent).toBe('Thumbnails');
    expect(document.querySelector('[role="tabpanel"]')).not.toBeNull();
  });
});
