/*
 * FR-45's page-change announcement, on the shell that has to render it.
 *
 * `page-announcement.test.ts` decides *when* a sentence is due; this file checks the four things only a
 * mounted viewer can get wrong: that the region exists with the attributes that make a change be announced
 * (`role="status"`, `aria-live="polite"`, `aria-atomic` so the whole sentence is read rather than the diff),
 * that it is empty for the page the viewer opened on, that a burst of moves produces one sentence about the
 * place the reader ended up rather than one about each, and that two viewers on one page do not speak for
 * each other.
 *
 * The document object is module-level and shared by every stub for a reason: the policy keys an announcement
 * on the document's *identity*, so a stub that built a fresh proxy per render would turn every page change
 * into a new document and make the burst tests pass for the wrong reason. `doc('other')` is passed only where
 * a replaced document is the thing under test.
 *
 * The controller is a stub, in the manner of `ViewerLabels.test.tsx`: what is under test is which values the
 * part reads out of the viewer around it and what it does with them over time. The page list is deliberately
 * empty — `virtualSlots: []` — because mounting the real page path is a different, larger finding about this
 * harness than anything to do with announcements, and because a region that depends on nothing painted is
 * the region that cannot be quietly silenced by a page that never rendered.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ANNOUNCE_QUIET_MS } from '../lib/page-announcement';
import { DEFAULT_LABELS, type PdfViewerLabels } from '../lib/labels';
import { DE_LABELS } from '../locales/de';
import { createPdfLinkService } from '../lib/link-service';
import type { ViewerController } from './ViewerController';
import { ViewerProvider } from './ViewerContext';
import { ViewerPages } from './ViewerParts';

const doc = (name: string) => ({ numPages: 12, name } as unknown as PDFDocumentProxy);
const DOCUMENT = doc('this');
const OTHER = doc('other');

interface Page {
  currentPage: number;
  doc?: PDFDocumentProxy;
  status?: string;
  labels?: PdfViewerLabels;
  pageLabels?: readonly string[] | null;
}

/** A controller carrying what the page region reads, and nothing else. */
function stub(page: Page): ViewerController {
  const {
    currentPage,
    doc: document = DOCUMENT,
    status = 'ready',
    labels = DEFAULT_LABELS,
    pageLabels = null,
  } = page;
  return {
    doc: document,
    status,
    numPages: 12,
    error: null,
    reload: vi.fn(),
    labels,
    containerRef: { current: null },
    virtualSlots: [],
    totalHeight: 0,
    maxRowWidth: 0,
    resolvedScale: 1,
    rotation: 0,
    pageRotations: {},
    devicePixelRatio: 1,
    renderPixels: 1_000_000,
    contentVersion: 0,
    optionalContentConfig: null,
    reportPageDims: vi.fn(),
    linkService: createPdfLinkService(),
    matchesByPage: new Map(),
    activeLocalByPage: new Map(),
    navigateToActiveAt: 0,
    pageProps: {},
    handlePageError: vi.fn(),
    pageRetries: {},
    passwordPrompt: null,
    submitPassword: vi.fn(),
    currentPage,
    pageLabels,
  } as unknown as ViewerController;
}

const region = (node: HTMLElement) => node.querySelector<HTMLElement>('.pjsr-live-region');
const spokenIn = (node: HTMLElement) => region(node)?.textContent ?? '(no live region)';

/**
 * One viewer, moved by re-rendering its provider. `settle()` runs out the quiet period, which is the whole
 * mechanism: the assertions about silence are assertions about a timer that has not been allowed to fire.
 */
function mount(initial: Page) {
  const view = render(
    <ViewerProvider controller={stub(initial)}>
      <ViewerPages />
    </ViewerProvider>,
  );
  return {
    view,
    spoken: () => spokenIn(view.container),
    moveTo: (next: Page) =>
      act(() =>
        view.rerender(
          <ViewerProvider controller={stub(next)}>
            <ViewerPages />
          </ViewerProvider>,
        ),
      ),
    settle: () => act(() => void vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 50)),
  };
}

/** Two viewers side by side, which is the case the clause's instance-scoping is about. */
function Pair({ one, two }: { one: Page; two: Page }) {
  return (
    <>
      <ViewerProvider controller={stub({ ...one, doc: one.doc ?? DOCUMENT })}>
        <div data-testid="viewer-one">
          <ViewerPages />
        </div>
      </ViewerProvider>
      <ViewerProvider controller={stub({ ...two, doc: two.doc ?? OTHER })}>
        <div data-testid="viewer-two">
          <ViewerPages />
        </div>
      </ViewerProvider>
    </>
  );
}

function mountPair(one: Page, two: Page) {
  const view = render(<Pair one={one} two={two} />);
  const of = (testId: 'viewer-one' | 'viewer-two') => spokenIn(view.getByTestId(testId) as HTMLElement);
  return {
    first: () => of('viewer-one'),
    second: () => of('viewer-two'),
    /** Only viewer one moves; viewer two is re-rendered with the same document and the same page. */
    moveOne: (page: number) => act(() => view.rerender(<Pair one={{ ...one, currentPage: page }} two={two} />)),
    settle: () => act(() => void vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 50)),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the live region (FR-45)', () => {
  it('is present, polite, and reads the whole sentence rather than the difference', () => {
    const { view } = mount({ currentPage: 1 });
    const el = region(view.container);
    expect(el).not.toBeNull();
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.getAttribute('aria-live')).toBe('polite');
    expect(el?.getAttribute('aria-atomic')).toBe('true');
  });

  it('says nothing about the page the viewer opened on', () => {
    const { spoken, settle } = mount({ currentPage: 1 });
    settle();
    // Mounting is not a page change, and on a page holding two viewers it is the difference between an
    // announcement and an ambush about documents nobody opened.
    expect(spoken(), 'a viewer announced a page nobody turned').toBe('');
  });

  it('announces once, after the moves stop, about where the reader ended up', () => {
    const { moveTo, spoken, settle } = mount({ currentPage: 1 });

    moveTo({ currentPage: 2 });
    expect(spoken(), 'a sentence arrived before the reader stopped moving').toBe('');
    moveTo({ currentPage: 3 });
    settle();

    // Asserted rather than waited for: with fake timers a `waitFor` polls on the clock this test is holding
    // still, and the assertion it is meant to prove is one timer step away anyway.
    expect(spoken()).toBe('Page 3 of 12');
  });

  it('says nothing when the reader ends where they were', () => {
    const { moveTo, spoken, settle } = mount({ currentPage: 2 });
    moveTo({ currentPage: 3 });
    moveTo({ currentPage: 2 });
    settle();
    expect(spoken(), 'the pending sentence fired for a position the reader left again').toBe('');
  });

  it('announces a replaced document even when the page number is the one already told', () => {
    const { moveTo, spoken, settle } = mount({ currentPage: 1 });
    moveTo({ currentPage: 1, doc: OTHER });
    settle();
    expect(spoken()).toBe('Page 1 of 12');
  });

  it('names a page by its label when the document has one (FR-12)', () => {
    const labels = ['i', 'ii', 'iii', '1', '2', '3', '4', '5', 'A-1', 'A-2', 'A-3', 'A-4'];
    const { moveTo, spoken, settle } = mount({ currentPage: 1, pageLabels: labels });
    moveTo({ currentPage: 3, pageLabels: labels });
    settle();
    expect(spoken()).toBe('Page iii of 12');
  });

  it('speaks the host’s language, because the sentence is a label and not a string', () => {
    const { moveTo, spoken, settle } = mount({ currentPage: 1, labels: DE_LABELS });
    moveTo({ currentPage: 5, labels: DE_LABELS });
    settle();
    expect(spoken()).toBe('Seite 5 von 12');
  });

  it('stays quiet while the document is not there to be on', () => {
    const { moveTo, spoken, settle } = mount({ currentPage: 1, status: 'loading' });
    moveTo({ currentPage: 4, status: 'loading' });
    settle();
    expect(spoken(), 'a loading viewer announced a page it has not got').toBe('');
  });

  it('is scoped to its own viewer, so a page turned in one is not spoken by the other', () => {
    const pair = mountPair({ currentPage: 1 }, { currentPage: 7 });
    pair.settle();
    expect(pair.first()).toBe('');
    expect(pair.second()).toBe('');

    // One viewer moves and the other is re-rendered with the same document on the same page, which is the
    // ordinary case for a host whose parent re-renders. Two providers, one sentence — the same property the
    // keyboard handling is scoped by, and the reason this part reads `useViewer()` rather than a module.
    pair.moveOne(9);
    pair.settle();
    expect(pair.first()).toBe('Page 9 of 12');
    expect(pair.second(), 'the neighbour announced a page it never moved to').toBe('');
  });
});
